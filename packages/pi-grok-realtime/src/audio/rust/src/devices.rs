use crate::{Response, Shared};
use cpal::{
    Device, FromSample, Sample, SampleFormat, SizedSample, Stream, StreamConfig,
    traits::{DeviceTrait, HostTrait},
};
use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

pub fn list() -> Result<serde_json::Value, String> {
    let host = cpal::default_host();
    let describe = |device: Device| -> Result<serde_json::Value, String> {
        let id = device.id().map_err(|e| e.to_string())?.to_string();
        let description = device
            .description()
            .map_err(|e| e.to_string())?
            .name()
            .to_owned();
        Ok(serde_json::json!({"name": id, "description": description}))
    };
    let microphones = host
        .input_devices()
        .map_err(|e| e.to_string())?
        .map(describe)
        .collect::<Result<Vec<_>, _>>()?;
    let speakers = host
        .output_devices()
        .map_err(|e| e.to_string())?
        .map(describe)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(serde_json::json!({"microphones": microphones, "speakers": speakers}))
}
pub fn select(id: &str, input: bool) -> Result<Device, String> {
    let host = cpal::default_host();
    let kind = if input { "microphone" } else { "speaker" };
    if id.is_empty() {
        return (if input {
            host.default_input_device()
        } else {
            host.default_output_device()
        })
        .ok_or_else(|| {
            format!("No default {kind}; configure a system audio device or select one in settings")
        });
    }
    let devices = if input {
        host.input_devices()
    } else {
        host.output_devices()
    }
    .map_err(|e| e.to_string())?;
    devices
        .into_iter()
        .find(|d| d.id().is_ok_and(|candidate| candidate.to_string() == id))
        .ok_or_else(|| {
            format!("Selected {kind} is unavailable; select an available device in settings")
        })
}

fn fail(error: impl std::fmt::Display) -> ! {
    eprintln!("Audio device failed: {error}; check system audio devices and restart audio");
    std::process::exit(1)
}

macro_rules! formats {
    ($format:expr, $function:ident, $device:expr, $config:expr, $shared:expr) => {
        match $format {
            SampleFormat::I8 => $function::<i8>($device, $config, $shared),
            SampleFormat::I16 => $function::<i16>($device, $config, $shared),
            SampleFormat::I24 => $function::<cpal::I24>($device, $config, $shared),
            SampleFormat::I32 => $function::<i32>($device, $config, $shared),
            SampleFormat::I64 => $function::<i64>($device, $config, $shared),
            SampleFormat::U8 => $function::<u8>($device, $config, $shared),
            SampleFormat::U16 => $function::<u16>($device, $config, $shared),
            SampleFormat::U24 => $function::<cpal::U24>($device, $config, $shared),
            SampleFormat::U32 => $function::<u32>($device, $config, $shared),
            SampleFormat::U64 => $function::<u64>($device, $config, $shared),
            SampleFormat::F32 => $function::<f32>($device, $config, $shared),
            SampleFormat::F64 => $function::<f64>($device, $config, $shared),
            other => Err(format!(
                "Unsupported audio device format {other}; select a different device"
            )),
        }
    };
}
pub fn input(device: &Device, shared: Arc<Mutex<Shared>>) -> Result<Stream, String> {
    let supported = device
        .default_input_config()
        .map_err(|e| format!("Cannot configure microphone: {e}"))?;
    formats!(
        supported.sample_format(),
        capture,
        device,
        &supported.into(),
        shared
    )
}
pub fn output(device: &Device, shared: Arc<Mutex<Shared>>) -> Result<Stream, String> {
    let supported = device
        .default_output_config()
        .map_err(|e| format!("Cannot configure speaker: {e}"))?;
    formats!(
        supported.sample_format(),
        playback,
        device,
        &supported.into(),
        shared
    )
}
fn capture<T>(
    device: &Device,
    config: &StreamConfig,
    shared: Arc<Mutex<Shared>>,
) -> Result<Stream, String>
where
    T: SizedSample,
    f32: FromSample<T>,
{
    let channels = config.channels as usize;
    let rate = config.sample_rate as f64;
    device
        .build_input_stream(
            *config,
            move |data: &[T], info: &cpal::InputCallbackInfo| {
                let now = Instant::now();
                let timestamp = info.timestamp();
                let age = timestamp
                    .callback
                    .saturating_duration_since(timestamp.capture);
                let start = now.checked_sub(age).unwrap_or(now);
                let mut state = shared.lock().unwrap();
                if state.muted || !state.ready {
                    state.dsp.reset_capture();
                    return;
                }
                let skip = if start < state.cutoff {
                    (state.cutoff.duration_since(start).as_secs_f64() * rate).ceil() as usize
                } else {
                    0
                };
                let mono: Vec<f32> = data
                    .chunks_exact(channels)
                    .skip(skip)
                    .map(|frame| {
                        frame.iter().map(|v| f32::from_sample(*v)).sum::<f32>() / channels as f32
                    })
                    .collect();
                if mono.iter().any(|v| !v.is_finite()) {
                    fail("Invalid microphone samples");
                }
                let delay = age
                    .as_millis()
                    .saturating_add(state.render_delay.as_millis())
                    .min(i32::MAX as u128) as i32;
                let frames = state.dsp.capture(&mono, delay).unwrap_or_else(|e| fail(e));
                for frame in frames {
                    let mut payload = state.epoch.to_le_bytes().to_vec();
                    payload.extend(frame);
                    state
                        .responses
                        .send(Response(b'A', payload))
                        .unwrap_or_else(|e| fail(e));
                }
            },
            |error| fail(error),
            None,
        )
        .map_err(|e| format!("Cannot open microphone: {e}"))
}
fn playback<T>(
    device: &Device,
    config: &StreamConfig,
    shared: Arc<Mutex<Shared>>,
) -> Result<Stream, String>
where
    T: SizedSample + FromSample<f32>,
    f32: FromSample<T>,
{
    let channels = config.channels as usize;
    let rate = config.sample_rate;
    device
        .build_output_stream(
            *config,
            move |data: &mut [T], info: &cpal::OutputCallbackInfo| {
                let timestamp = info.timestamp();
                let mut state = shared.lock().unwrap();
                if state.queue.is_empty()
                    && state
                        .last_playback
                        .is_none_or(|end| timestamp.callback >= end)
                    && let Some(id) = state.drain.take()
                {
                    state
                        .responses
                        .send(Response(b'D', id.to_le_bytes().to_vec()))
                        .unwrap_or_else(|e| fail(e));
                }
                let mut reference = Vec::with_capacity(data.len() / channels);
                let mut last = None;
                for (index, frame) in data.chunks_exact_mut(channels).enumerate() {
                    let sample = if let Some(sample) = state.queue.pop_front() {
                        last = Some(index + 1);
                        sample
                    } else {
                        0.0
                    };
                    let value = T::from_sample(sample);
                    frame.fill(value);
                    // Reference reflects the samples actually submitted, including format quantization and silence.
                    reference.push(f32::from_sample(value));
                }
                if let Some(frames) = last {
                    state.last_playback = Some(
                        timestamp
                            .playback
                            .checked_add(Duration::from_secs_f64(frames as f64 / rate as f64))
                            .unwrap_or_else(|| fail("Speaker timestamp overflow")),
                    );
                }
                state.render_delay = timestamp
                    .playback
                    .saturating_duration_since(timestamp.callback);
                state.dsp.render(&reference).unwrap_or_else(|e| fail(e));
            },
            |error| fail(error),
            None,
        )
        .map_err(|e| format!("Cannot open speaker: {e}"))
}
