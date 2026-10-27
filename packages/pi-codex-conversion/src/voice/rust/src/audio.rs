mod capture;
mod playback;

pub use capture::capture;
pub use playback::playback;

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use anyhow::Result;
use cpal::traits::{DeviceTrait, HostTrait};
use cpal::{Device, Stream, SupportedStreamConfig};
use crossbeam_queue::ArrayQueue;
use tokio::sync::mpsc;

use crate::codex_audio::buffers::Frame;
use crate::protocol::{AudioDevice, Event, MAX_DEVICE_BYTES, MAX_DEVICES, MAX_SAFE_INTEGER};

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
    use std::time::Duration;

    use crate::codex_audio::buffers::CaptureBoundary;

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
