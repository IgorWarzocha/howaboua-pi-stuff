use sonora::{
    AudioProcessing, StreamConfig,
    config::{EchoCanceller, NoiseSuppression},
};
use std::collections::VecDeque;

// Streaming interpolation retains the boundary sample across callback sizes.
pub struct Converter {
    step: f64,
    position: f64,
    previous: Option<f32>,
}
impl Converter {
    pub fn new(source: u32, target: u32) -> Self {
        Self {
            step: source as f64 / target as f64,
            position: 0.0,
            previous: None,
        }
    }
    pub fn push(&mut self, samples: &[f32], out: &mut VecDeque<f32>) {
        for &sample in samples {
            if let Some(previous) = self.previous {
                while self.position < 1.0 {
                    out.push_back(previous + (sample - previous) * self.position as f32);
                    self.position += self.step;
                }
                self.position -= 1.0;
            }
            self.previous = Some(sample);
        }
    }
    pub fn finish(&mut self, out: &mut VecDeque<f32>) {
        if let Some(previous) = self.previous.take() {
            while self.position < 1.0 {
                out.push_back(previous);
                self.position += self.step;
            }
        }
        self.position = 0.0;
    }
}

pub struct Dsp {
    apm: AudioProcessing,
    capture_converter: Converter,
    render_converter: Converter,
    capture: VecDeque<f32>,
    render: VecDeque<f32>,
    pending: Vec<u8>,
    input_rate: u32,
    output_rate: u32,
}
impl Dsp {
    pub fn new(input_rate: u32, output_rate: u32) -> Self {
        Self {
            apm: AudioProcessing::builder()
                .config(sonora::Config {
                    echo_canceller: Some(EchoCanceller::default()),
                    noise_suppression: Some(NoiseSuppression::default()),
                    ..Default::default()
                })
                .capture_config(StreamConfig::new(48_000, 1))
                .render_config(StreamConfig::new(48_000, 1))
                .build(),
            capture_converter: Converter::new(input_rate, 48_000),
            render_converter: Converter::new(output_rate, 48_000),
            capture: VecDeque::new(),
            render: VecDeque::new(),
            pending: Vec::new(),
            input_rate,
            output_rate,
        }
    }
    pub fn reset_capture(&mut self) {
        self.capture_converter = Converter::new(self.input_rate, 48_000);
        self.capture.clear();
        self.pending.clear();
    }
    pub fn reset(&mut self) {
        *self = Self::new(self.input_rate, self.output_rate);
    }
    pub fn render(&mut self, samples: &[f32]) -> Result<(), String> {
        self.render_converter.push(samples, &mut self.render);
        while self.render.len() >= 480 {
            let frame: Vec<_> = self.render.drain(..480).collect();
            let mut output = [0.0; 480];
            self.apm
                .process_render_f32(&[&frame], &mut [&mut output])
                .map_err(|e| format!("Speaker echo processing failed: {e:?}"))?;
        }
        Ok(())
    }
    pub fn capture(&mut self, samples: &[f32], delay_ms: i32) -> Result<Vec<Vec<u8>>, String> {
        self.capture_converter.push(samples, &mut self.capture);
        let mut frames = Vec::new();
        while self.capture.len() >= 480 {
            let frame: Vec<_> = self.capture.drain(..480).collect();
            let mut output = [0.0; 480];
            // Sonora owns the supported 0..500ms echo-delay representation.
            match self.apm.set_stream_delay_ms(delay_ms) {
                Ok(()) | Err(sonora::Error::StreamParameterClamped) => {}
                Err(error) => return Err(format!("Cannot configure echo delay: {error:?}")),
            }
            self.apm
                .process_capture_f32(&[&frame], &mut [&mut output])
                .map_err(|e| format!("Microphone processing failed: {e:?}"))?;
            for pair in output.as_chunks::<2>().0 {
                let sample = ((pair[0] + pair[1]) * 0.5).clamp(-1.0, 1.0);
                if !sample.is_finite() {
                    return Err("Microphone processing returned invalid samples".into());
                }
                self.pending
                    .extend_from_slice(&((sample * 32767.0) as i16).to_le_bytes());
            }
            if self.pending.len() == 960 {
                frames.push(std::mem::take(&mut self.pending));
            }
        }
        Ok(frames)
    }
}
