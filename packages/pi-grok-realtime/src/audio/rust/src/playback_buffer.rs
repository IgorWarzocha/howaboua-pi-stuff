use std::{
    collections::VecDeque,
    time::{Duration, Instant},
};

// Consecutive delivery stalls consumed more than 350ms within one spoken phrase.
const RESERVE_MS: usize = 500;
const RECOVERY_MS: usize = 40;
const QUIET: f32 = 0.001;

#[derive(Default)]
enum Phase {
    #[default]
    Priming,
    Playing,
    Recovering {
        empty: Instant,
        quiet: bool,
    },
}

/// Replenish lost playout slack at quiet boundaries, before starvation cuts a word.
/// Only pauses expand: every source sample retains its order and playback rate.
#[derive(Default)]
pub struct PlaybackBuffer {
    phase: Phase,
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
            if matches!(self.phase, Phase::Playing) {
                self.depleted(now, rate);
            }
            self.waiting = None;
            return false;
        }
        if matches!(self.phase, Phase::Playing) {
            return true;
        }
        // A quiet end followed by idle may begin a new reply. A mid-word underrun
        // must never become another full startup wait, however late its successor.
        if let Phase::Recovering { empty, quiet: true } = self.phase
            && self.waiting.is_none()
            && now.saturating_duration_since(empty) >= Duration::from_millis(RESERVE_MS as u64)
        {
            self.phase = Phase::Priming;
        }
        let reserve = if matches!(self.phase, Phase::Priming) {
            RESERVE_MS
        } else {
            RECOVERY_MS
        };
        let since = *self.waiting.get_or_insert(now);
        // Streaming interpolation retains one 24kHz boundary sample.
        let target = (rate as usize * reserve / 1000 + frames)
            .saturating_sub(rate.div_ceil(24_000) as usize);
        let wait = if matches!(self.phase, Phase::Priming) {
            Duration::from_secs_f64(target as f64 / rate as f64)
        } else {
            Duration::from_millis(RECOVERY_MS as u64)
        };
        if draining || queued >= target.max(1) || now.duration_since(since) >= wait {
            self.phase = Phase::Playing;
            self.waiting = None;
        }
        matches!(self.phase, Phase::Playing)
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
        let budget = (rate * RESERVE_MS / 1000).saturating_sub(self.padded_frames);
        if draining
            || !matches!(self.phase, Phase::Playing)
            || missing == 0
            || budget == 0
            || self.quiet_frames < guard
            || queue.len() < guard
            || queue.iter().take(guard).any(|sample| sample.abs() > QUIET)
        {
            return 0;
        }
        // Require 10ms of quiet on both sides. A pause may restore one full reserve,
        // but not grow indefinitely while the source has stopped delivering.
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

    pub fn depleted(&mut self, now: Instant, rate: u32) {
        *self = Self {
            phase: Phase::Recovering {
                empty: now,
                quiet: self.quiet_frames >= (rate as usize / 100).max(1),
            },
            ..Self::default()
        };
    }

    pub fn reset(&mut self) {
        *self = Self::default();
    }
}
