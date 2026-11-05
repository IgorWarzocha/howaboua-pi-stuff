use std::time::{Duration, Instant};

/// Content-free counters. Empty callbacks include normal pauses; partial callbacks
/// and short-gap empty resumes help distinguish depletion during active delivery.
#[derive(Default)]
pub struct Metrics {
    enabled: bool,
    ipc: bool,
    report: Option<Instant>,
    received: Option<Instant>,
    callback: Option<Instant>,
    waiting: Option<Instant>,
    starts: u64,
    max_start_delay_us: u128,
    last_nonzero: Option<Instant>,
    nonzero_callbacks: u64,
    packets: u64,
    callbacks: u64,
    empty: u64,
    partial: u64,
    audible_partial: u64,
    audible_resume: u64,
    zero_filled: bool,
    short_empty_resumes: u64,
    max_receive_gap_us: u128,
    max_callback_gap_us: u128,
    max_queue_frames: usize,
    min_callback_frames: Option<usize>,
    max_callback_frames: usize,
    clears: u64,
    drain_requests: u64,
    drain_acks: u64,
    pub input_xruns: u64,
    pub output_xruns: u64,
    held_callbacks: u64,
    zero_frames: u64,
    quiet_padding_frames: u64,
}

impl Metrics {
    pub fn new() -> Self {
        let mode = std::env::var("GROK_AUDIO_DIAGNOSTICS").unwrap_or_default();
        Self {
            enabled: mode == "1" || mode == "ipc",
            ipc: mode == "ipc",
            ..Self::default()
        }
    }

    pub fn clear(&mut self) {
        self.clears += 1;
        self.waiting = None;
        self.zero_filled = false;
    }

    pub fn drain(&mut self, acknowledged: bool) {
        if acknowledged {
            self.drain_acks += 1;
        } else {
            self.drain_requests += 1;
        }
    }

    /// Copy/reset scalar state under the audio lock; allocate JSON only after release.
    pub fn snapshot(&mut self, queued: usize, rate: u32, delay_us: u128) -> Snapshot {
        let now = Instant::now();
        let next = Self {
            enabled: self.enabled,
            ipc: self.ipc,
            report: Some(now),
            received: self.received,
            callback: self.callback,
            waiting: self.waiting,
            zero_filled: self.zero_filled,
            last_nonzero: self.last_nonzero,
            ..Self::default()
        };
        Snapshot {
            metrics: std::mem::replace(self, next),
            now,
            queued,
            rate,
            delay_us,
        }
    }

    pub fn receive(&mut self, queued: usize, rate: u32) -> Option<String> {
        if !self.enabled {
            return None;
        }
        let now = Instant::now();
        if queued == 0 && self.waiting.is_none() {
            self.waiting = Some(now);
        }
        if let Some(previous) = self.received.replace(now) {
            let gap = now.duration_since(previous);
            self.max_receive_gap_us = self.max_receive_gap_us.max(gap.as_micros());
            if queued == 0 && gap <= Duration::from_millis(60) {
                self.short_empty_resumes += 1;
            }
        }
        self.packets += 1;
        self.max_queue_frames = self.max_queue_frames.max(queued);
        let start = *self.report.get_or_insert(now);
        if !self.ipc && now.duration_since(start) >= Duration::from_secs(5) {
            let report = format!(
                "Audio playback metadata: interval_ms={} packets={} callbacks={} empty_callbacks={} partial_callbacks={} nonzero_partial_callbacks={} nonzero_resumes={} empty_resumes_within_60ms={} max_receive_gap_us={} max_callback_gap_us={} max_queue_frames={} callback_frames_min={} callback_frames_max={} starts={} max_start_delay_us={} nonzero_callbacks={} last_nonzero_age_ms={} rate={}",
                now.duration_since(start).as_millis(),
                self.packets,
                self.callbacks,
                self.empty,
                self.partial,
                self.audible_partial,
                self.audible_resume,
                self.short_empty_resumes,
                self.max_receive_gap_us,
                self.max_callback_gap_us,
                self.max_queue_frames,
                self.min_callback_frames.unwrap_or(0),
                self.max_callback_frames,
                self.starts,
                self.max_start_delay_us,
                self.nonzero_callbacks,
                self.last_nonzero
                    .map_or(0, |last| now.duration_since(last).as_millis()),
                rate
            );
            *self = Self {
                enabled: self.enabled,
                report: Some(now),
                received: self.received,
                callback: self.callback,
                zero_filled: self.zero_filled,
                waiting: self.waiting,
                last_nonzero: self.last_nonzero,
                ..Self::default()
            };
            return Some(report);
        }
        None
    }

