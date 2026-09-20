//! Callback-safe frame packing and capture generation boundaries.
//!
//! Adapted from OpenAI Codex `voice-host/src/device_buffers.rs` at the
//! revision recorded in `VENDORED.md`.

use std::time::{Duration, Instant};

use crossbeam_queue::ArrayQueue;

pub(crate) const BLOCK: usize = 256;
const CAPTURE_GAP_TOLERANCE: Duration = Duration::from_millis(20);

pub(crate) struct Frame {
    pub(crate) samples: [f32; BLOCK],
    pub(crate) len: usize,
    pub(crate) at: Instant,
    pub(crate) generation: u64,
}

/// Packs serialized callbacks without allocating. Only complete blocks enter the queue.
#[derive(Default)]
pub(crate) struct FramePacker {
    frame: Option<Frame>,
}

impl FramePacker {
    pub(crate) fn reset(&mut self) {
        self.frame = None;
    }

    pub(crate) fn discard_capture_gap(&mut self, start: Instant, rate: f64) {
        if self.frame.as_ref().is_some_and(|partial| {
            let end = partial.at + Duration::from_secs_f64(partial.len as f64 / rate);
            start.saturating_duration_since(end) > CAPTURE_GAP_TOLERANCE
        }) {
            self.reset();
        }
    }

    pub(crate) fn push(&mut self, frame: Frame, rate: f64, queue: &ArrayQueue<Frame>) -> bool {
        if self
            .frame
            .as_ref()
            .is_some_and(|partial| partial.generation != frame.generation)
        {
            self.reset();
        }
        let mut offset = 0;
        while offset < frame.len {
            let partial = self.frame.get_or_insert_with(|| Frame {
                samples: [0.0; BLOCK],
                len: 0,
                at: frame.at + Duration::from_secs_f64(offset as f64 / rate),
                generation: frame.generation,
            });
            let count = (BLOCK - partial.len).min(frame.len - offset);
            partial.samples[partial.len..partial.len + count]
                .copy_from_slice(&frame.samples[offset..offset + count]);
            partial.len += count;
            offset += count;
            if partial.len == BLOCK
                && let Some(full) = self.frame.take()
                && queue.push(full).is_err()
            {
                return false;
            }
        }
        true
    }
}

/// Rejects capture backlog after unmute using offsets in the device clock.
#[derive(Default)]
pub(crate) struct CaptureBoundary {
    generation: Option<u64>,
    cutoff: Option<Duration>,
    previous_capture: Option<Duration>,
}

impl CaptureBoundary {
    pub(crate) fn accepts(
        &mut self,
        generation: u64,
        callback: Duration,
        capture: Duration,
    ) -> bool {
        if generation % 2 == 1 || self.generation != Some(generation) {
            self.generation = Some(generation);
            self.cutoff = None;
            self.previous_capture = None;
            // The current callback timestamp may have been sampled before unmute.
            return false;
        }
        let accepted = capture >= *self.cutoff.get_or_insert(callback)
            && self
                .previous_capture
                .is_none_or(|previous| capture >= previous);
        if accepted {
            self.previous_capture = Some(capture);
        }
        accepted
    }
}
