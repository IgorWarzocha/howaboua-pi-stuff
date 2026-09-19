use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{
    Device, ErrorKind, FromSample, Sample, SampleFormat, SizedSample, Stream, SupportedStreamConfig,
};
use crossbeam_queue::ArrayQueue;
use tokio::sync::mpsc;

use crate::codex_audio::buffers::{BLOCK, CaptureBoundary, Frame, FramePacker};
use crate::protocol::{AudioDevice, Event, MAX_DEVICE_BYTES, MAX_DEVICES, MAX_SAFE_INTEGER};

const CAPTURE_QUEUE_FRAMES: usize = 192;
const RENDER_QUEUE_FRAMES: usize = 192;
const PLAYBACK_QUEUE_MS: usize = 500;
const PLAYBACK_START_MS: usize = 100;
const ACTIVITY_INTERVAL: Duration = Duration::from_millis(100);
const ACTIVITY_THRESHOLD: f32 = 0.0001;

pub struct Capture {
    _stream: Stream,
    pub frames: Arc<ArrayQueue<Frame>>,
    pub sample_rate: u32,
    pub generation: Arc<AtomicU64>,
    pub dropped: Arc<AtomicBool>,
    pub failed: Arc<AtomicBool>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SpeakerControl {
    pub epoch: u64,
    pub suppressed: bool,
}

impl SpeakerControl {
    pub fn accepts_packet(self, desired: Self) -> bool {
        !self.suppressed && self == desired
    }
}

pub struct SpeakerState {
    packed: AtomicU64,
}

impl SpeakerState {
    pub fn new() -> Self {
        Self {
            packed: AtomicU64::new(0),
        }
    }

    pub fn get(&self) -> SpeakerControl {
        let packed = self.packed.load(Ordering::Acquire);
        SpeakerControl {
            epoch: packed >> 1,
            suppressed: packed & 1 == 1,
        }
    }

