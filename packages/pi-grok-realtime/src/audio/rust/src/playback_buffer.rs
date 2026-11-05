use std::time::{Duration, Instant};

/// Device callbacks run independently of 20ms transport packets. Seven packets
/// leave about 120ms of steady playout slack for brief delivery stalls.
/// Rebuild after depletion instead of chopping packets into short writes followed
/// by zeros. Bound the wait for short tails; explicit drains bypass it.
#[derive(Default)]
pub struct PlaybackBuffer {
    playing: bool,
    waiting: Option<Instant>,
}

impl PlaybackBuffer {
    pub fn ready(&mut self, queued: usize, rate: u32, draining: bool, now: Instant) -> bool {
        if queued == 0 {
            self.playing = false;
            self.waiting = None;
            return false;
        }
        let since = *self.waiting.get_or_insert(now);
        // Streaming interpolation retains one 24kHz boundary sample.
        let target = (rate as usize * 140 / 1000).saturating_sub(rate.div_ceil(24_000) as usize);
        if draining
            || queued >= target.max(1)
            || now.duration_since(since) >= Duration::from_millis(140)
        {
            self.playing = true;
        }
        self.playing
    }

    pub fn depleted(&mut self) {
        *self = Self::default();
    }
}
