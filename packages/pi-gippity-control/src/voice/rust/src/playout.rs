use std::collections::BTreeMap;
use std::time::Duration;

use bytes::Bytes;
use tokio::time::Instant;

const START_PACKETS: usize = 3;
// Retain the reorder warmup, but never strand a short utterance or resumed tail.
const MAX_BUFFERING_WAIT: Duration = Duration::from_millis(60);
const MAX_SEQUENCE_DISTANCE: usize = 6;
const MAX_PENDING_PACKETS: usize = MAX_SEQUENCE_DISTANCE + 1;

#[derive(Debug, PartialEq)]
pub enum PlayoutFrame {
    Buffering,
    Packet(Bytes),
    Missing { successor: Option<Bytes> },
}

pub enum PacketAdmission {
    // Reordering within the pending window, not a network loss estimate.
    Accepted { reordered: bool },
    // Includes already-played duplicates; only pending duplicates are distinct.
    Late,
    Duplicate,
    Resynchronized { discarded: usize },
}

pub struct PacketPlayout {
    pending: BTreeMap<i64, Bytes>,
    expected: Option<i64>,
    playing: bool,
    buffering_since: Option<Instant>,
}

pub struct PlayoutClock {
    deadline: Option<Instant>,
}

impl PlayoutClock {
    pub fn new() -> Self {
        Self { deadline: None }
    }

    pub fn start(&mut self, now: Instant) {
        self.deadline.get_or_insert(now);
    }

    pub fn deadline(&self) -> Option<Instant> {
        self.deadline
    }

    pub fn advance(&mut self, samples: usize, sample_rate: u32) -> bool {
        let Some(deadline) = self.deadline else {
            return false;
        };
        let frame_duration = Duration::from_secs_f64(samples as f64 / sample_rate as f64);
        let now = Instant::now();
        let late = now.saturating_duration_since(deadline) >= frame_duration;
        // Small scheduler jitter preserves cadence. A full missed frame rebases
        // without discarding audio or emitting a run of immediately due frames.
        self.deadline = Some(if late { now } else { deadline } + frame_duration);
        late
    }

    pub fn stop(&mut self) {
        self.deadline = None;
    }
}

impl PacketPlayout {
    pub fn new() -> Self {
        Self {
            pending: BTreeMap::new(),
            expected: None,
            playing: false,
            buffering_since: None,
        }
    }

    pub fn push(&mut self, sequence: u16, payload: Bytes) -> PacketAdmission {
        let expected = *self.expected.get_or_insert(sequence as i64);
        let delta = sequence.wrapping_sub(expected as u16) as i16 as i64;
        let extended = expected + delta;
        let mut admission = PacketAdmission::Accepted {
            reordered: self
                .pending
                .keys()
                .next_back()
                .is_some_and(|last| *last > extended),
        };
        if extended < expected {
            if self.playing || expected - extended > MAX_SEQUENCE_DISTANCE as i64 {
                return PacketAdmission::Late;
            }
            self.expected = Some(extended);
        } else if extended - expected > MAX_SEQUENCE_DISTANCE as i64 {
            admission = PacketAdmission::Resynchronized {
                discarded: self.pending.len(),
            };
            self.pending.clear();
            self.expected = Some(extended);
            self.playing = false;
            self.buffering_since = None;
        }
        if self.pending.contains_key(&extended) {
            admission = PacketAdmission::Duplicate;
        }
        self.pending.entry(extended).or_insert(payload);
        if !self.playing {
            self.buffering_since.get_or_insert_with(Instant::now);
        }
        while self.pending.len() > MAX_PENDING_PACKETS {
            let Some(oldest) = self.pending.keys().next().copied() else {
                break;
            };
            self.pending.remove(&oldest);
        }
        if !self.playing && self.pending.len() >= START_PACKETS {
            self.playing = true;
        }
        admission
    }

    pub fn next(&mut self) -> PlayoutFrame {
        if self
            .buffering_deadline()
            .is_some_and(|deadline| deadline <= Instant::now())
        {
            self.playing = true;
        }
        if !self.playing {
            return PlayoutFrame::Buffering;
        }
        let expected = self
            .expected
            .expect("playing playout has an expected sequence");
        let frame = if let Some(payload) = self.pending.remove(&expected) {
            PlayoutFrame::Packet(payload)
        } else if self
            .pending
            .keys()
            .next()
            .is_some_and(|sequence| *sequence > expected)
        {
            // Borrow redundancy without consuming the successor's own slot.
            PlayoutFrame::Missing {
                successor: self.pending.get(&(expected + 1)).cloned(),
            }
        } else {
            self.playing = false;
            self.buffering_since = None;
            return PlayoutFrame::Buffering;
        };
        self.expected = Some(expected + 1);
        frame
    }

    pub fn ready(&self) -> bool {
        self.playing
    }

    pub fn buffering_deadline(&self) -> Option<Instant> {
        if self.playing || self.pending.is_empty() {
            None
        } else {
            self.buffering_since.map(|since| since + MAX_BUFFERING_WAIT)
        }
    }

    pub fn reset(&mut self) {
        self.pending.clear();
        self.expected = None;
        self.playing = false;
        self.buffering_since = None;
    }
}
