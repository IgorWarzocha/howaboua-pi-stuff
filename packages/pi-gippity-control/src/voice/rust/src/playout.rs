use std::collections::BTreeMap;

use bytes::Bytes;

const START_PACKETS: usize = 3;
const MAX_PACKETS: usize = 6;

#[derive(Debug, PartialEq)]
pub enum PlayoutFrame {
    Buffering,
    Packet(Bytes),
    Missing,
}

pub struct PacketPlayout {
    pending: BTreeMap<i64, Bytes>,
    expected: Option<i64>,
    playing: bool,
}

impl PacketPlayout {
    pub fn new() -> Self {
        Self {
            pending: BTreeMap::new(),
            expected: None,
            playing: false,
        }
    }

    pub fn push(&mut self, sequence: u16, payload: Bytes) {
        let expected = *self.expected.get_or_insert(sequence as i64);
        let delta = sequence.wrapping_sub(expected as u16) as i16 as i64;
        let extended = expected + delta;
        if extended < expected {
            if self.playing || expected - extended > MAX_PACKETS as i64 {
                return;
            }
            self.expected = Some(extended);
        } else if extended - expected > MAX_PACKETS as i64 {
            self.pending.clear();
            self.expected = Some(extended);
            self.playing = false;
        }
        self.pending.entry(extended).or_insert(payload);
        while self.pending.len() > MAX_PACKETS {
            let Some(oldest) = self.pending.keys().next().copied() else {
                break;
            };
            self.pending.remove(&oldest);
        }
        if !self.playing && self.pending.len() >= START_PACKETS {
            self.playing = true;
        }
    }

    pub fn next(&mut self) -> PlayoutFrame {
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
            PlayoutFrame::Missing
        } else {
            self.playing = false;
            return PlayoutFrame::Buffering;
        };
        self.expected = Some(expected + 1);
        frame
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn packet(value: u8) -> Bytes {
        Bytes::from(vec![value])
    }

    #[test]
    fn reorders_packets_and_conceals_a_known_gap() {
        let mut playout = PacketPlayout::new();
        playout.push(12, packet(12));
        playout.push(10, packet(10));
        playout.push(11, packet(11));
        assert_eq!(playout.next(), PlayoutFrame::Packet(packet(10)));
        assert_eq!(playout.next(), PlayoutFrame::Packet(packet(11)));
        assert_eq!(playout.next(), PlayoutFrame::Packet(packet(12)));

        let mut gap = PacketPlayout::new();
        gap.push(20, packet(20));
        gap.push(22, packet(22));
        gap.push(23, packet(23));
        assert_eq!(gap.next(), PlayoutFrame::Packet(packet(20)));
        assert_eq!(gap.next(), PlayoutFrame::Missing);
        assert_eq!(gap.next(), PlayoutFrame::Packet(packet(22)));
    }

    #[test]
    fn rejects_duplicates_and_orders_across_sequence_wrap() {
        let mut playout = PacketPlayout::new();
        playout.push(u16::MAX, packet(1));
        playout.push(0, packet(2));
        playout.push(0, packet(9));
        playout.push(1, packet(3));
        assert_eq!(playout.next(), PlayoutFrame::Packet(packet(1)));
        assert_eq!(playout.next(), PlayoutFrame::Packet(packet(2)));
        assert_eq!(playout.next(), PlayoutFrame::Packet(packet(3)));
        playout.push(0, packet(4));
        assert_eq!(playout.next(), PlayoutFrame::Buffering);
    }

    #[test]
    fn resynchronizes_after_a_gap_larger_than_the_playout_window() {
        let mut playout = PacketPlayout::new();
        for sequence in 10..=12 {
            playout.push(sequence, packet(sequence as u8));
        }
        assert_eq!(playout.next(), PlayoutFrame::Packet(packet(10)));
        for sequence in 30..=32 {
            playout.push(sequence, packet(sequence as u8));
        }
        assert_eq!(playout.next(), PlayoutFrame::Packet(packet(30)));
    }

    #[test]
    fn opus_decoder_conceals_one_missing_twenty_millisecond_frame() {
        let mut encoder =
            opus::Encoder::new(48_000, opus::Channels::Mono, opus::Application::Voip).unwrap();
        let mut encoded = vec![0_u8; 4_000];
        let size = encoder.encode_float(&vec![0.1; 960], &mut encoded).unwrap();
        let mut decoder = opus::Decoder::new(48_000, opus::Channels::Stereo).unwrap();
        let mut decoded = vec![0.0; 960 * 2];
        assert_eq!(
            decoder
                .decode_float(&encoded[..size], &mut decoded, false)
                .unwrap(),
            960
        );
        assert_eq!(decoder.decode_float(&[], &mut decoded, false).unwrap(), 960);
    }
}
