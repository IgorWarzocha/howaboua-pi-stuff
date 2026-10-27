use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{
    Device, ErrorKind, FromSample, Sample, SampleFormat, SizedSample, Stream, SupportedStreamConfig,
};
use crossbeam_queue::ArrayQueue;

use super::{Capture, validate_config};
use crate::codex_audio::buffers::{BLOCK, CaptureBoundary, Frame, FramePacker};

const CAPTURE_QUEUE_FRAMES: usize = 192;

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
