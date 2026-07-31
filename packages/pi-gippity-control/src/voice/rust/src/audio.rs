use std::sync::Arc;

use anyhow::{Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, FromSample, Sample, SampleFormat, SizedSample, Stream, SupportedStreamConfig};
use crossbeam_queue::ArrayQueue;
use tokio::sync::mpsc;

use crate::protocol::{AudioDevice, Event, MAX_DEVICE_BYTES, MAX_DEVICES};

const CAPTURE_QUEUE_MS: usize = 100;
const PLAYBACK_QUEUE_MS: usize = 500;
const PLAYBACK_START_MS: usize = 100;

pub struct Capture {
    _stream: Stream,
    pub samples: Arc<ArrayQueue<f32>>,
    pub sample_rate: u32,
}

pub struct Playback {
    _stream: Stream,
    pub samples: Arc<ArrayQueue<f32>>,
    pub sample_rate: u32,
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
    let sample_rate = supported.sample_rate();
    let samples = Arc::new(ArrayQueue::new(
        sample_rate as usize * CAPTURE_QUEUE_MS / 1_000,
    ));
    let stream = build_input_stream(&device, &supported, Arc::clone(&samples))?;
    stream.play().context("failed to start microphone")?;
    Ok(Capture {
        _stream: stream,
        samples,
        sample_rate,
    })
}

pub fn playback(device_id: Option<&str>, events: mpsc::Sender<Event>) -> Result<Playback> {
    let host = cpal::default_host();
    if let Some(id) = device_id {
        let device = host
            .output_devices()?
            .find(|device| {
                device
                    .id()
                    .is_ok_and(|candidate| candidate.to_string() == id)
            })
            .context("no speaker device available")?;
        return playback_device(device, events);
    }
    let device = host
        .default_output_device()
        .context("no default speaker configured")?;
    playback_device(device, events).context("failed to open the default speaker")
}

fn playback_device(device: Device, events: mpsc::Sender<Event>) -> Result<Playback> {
    let supported = device
        .default_output_config()
        .context("speaker has no default output format")?;
    let sample_rate = supported.sample_rate();
    let samples = Arc::new(ArrayQueue::new(
        sample_rate as usize * PLAYBACK_QUEUE_MS / 1_000,
    ));
    let stream = build_output_stream(&device, &supported, Arc::clone(&samples), events)?;
    stream.play().context("failed to start speaker")?;
    Ok(Playback {
        _stream: stream,
        samples,
        sample_rate,
    })
}

fn build_input_stream(
    device: &Device,
    supported: &SupportedStreamConfig,
    queue: Arc<ArrayQueue<f32>>,
) -> Result<Stream> {
    let channels = supported.channels() as usize;
    let config = (*supported).into();
    let stream = match supported.sample_format() {
        SampleFormat::F32 => input_stream::<f32>(device, &config, channels, queue),
        SampleFormat::I16 => input_stream::<i16>(device, &config, channels, queue),
        SampleFormat::U16 => input_stream::<u16>(device, &config, channels, queue),
        format => anyhow::bail!("unsupported microphone sample format {format}"),
    }?;
    Ok(stream)
}

fn input_stream<T>(
    device: &Device,
    config: &cpal::StreamConfig,
    channels: usize,
    queue: Arc<ArrayQueue<f32>>,
) -> Result<Stream, cpal::Error>
where
    T: SizedSample,
    f32: FromSample<T>,
{
    device.build_input_stream(
        *config,
        move |input: &[T], _| {
            for frame in input.chunks_exact(channels) {
                let mono =
                    frame.iter().copied().map(f32::from_sample).sum::<f32>() / channels as f32;
                push_latest(&queue, mono);
            }
        },
        |error| eprintln!("microphone stream error: {error}"),
        None,
    )
}

fn build_output_stream(
    device: &Device,
    supported: &SupportedStreamConfig,
    queue: Arc<ArrayQueue<f32>>,
    events: mpsc::Sender<Event>,
) -> Result<Stream> {
    let channels = supported.channels() as usize;
    let config = (*supported).into();
    let stream = match supported.sample_format() {
        SampleFormat::F32 => output_stream::<f32>(device, &config, channels, queue, events),
        SampleFormat::I16 => output_stream::<i16>(device, &config, channels, queue, events),
        SampleFormat::U16 => output_stream::<u16>(device, &config, channels, queue, events),
        format => anyhow::bail!("unsupported speaker sample format {format}"),
    }?;
    Ok(stream)
}

fn output_stream<T>(
    device: &Device,
    config: &cpal::StreamConfig,
    channels: usize,
    queue: Arc<ArrayQueue<f32>>,
    events: mpsc::Sender<Event>,
) -> Result<Stream, cpal::Error>
where
    T: SizedSample + FromSample<f32>,
{
    let start_samples = config.sample_rate as usize * PLAYBACK_START_MS / 1_000;
    let mut playing = false;
    let mut error_reported = false;
    device.build_output_stream(
        *config,
        move |output: &mut [T], _| {
            for frame in output.chunks_exact_mut(channels) {
                if !playing && queue.len() >= start_samples {
                    playing = true;
                }
                let sample = if playing {
                    queue.pop().unwrap_or_else(|| {
                        playing = false;
                        0.0
                    })
                } else {
                    0.0
                };
                for channel in frame {
                    *channel = T::from_sample(sample);
                }
            }
        },
        move |error| {
            eprintln!("speaker stream error: {error}");
            if !error_reported {
                error_reported = true;
                let _ = events.try_send(Event::Error {
                    message: format!("speaker stream error: {error}"),
                });
            }
        },
        None,
    )
}

pub fn push_latest(queue: &ArrayQueue<f32>, sample: f32) {
    if queue.push(sample).is_err() {
        let _ = queue.pop();
        let _ = queue.push(sample);
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
    use super::*;

    #[test]
    fn bounded_audio_queue_keeps_the_newest_samples() {
        let queue = ArrayQueue::new(2);
        push_latest(&queue, 1.0);
        push_latest(&queue, 2.0);
        push_latest(&queue, 3.0);
        assert_eq!(queue.pop(), Some(2.0));
        assert_eq!(queue.pop(), Some(3.0));
    }
}