    pub fn activity(&mut self, samples: &[f32]) {
        if self.enabled && samples.iter().any(|sample| sample.abs() > 0.005) {
            self.last_nonzero = Some(Instant::now());
            self.nonzero_callbacks += 1;
        }
    }

    pub fn render(
        &mut self,
        queued: usize,
        frames: usize,
        first: f32,
        last: f32,
        held: bool,
        padding: usize,
    ) {
        if !self.enabled {
            return;
        }
        let now = Instant::now();
        if queued > 0
            && let Some(start) = self.waiting.take()
        {
            self.starts += 1;
            self.max_start_delay_us = self
                .max_start_delay_us
                .max(now.duration_since(start).as_micros());
        }
        if let Some(previous) = self.callback.replace(now) {
            self.max_callback_gap_us = self
                .max_callback_gap_us
                .max(now.duration_since(previous).as_micros());
        }
        self.callbacks += 1;
        self.held_callbacks += u64::from(held);
        let supplied = queued.saturating_add(padding);
        self.quiet_padding_frames += padding as u64;
        self.zero_frames += (padding + frames.saturating_sub(supplied)) as u64;
        self.empty += u64::from(supplied == 0);
        self.partial += u64::from(supplied > 0 && supplied < frames);
        // A >0.5% full-scale cut to/from inserted zeros is a discontinuity,
        // not an audio recording or a claim of subjective audibility.
        self.audible_partial += u64::from(supplied > 0 && supplied < frames && last.abs() > 0.005);
        self.audible_resume += u64::from(self.zero_filled && supplied > 0 && first.abs() > 0.005);
        self.zero_filled = supplied < frames;
        self.max_queue_frames = self.max_queue_frames.max(queued);
        self.min_callback_frames = Some(
            self.min_callback_frames
                .map_or(frames, |min| min.min(frames)),
        );
        self.max_callback_frames = self.max_callback_frames.max(frames);
    }
}

pub struct Snapshot {
    metrics: Metrics,
    now: Instant,
    queued: usize,
    rate: u32,
    delay_us: u128,
}

impl Snapshot {
    /// Call outside Shared's mutex: JSON construction allocates.
    pub fn json(self) -> serde_json::Value {
        let Self {
            metrics: m,
            now,
            queued,
            rate,
            delay_us,
        } = self;
        serde_json::json!({
            "window_ms": m.report.map_or(0, |start| now.duration_since(start).as_millis()),
            "packets": m.packets, "callbacks": m.callbacks,
            "empty_callbacks": m.empty, "partial_callbacks": m.partial,
            "nonzero_partial_callbacks": m.audible_partial, "nonzero_resumes": m.audible_resume,
            "nonzero_callbacks": m.nonzero_callbacks,
            "receive_age_ms": m.received.map(|last| now.duration_since(last).as_millis()),
            "callback_age_ms": m.callback.map(|last| now.duration_since(last).as_millis()),
            "nonzero_age_ms": m.last_nonzero.map(|last| now.duration_since(last).as_millis()),
            "max_receive_gap_us": m.max_receive_gap_us, "max_callback_gap_us": m.max_callback_gap_us,
            "queue_frames": queued, "max_queue_frames": m.max_queue_frames,
            "callback_frames_min": m.min_callback_frames, "callback_frames_max": m.max_callback_frames,
            "starts": m.starts, "max_start_delay_us": m.max_start_delay_us,
            "clears": m.clears, "drain_requests": m.drain_requests, "drain_acks": m.drain_acks,
            "input_xruns": m.input_xruns, "output_xruns": m.output_xruns,
            "rate": rate, "device_delay_us": delay_us,
            "held_callbacks": m.held_callbacks, "inserted_zero_frames": m.zero_frames,
            "quiet_padding_frames": m.quiet_padding_frames,
        })
    }
}
