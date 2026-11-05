use std::{
    collections::VecDeque,
    time::{Duration, Instant},
};

// A measured 298ms arrival stall plus host restart and callback slack.
const RESERVE_MS: usize = 350;
const QUIET: f32 = 0.001;

/// Replenish lost playout slack at quiet boundaries, before starvation cuts a word.
/// Only pauses expand: every source sample retains its order and playback rate.
#[derive(Default)]
pub struct PlaybackBuffer {
    playing: bool,
    waiting: Option<Instant>,
    quiet_frames: usize,
    padded_frames: usize,
}

impl PlaybackBuffer {
    pub fn ready(
        &mut self,
        queued: usize,
        rate: u32,
        frames: usize,
        draining: bool,
        now: Instant,
    ) -> bool {
        if queued == 0 {
            self.playing = false;
            self.waiting = None;
            return false;
        }
        let since = *self.waiting.get_or_insert(now);
        // Streaming interpolation retains one 24kHz boundary sample.
        let target = (rate as usize * RESERVE_MS / 1000 + frames)
            .saturating_sub(rate.div_ceil(24_000) as usize);
        if draining
            || queued >= target.max(1)
            || now.duration_since(since) >= Duration::from_secs_f64(target as f64 / rate as f64)
        {
            self.playing = true;
        }
        self.playing
    }

    pub fn padding(
        &mut self,
        queue: &VecDeque<f32>,
        rate: u32,
        frames: usize,
        draining: bool,
    ) -> usize {
        let rate = rate as usize;
        let guard = (rate / 100).max(1);
        let missing = (rate * RESERVE_MS / 1000 + frames).saturating_sub(queue.len());
        let budget = (rate * 80 / 1000).saturating_sub(self.padded_frames);
        if draining
            || !self.playing
            || missing == 0
            || budget == 0
            || self.quiet_frames < guard
            || queue.len() < guard
            || queue.iter().take(guard).any(|sample| sample.abs() > QUIET)
        {
            return 0;
        }
        // Require 10ms of quiet on both sides, and add at most 80ms to one pause.
        // Stop padding immediately when a drain requests the remaining real audio.
        let padding = missing.min(budget).min(frames).min(rate * 20 / 1000);
        self.padded_frames += padding;
        padding
    }

    pub fn played(&mut self, sample: f32, rate: u32) {
        if sample.abs() <= QUIET {
            self.quiet_frames = (self.quiet_frames + 1).min((rate as usize / 100).max(1));
        } else {
            self.quiet_frames = 0;
            self.padded_frames = 0;
        }
    }

    pub fn depleted(&mut self) {
        *self = Self::default();
    }
}