    pub fn transition(&self, suppressed: bool, epoch: u64) -> Result<SpeakerControl> {
        if epoch > MAX_SAFE_INTEGER {
            anyhow::bail!("speaker epoch exceeds the JavaScript safe integer range");
        }
        let current = self.get();
        if epoch <= current.epoch {
            anyhow::bail!("speaker epoch must increase on every transition");
        }
        if suppressed == current.suppressed {
            anyhow::bail!("speaker suppression command does not describe a transition");
        }
        let next = SpeakerControl { epoch, suppressed };
        self.packed
            .compare_exchange(
                (current.epoch << 1) | u64::from(current.suppressed),
                (epoch << 1) | u64::from(suppressed),
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .map_err(|_| anyhow::anyhow!("concurrent speaker transition"))?;
        Ok(next)
    }
}

#[derive(Clone, Copy)]
pub struct PlaybackSample {
    pub value: f32,
    pub epoch: u64,
}

pub struct Playback {
    stream: Option<Stream>,
    device: Device,
    supported: SupportedStreamConfig,
    events: mpsc::Sender<Event>,
    pub samples: Arc<ArrayQueue<PlaybackSample>>,
    pub rendered: Arc<ArrayQueue<Frame>>,
    pub render_dropped: Arc<AtomicBool>,
    pub sample_rate: u32,
    pub state: Arc<SpeakerState>,
}

#[derive(Clone)]
struct OutputShared {
    samples: Arc<ArrayQueue<PlaybackSample>>,
    rendered: Arc<ArrayQueue<Frame>>,
    render_dropped: Arc<AtomicBool>,
    state: Arc<SpeakerState>,
    events: mpsc::Sender<Event>,
}

pub fn devices() -> Result<(Vec<AudioDevice>, Vec<AudioDevice>)> {
    let host = cpal::default_host();
    let default_input_id = host
        .default_input_device()
        .and_then(|device| device.id().ok());
    let default_output_id = host
        .default_output_device()
        .and_then(|device| device.id().ok());
    let inputs = host
        .input_devices()?
        .filter_map(|device| describe_device(device, default_input_id.as_ref()))
        .take(MAX_DEVICES)
        .collect();
    let outputs = host
        .output_devices()?
        .filter_map(|device| describe_device(device, default_output_id.as_ref()))
        .take(MAX_DEVICES)
        .collect();
    Ok((inputs, outputs))
}

fn describe_device(device: Device, default_id: Option<&cpal::DeviceId>) -> Option<AudioDevice> {
    let id = device.id().ok()?;
    let id = id.to_string();
    if id.len() > MAX_DEVICE_BYTES {
        return None;
    }
    let mut name = device
        .description()
        .map(|description| description.name().to_owned())
        .unwrap_or_else(|_| id.clone());
    while name.len() > MAX_DEVICE_BYTES {
        name.pop();
    }
    Some(AudioDevice {
        is_default: default_id.is_some_and(|candidate| candidate.to_string() == id),
        name,
        id,
    })
}

pub fn capture(device_id: Option<&str>) -> Result<Capture> {
    let host = cpal::default_host();
    if let Some(id) = device_id {
        let device = host
            .input_devices()?
            .find(|device| {
                device
                    .id()
                    .is_ok_and(|candidate| candidate.to_string() == id)
            })
            .context("no microphone device available")?;
        return capture_device(device);
    }
    let device = host
        .default_input_device()
        .context("no default microphone configured")?;
    capture_device(device).context("failed to open the default microphone")
}

fn capture_device(device: Device) -> Result<Capture> {
    let supported = device
        .default_input_config()
        .context("microphone has no default input format")?;
    validate_config(&supported)?;
    let sample_rate = supported.sample_rate();
    let frames = Arc::new(ArrayQueue::new(CAPTURE_QUEUE_FRAMES));
    let generation = Arc::new(AtomicU64::new(0));
    let dropped = Arc::new(AtomicBool::new(false));
    let failed = Arc::new(AtomicBool::new(false));
    let stream = build_input_stream(
        &device,
        &supported,
        Arc::clone(&frames),
        Arc::clone(&generation),
        Arc::clone(&dropped),
        Arc::clone(&failed),
    )?;
    stream.play().context("failed to start microphone")?;
    Ok(Capture {
        _stream: stream,
        frames,
        sample_rate,
        generation,
        dropped,
        failed,
    })
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

fn build_input_stream(
    device: &Device,
    supported: &SupportedStreamConfig,
    queue: Arc<ArrayQueue<Frame>>,
    generation: Arc<AtomicU64>,
    dropped: Arc<AtomicBool>,
    failed: Arc<AtomicBool>,
) -> Result<Stream> {
    let channels = supported.channels() as usize;
    let config = (*supported).into();
    let stream = match supported.sample_format() {
        SampleFormat::F32 => input_stream::<f32>(
            device, &config, channels, queue, generation, dropped, failed,
        ),
        SampleFormat::I16 => input_stream::<i16>(
            device, &config, channels, queue, generation, dropped, failed,
        ),
        SampleFormat::U16 => input_stream::<u16>(
            device, &config, channels, queue, generation, dropped, failed,
        ),
        format => anyhow::bail!("unsupported microphone sample format {format}"),
    }?;
    Ok(stream)
}

fn input_stream<T>(
    device: &Device,
    config: &cpal::StreamConfig,
    channels: usize,
    queue: Arc<ArrayQueue<Frame>>,
    generation: Arc<AtomicU64>,
    dropped: Arc<AtomicBool>,
    failed: Arc<AtomicBool>,
) -> Result<Stream, cpal::Error>
where
    T: SizedSample,
    f32: FromSample<T>,
{
    let rate = f64::from(config.sample_rate);
    let failure = Arc::clone(&failed);
    let mut origin = None;
    let mut boundary = CaptureBoundary::default();
    let mut capture = FramePacker::default();
    device.build_input_stream(
        *config,
        move |input: &[T], info: &cpal::InputCallbackInfo| {
            let current = generation.load(Ordering::Acquire);
            if current % 2 == 1 {
                capture.reset();
                return;
            }
            let timestamp = info.timestamp();
            let origin = origin.get_or_insert(timestamp.capture);
            let (Some(callback), Some(captured)) = (
                timestamp.callback.checked_duration_since(*origin),
                timestamp.capture.checked_duration_since(*origin),
            ) else {
                capture.reset();
                return;
            };
            if !boundary.accepts(current, callback, captured) {
                capture.reset();
                return;
            }
            let start = Instant::now()
                .checked_sub(
                    timestamp
                        .callback
                        .checked_duration_since(timestamp.capture)
                        .unwrap_or_default(),
                )
                .unwrap_or_else(Instant::now);
            capture.discard_capture_gap(start, rate);
            for (index, chunk) in input.chunks(BLOCK * channels).enumerate() {
                let mut frame = Frame {
                    samples: [0.0; BLOCK],
                    len: chunk.len() / channels,
                    at: start + Duration::from_secs_f64((index * BLOCK) as f64 / rate),
                    generation: current,
                };
                for (output, source) in frame.samples.iter_mut().zip(chunk.chunks_exact(channels)) {
                    *output = source
                        .iter()
                        .map(|sample| f32::from_sample(*sample))
                        .sum::<f32>()
                        / channels as f32;
                    if !output.is_finite() {
                        failure.store(true, Ordering::Release);
                        capture.reset();
                        return;
                    }
                }
                if !capture.push(frame, rate, &queue) {
                    capture.reset();
                    dropped.store(true, Ordering::Release);
                    return;
                }
            }
        },
        move |error| {
            eprintln!("microphone stream error: {error}");
            if error.kind() != ErrorKind::Xrun {
                failed.store(true, Ordering::Release);
            }
        },
        None,
    )
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

fn validate_config(config: &SupportedStreamConfig) -> Result<()> {
    if config.channels() == 0 || !(8_000..=384_000).contains(&config.sample_rate()) {
        anyhow::bail!("unsupported audio device configuration");
    }
    Ok(())
}

pub fn push_latest<T>(queue: &ArrayQueue<T>, value: T) {
    if let Err(value) = queue.push(value) {
        let _ = queue.pop();
        let _ = queue.push(value);
    }
}

pub fn clear<T>(queue: &ArrayQueue<T>) {
    for _ in 0..queue.capacity() {
        if queue.pop().is_none() {
            break;
        }
    }
}

pub fn drain(queue: &ArrayQueue<f32>, limit: usize, output: &mut Vec<f32>) {
    for _ in 0..limit {
        let Some(sample) = queue.pop() else { break };
        output.push(sample);
    }
}

#[cfg(test)]
mod tests {
    use std::task::Poll;

    use super::*;

    #[tokio::test]
    async fn audio_queues_generations_and_sends_have_hard_boundaries() {
        let queue = ArrayQueue::new(2);
        push_latest(&queue, 1.0);
        push_latest(&queue, 2.0);
        push_latest(&queue, 3.0);
        assert_eq!(queue.pop(), Some(2.0));
        assert_eq!(queue.pop(), Some(3.0));

        let state = SpeakerState::new();
        let initial = state.get();
        assert!(initial.accepts_packet(initial));
        assert_eq!(
            state.transition(true, 1).unwrap(),
            SpeakerControl {
                epoch: 1,
                suppressed: true,
            }
        );
        assert!(!initial.accepts_packet(state.get()));
        assert!(state.transition(false, 1).is_err());
        let resumed = state.transition(false, 2).unwrap();
        assert_eq!(
            resumed,
            SpeakerControl {
                epoch: 2,
                suppressed: false,
            }
        );
        assert!(resumed.accepts_packet(state.get()));

        let mut boundary = CaptureBoundary::default();
        for (generation, callback_ms, capture_ms, accepted) in [
            (1, 20, 10, false),
            (2, 21, 15, false),
            (2, 25, 22, false),
            (2, 27, 25, true),
            (4, 30, 29, false),
            (4, 34, 31, false),
            (4, 36, 34, true),
        ] {
            assert_eq!(
                boundary.accepts(
                    generation,
                    Duration::from_millis(callback_ms),
                    Duration::from_millis(capture_ms),
                ),
                accepted,
            );
        }

        assert!(
            crate::v3_media::with_send_deadline(std::future::pending::<()>())
                .await
                .is_err()
        );

        fn queued_read(
            remaining: Arc<std::sync::atomic::AtomicUsize>,
        ) -> impl std::future::Future<Output = std::result::Result<(), ()>> {
            std::future::poll_fn(move |_| {
                remaining
                    .fetch_update(Ordering::AcqRel, Ordering::Acquire, |count| {
                        count.checked_sub(1)
                    })
                    .map_or(Poll::Pending, |_| Poll::Ready(Ok(())))
            })
        }

        let budget = crate::v3_media::TRANSITION_DRAIN_PACKET_BUDGET;
        let remaining = Arc::new(std::sync::atomic::AtomicUsize::new(budget));
        let mut read = Box::pin(queued_read(Arc::clone(&remaining)));
        assert_eq!(
            crate::v3_media::drain_ready_packets(&mut read, || {
                Box::pin(queued_read(Arc::clone(&remaining)))
            }),
            crate::v3_media::ReadyDrain::Pending
        );
        assert_eq!(remaining.load(Ordering::Acquire), 0);
        remaining.store(1, Ordering::Release);
        assert_eq!(
            crate::v3_media::drain_ready_packets(&mut read, || {
                Box::pin(queued_read(Arc::clone(&remaining)))
            }),
            crate::v3_media::ReadyDrain::Pending
        );
        assert_eq!(remaining.load(Ordering::Acquire), 0);

        let remaining = Arc::new(std::sync::atomic::AtomicUsize::new(budget + 1));
        let mut read = Box::pin(queued_read(Arc::clone(&remaining)));
        assert_eq!(
            crate::v3_media::drain_ready_packets(&mut read, || {
                Box::pin(queued_read(Arc::clone(&remaining)))
            }),
            crate::v3_media::ReadyDrain::Exhausted
        );
    }
}
