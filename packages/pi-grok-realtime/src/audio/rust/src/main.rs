mod devices;
mod dsp;

use cpal::{
    StreamInstant,
    traits::{DeviceTrait, StreamTrait},
};
use dsp::{Converter, Dsp};
use std::{
    collections::VecDeque,
    io::{self, Read, Write},
    sync::{Arc, Mutex, mpsc},
    time::{Duration, Instant},
};

pub struct Response(u8, Vec<u8>);
pub struct Shared {
    queue: VecDeque<f32>,
    dsp: Dsp,
    epoch: u32,
    muted: bool,
    ready: bool,
    cutoff: Instant,
    drain: Option<u32>,
    last_playback: Option<StreamInstant>,
    render_delay: Duration,
    responses: mpsc::Sender<Response>,
}

fn write_response(writer: &mut impl Write, response: Response) -> io::Result<()> {
    let size = u32::try_from(response.1.len())
        .map_err(|_| io::Error::other("Audio response exceeds IPC representation"))?;
    writer.write_all(&[response.0])?;
    writer.write_all(&size.to_le_bytes())?;
    writer.write_all(&response.1)?;
    writer.flush()
}
fn read_command(reader: &mut impl Read) -> Result<Option<Response>, String> {
    let mut tag = [0];
    if reader
        .read(&mut tag)
        .map_err(|e| format!("Cannot read audio command: {e}"))?
        == 0
    {
        return Ok(None);
    }
    let mut size = [0; 4];
    reader
        .read_exact(&mut size)
        .map_err(|e| format!("Incomplete audio command header: {e}"))?;
    let size = u32::from_le_bytes(size) as usize;
    let mut payload = Vec::new();
    payload
        .try_reserve_exact(size)
        .map_err(|e| format!("Cannot allocate audio command: {e}"))?;
    payload.resize(size, 0);
    reader
        .read_exact(&mut payload)
        .map_err(|e| format!("Incomplete audio command payload: {e}"))?;
    Ok(Some(Response(tag[0], payload)))
}
fn valid(command: &Response) -> bool {
    match command.0 {
        b'Q' | b'C' => command.1.is_empty(),
        b'M' => command.1.len() == 5 && command.1[4] <= 1,
        b'D' => command.1.len() == 4,
        b'P' => !command.1.is_empty() && command.1.len().is_multiple_of(2),
        _ => false,
    }
}
fn check() -> Result<(), String> {
    let mut protocol = Vec::new();
    write_response(
        &mut protocol,
        Response(b'M', vec![0x12, 0xef, 0xcd, 0xab, 1]),
    )
    .map_err(|e| e.to_string())?;
    let decoded = read_command(&mut protocol.as_slice())?.ok_or("Missing probe command")?;
    if !valid(&decoded) || u32::from_le_bytes(decoded.1[..4].try_into().unwrap()) != 0xabcdef12 {
        return Err("Protocol probe failed".into());
    }
    if valid(&Response(b'P', vec![0])) || valid(&Response(b'M', vec![0; 4])) {
        return Err("Protocol validation probe failed".into());
    }
    let mut dsp = Dsp::new(44_100, 48_000);
    dsp.render(&vec![0.0; 1920])?;
    let frames = dsp.capture(&vec![0.0; 1764], 0)?;
    if frames.is_empty() || frames.iter().any(|frame| frame.len() != 960) {
        return Err("Audio processing probe failed".into());
    }
    dsp.reset_capture();
    if !dsp.capture(&[], 0)?.is_empty() {
        return Err("Mute boundary probe failed".into());
    }
    println!("Audio protocol and echo/noise processing check passed");
    Ok(())
}
fn run(args: &[String]) -> Result<(), String> {
    if args == ["--check"] {
        return check();
    }
    if args == ["--devices"] {
        println!("{}", devices::list()?);
        return Ok(());
    }
    if !args.is_empty() && args.len() != 2 {
        return Err("Expected microphone ID and speaker ID, --devices, or --check".into());
    }
    let microphone = devices::select(args.first().map(String::as_str).unwrap_or(""), true)?;
    let speaker = devices::select(args.get(1).map(String::as_str).unwrap_or(""), false)?;
    let input_rate = microphone
        .default_input_config()
        .map_err(|e| format!("Cannot configure microphone: {e}"))?
        .sample_rate();
    let output_rate = speaker
        .default_output_config()
        .map_err(|e| format!("Cannot configure speaker: {e}"))?
        .sample_rate();
    let (responses, receiver) = mpsc::channel();
    let shared = Arc::new(Mutex::new(Shared {
        queue: VecDeque::new(),
        dsp: Dsp::new(input_rate, output_rate),
        epoch: 0,
        muted: false,
        ready: false,
        cutoff: Instant::now(),
        drain: None,
        last_playback: None,
        render_delay: Duration::ZERO,
        responses: responses.clone(),
    }));
    let writer = std::thread::spawn(move || {
        let mut stdout = io::stdout().lock();
        for response in receiver {
            if let Err(error) = write_response(&mut stdout, response) {
                eprintln!("Cannot write audio responses: {error}");
                std::process::exit(1);
            }
        }
    });
    let input = devices::input(&microphone, shared.clone())?;
    let mut output = Some(devices::output(&speaker, shared.clone())?);
    input
        .play()
        .map_err(|e| format!("Cannot start microphone: {e}"))?;
    output
        .as_ref()
        .unwrap()
        .play()
        .map_err(|e| format!("Cannot start speaker: {e}"))?;
    {
        let mut state = shared.lock().unwrap();
        responses
            .send(Response(b'R', Vec::new()))
            .map_err(|e| e.to_string())?;
        state.ready = true;
        state.cutoff = Instant::now();
    }
    let mut converter = Converter::new(24_000, output_rate);
    let mut stdin = io::stdin().lock();
    while let Some(command) = read_command(&mut stdin)? {
        if !valid(&command) {
            return Err("Invalid audio command; restart audio".into());
        }
        if command.0 == b'Q' {
            break;
        }
        if command.0 == b'C' {
            // CPAL has no flush: drop the stream before resetting echo history.
            drop(output.take());
            {
                let mut state = shared.lock().unwrap();
                state.queue.clear();
                state.drain = None;
                state.last_playback = None;
                state.render_delay = Duration::ZERO;
                state.dsp.reset();
            }
            converter = Converter::new(24_000, output_rate);
            output = Some(devices::output(&speaker, shared.clone())?);
            output
                .as_ref()
                .unwrap()
                .play()
                .map_err(|e| format!("Cannot restart speaker after clear: {e}"))?;
            continue;
        }
        let mut state = shared.lock().unwrap();
        match command.0 {
            b'P' => {
                // Later PCM extends an outstanding drain; only clear cancels it.
                let samples: Vec<f32> = command
                    .1
                    .as_chunks::<2>()
                    .0
                    .iter()
                    .map(|bytes| i16::from_le_bytes([bytes[0], bytes[1]]) as f32 / 32768.0)
                    .collect();
                converter.push(&samples, &mut state.queue);
            }
            b'M' => {
                state.epoch = u32::from_le_bytes(command.1[..4].try_into().unwrap());
                state.muted = command.1[4] == 1;
                state.cutoff = Instant::now();
                state.dsp.reset_capture();
            }
            b'D' => {
                // Flush interpolation's final boundary sample without inventing queue padding.
                converter.finish(&mut state.queue);
                state.drain = Some(u32::from_le_bytes(command.1[..4].try_into().unwrap()));
            }
            _ => unreachable!(),
        }
    }
    drop(input);
    drop(output);
    drop(shared);
    drop(responses);
    writer
        .join()
        .map_err(|_| "Audio response writer failed".to_owned())?;
    Ok(())
}
fn main() {
    if let Err(error) = run(&std::env::args().skip(1).collect::<Vec<_>>()) {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
