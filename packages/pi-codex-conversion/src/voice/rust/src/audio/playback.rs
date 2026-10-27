use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{
    Device, ErrorKind, FromSample, Sample, SampleFormat, SizedSample, Stream, SupportedStreamConfig,
};
use crossbeam_queue::ArrayQueue;
use tokio::sync::mpsc;

use super::{Playback, PlaybackSample, SpeakerControl, SpeakerState, clear, validate_config};
use crate::codex_audio::buffers::{BLOCK, Frame, FramePacker};
use crate::protocol::Event;

const RENDER_QUEUE_FRAMES: usize = 192;
const PLAYBACK_QUEUE_MS: usize = 500;
const PLAYBACK_START_MS: usize = 100;
const ACTIVITY_INTERVAL: Duration = Duration::from_millis(100);
const ACTIVITY_THRESHOLD: f32 = 0.0001;

#[derive(Clone)]
struct OutputShared {
    samples: Arc<ArrayQueue<PlaybackSample>>,
    rendered: Arc<ArrayQueue<Frame>>,
    render_dropped: Arc<AtomicBool>,
    state: Arc<SpeakerState>,
    events: mpsc::Sender<Event>,
}

pub fn playback(device_id: Option<&str>, events: mpsc::Sender<Event>) -> Result<Playback> {
    let host = cpal::default_host();
    let device = if let Some(id) = device_id {
        host.output_devices()?
            .find(|device| {
                device
                    .id()
                    .is_ok_and(|candidate| candidate.to_string() == id)
            })
            .context("no speaker device available")?
    } else {
        host.default_output_device()
            .context("no default speaker configured")?
    };
    playback_device(device, events).context("failed to open the speaker")
}

fn playback_device(device: Device, events: mpsc::Sender<Event>) -> Result<Playback> {
    let supported = device
        .default_output_config()
        .context("speaker has no default output format")?;
    validate_config(&supported)?;
    let sample_rate = supported.sample_rate();
    let mut playback = Playback {
        stream: None,
        device,
        supported,
        events,
        samples: Arc::new(ArrayQueue::new(
            sample_rate as usize * PLAYBACK_QUEUE_MS / 1_000,
        )),
        rendered: Arc::new(ArrayQueue::new(RENDER_QUEUE_FRAMES)),
        render_dropped: Arc::new(AtomicBool::new(false)),
        sample_rate,
        state: Arc::new(SpeakerState::new()),
    };
    playback.restart()?;
    Ok(playback)
}

impl Playback {
    pub fn transition(&mut self, suppressed: bool, epoch: u64) -> Result<SpeakerControl> {
        let next = self.state.transition(suppressed, epoch)?;
        drop(self.stream.take());
        clear(&self.samples);
        clear(&self.rendered);
        self.render_dropped.store(false, Ordering::Release);
        if !suppressed {
            self.restart()?;
        }
        Ok(next)
    }

    fn restart(&mut self) -> Result<()> {
        let stream = build_output_stream(
            &self.device,
            &self.supported,
            OutputShared {
                samples: Arc::clone(&self.samples),
                rendered: Arc::clone(&self.rendered),
                render_dropped: Arc::clone(&self.render_dropped),
                state: Arc::clone(&self.state),
                events: self.events.clone(),
            },
        )?;
        stream.play().context("failed to start speaker")?;
        self.stream = Some(stream);
        Ok(())
    }
}

fn build_output_stream(
    device: &Device,
    supported: &SupportedStreamConfig,
    shared: OutputShared,
) -> Result<Stream> {
    let channels = supported.channels() as usize;
    let config = (*supported).into();
    let stream = match supported.sample_format() {
        SampleFormat::F32 => output_stream::<f32>(device, &config, channels, shared),
        SampleFormat::I16 => output_stream::<i16>(device, &config, channels, shared),
        SampleFormat::U16 => output_stream::<u16>(device, &config, channels, shared),
        format => anyhow::bail!("unsupported speaker sample format {format}"),
    }?;
    Ok(stream)
}

fn output_stream<T>(
    device: &Device,
    config: &cpal::StreamConfig,
    channels: usize,
    shared: OutputShared,
) -> Result<Stream, cpal::Error>
where
    T: SizedSample + FromSample<f32>,
    f32: FromSample<T>,
{
    let OutputShared {
        samples,
        rendered,
        render_dropped,
        state,
        events,
    } = shared;
    let start_samples = config.sample_rate as usize * PLAYBACK_START_MS / 1_000;
    let rate = f64::from(config.sample_rate);
    let activity_events = events.clone();
    let mut playing = false;
    let mut reference = FramePacker::default();
    let mut last_activity = None;
    let mut error_reported = false;
    device.build_output_stream(
        *config,
        move |output: &mut [T], info: &cpal::OutputCallbackInfo| {
            let control = state.get();
            let timestamp = info.timestamp();
            let start = Instant::now()
                + timestamp
                    .playback
                    .checked_duration_since(timestamp.callback)
                    .unwrap_or_default();
            let mut active = false;
            for (index, chunk) in output.chunks_mut(BLOCK * channels).enumerate() {
                let mut rendered_frame = Frame {
                    samples: [0.0; BLOCK],
                    len: chunk.len() / channels,
                    at: start + Duration::from_secs_f64((index * BLOCK) as f64 / rate),
                    generation: control.epoch,
                };
                for (frame, reference_sample) in
                    chunk.chunks_mut(channels).zip(&mut rendered_frame.samples)
                {
                    if !playing && !control.suppressed && samples.len() >= start_samples {
                        playing = true;
                    }
                    let sample = if playing && !control.suppressed {
                        loop {
                            match samples.pop() {
                                Some(sample) if sample.epoch == control.epoch => {
                                    break sample.value;
                                }
                                Some(_) => continue,
                                None => {
                                    playing = false;
                                    break 0.0;
                                }
                            }
                        }
                    } else {
                        0.0
                    };
                    let sample = if sample.is_finite() {
                        sample.clamp(-1.0, 1.0)
                    } else {
                        0.0
                    };
                    let actual = T::from_sample(sample);
                    frame.fill(actual);
                    *reference_sample = f32::from_sample(actual);
                    active |= reference_sample.abs() >= ACTIVITY_THRESHOLD;
                }
                if !reference.push(rendered_frame, rate, &rendered) {
                    reference.reset();
                    render_dropped.store(true, Ordering::Release);
                }
            }
            if active {
                let now = Instant::now();
                if last_activity.is_none_or(|last| now.duration_since(last) >= ACTIVITY_INTERVAL)
                    && activity_events.try_send(Event::PlaybackActivity).is_ok()
                {
                    last_activity = Some(now);
                }
            }
        },
        move |error| {
            eprintln!("speaker stream error: {error}");
            if error.kind() != ErrorKind::DeviceChanged && !error_reported {
                error_reported = true;
                let _ = events.try_send(Event::Error {
                    message: format!("speaker stream error: {error}"),
                });
            }
        },
        None,
    )
}
