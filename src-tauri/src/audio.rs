use std::{
  collections::HashMap,
  io::Cursor,
  sync::{mpsc, Arc},
};

use cpal::traits::{DeviceTrait, HostTrait};
use rodio::{buffer::SamplesBuffer, Decoder, OutputStream, OutputStreamHandle, Sink};
use serde::Serialize;
use tauri::State;

pub type PlayerId = u64;

#[derive(Clone)]
pub struct AudioController {
  tx: mpsc::Sender<AudioCommand>,
}

impl AudioController {
  pub fn new() -> Self {
    let (tx, rx) = mpsc::channel::<AudioCommand>();
    std::thread::spawn(move || run_audio_thread(rx));
    Self { tx }
  }

  fn call<R>(
    &self,
    build: impl FnOnce(mpsc::Sender<Result<R, String>>) -> AudioCommand,
  ) -> Result<R, String> {
    let (resp_tx, resp_rx) = mpsc::channel::<Result<R, String>>();
    self
      .tx
      .send(build(resp_tx))
      .map_err(|_| "audio thread disconnected".to_string())?;
    resp_rx
      .recv()
      .map_err(|_| "audio thread did not respond".to_string())?
  }
}

enum AudioCommand {
  CreatePlayer {
    respond_to: mpsc::Sender<Result<PlayerId, String>>,
  },
  DestroyPlayer {
    player_id: PlayerId,
    respond_to: mpsc::Sender<Result<(), String>>,
  },
  SetPlayerDevice {
    player_id: PlayerId,
    device_id: String,
    respond_to: mpsc::Sender<Result<AudioPlayerState, String>>,
  },
  LoadMp3 {
    player_id: PlayerId,
    bytes: Vec<u8>,
    file_name: String,
    respond_to: mpsc::Sender<Result<AudioPlayerState, String>>,
  },
  TogglePlayback {
    player_id: PlayerId,
    respond_to: mpsc::Sender<Result<AudioPlayerState, String>>,
  },
  Stop {
    player_id: PlayerId,
    respond_to: mpsc::Sender<Result<AudioPlayerState, String>>,
  },
  GetState {
    player_id: PlayerId,
    respond_to: mpsc::Sender<Result<AudioPlayerState, String>>,
  },
  PlayPcmF32 {
    player_id: PlayerId,
    sample_rate: u32,
    channels: u16,
    samples: Vec<f32>,
    respond_to: mpsc::Sender<Result<AudioPlayerState, String>>,
  },
}

#[derive(Debug, Serialize)]
pub struct AudioOutputDevice {
  pub id: String,
  pub name: String,
}

#[derive(Debug, Serialize)]
pub struct AudioPlayerState {
  pub player_id: PlayerId,
  pub device_id: String,
  pub file_name: String,
  pub has_audio: bool,
  pub is_playing: bool,
  pub is_paused: bool,
  pub is_empty: bool,
}

struct AudioEngineInner {
  next_player_id: PlayerId,
  players: HashMap<PlayerId, PlayerInner>,
}

struct PlayerInner {
  device_id: String,
  stream: Option<OutputStream>,
  handle: Option<OutputStreamHandle>,
  sink: Option<Sink>,
  mp3: Option<Arc<[u8]>>,
  file_name: String,
}

impl Default for AudioEngineInner {
  fn default() -> Self {
    Self {
      next_player_id: 0,
      players: HashMap::new(),
    }
  }
}

impl AudioEngineInner {
  fn create_player(&mut self) -> PlayerId {
    self.next_player_id = self.next_player_id.saturating_add(1);
    let player_id = if self.next_player_id == 0 { 1 } else { self.next_player_id };
    self.next_player_id = player_id;

    self.players.insert(
      player_id,
      PlayerInner {
        device_id: "default".to_string(),
        stream: None,
        handle: None,
        sink: None,
        mp3: None,
        file_name: String::new(),
      },
    );

    player_id
  }

  fn destroy_player(&mut self, player_id: PlayerId) -> Result<(), String> {
    self.players
      .remove(&player_id)
      .map(|_| ())
      .ok_or_else(|| format!("player not found: {player_id}"))
  }

  fn player_mut(&mut self, player_id: PlayerId) -> Result<&mut PlayerInner, String> {
    self.players
      .get_mut(&player_id)
      .ok_or_else(|| format!("player not found: {player_id}"))
  }

  fn player(&self, player_id: PlayerId) -> Result<&PlayerInner, String> {
    self
      .players
      .get(&player_id)
      .ok_or_else(|| format!("player not found: {player_id}"))
  }
}

impl PlayerInner {
  fn state(&self, player_id: PlayerId) -> AudioPlayerState {
    let (is_paused, is_empty) = match &self.sink {
      Some(sink) => (sink.is_paused(), sink.empty()),
      None => (false, true),
    };

    AudioPlayerState {
      player_id,
      device_id: self.device_id.clone(),
      file_name: self.file_name.clone(),
      has_audio: self.mp3.is_some(),
      is_playing: !is_paused && !is_empty,
      is_paused,
      is_empty,
    }
  }

  fn ensure_output(&mut self) -> Result<(), String> {
    if self.stream.is_some() && self.handle.is_some() && self.sink.is_some() {
      return Ok(());
    }

    let host = cpal::default_host();
    let device = resolve_output_device(&host, &self.device_id)?;

    let (stream, handle) = OutputStream::try_from_device(&device).map_err(|e| e.to_string())?;
    let sink = Sink::try_new(&handle).map_err(|e| e.to_string())?;

    self.stream = Some(stream);
    self.handle = Some(handle);
    self.sink = Some(sink);
    Ok(())
  }

  fn reset_sink(&mut self) -> Result<(), String> {
    let handle = self
      .handle
      .as_ref()
      .ok_or_else(|| "output is not initialized".to_string())?;
    let sink = Sink::try_new(handle).map_err(|e| e.to_string())?;
    self.sink = Some(sink);
    Ok(())
  }

  fn set_device(&mut self, device_id: String) -> Result<(), String> {
    self.device_id = device_id;
    self.stream = None;
    self.handle = None;
    self.sink = None;
    self.ensure_output()
  }

  fn load_mp3(&mut self, bytes: Vec<u8>, file_name: String) -> Result<(), String> {
    self.mp3 = Some(Arc::from(bytes));
    self.file_name = file_name;
    if self.handle.is_some() {
      self.reset_sink()?;
    }
    Ok(())
  }

  fn decoder_from_loaded_mp3(&self) -> Result<Decoder<Cursor<Arc<[u8]>>>, String> {
    let bytes = self
      .mp3
      .as_ref()
      .ok_or_else(|| "MP3が未選択です".to_string())?;
    Decoder::new(Cursor::new(bytes.clone())).map_err(|e| e.to_string())
  }
}

fn run_audio_thread(rx: mpsc::Receiver<AudioCommand>) {
  let mut engine = AudioEngineInner::default();
  while let Ok(cmd) = rx.recv() {
    match cmd {
      AudioCommand::CreatePlayer { respond_to } => {
        let _ = respond_to.send(Ok(engine.create_player()));
      }
      AudioCommand::DestroyPlayer {
        player_id,
        respond_to,
      } => {
        let _ = respond_to.send(engine.destroy_player(player_id));
      }
      AudioCommand::SetPlayerDevice {
        player_id,
        device_id,
        respond_to,
      } => {
        let result = (|| {
          let player = engine.player_mut(player_id)?;
          player.set_device(device_id)?;
          Ok(player.state(player_id))
        })();
        let _ = respond_to.send(result);
      }
      AudioCommand::LoadMp3 {
        player_id,
        bytes,
        file_name,
        respond_to,
      } => {
        let result = (|| {
          let player = engine.player_mut(player_id)?;
          player.load_mp3(bytes, file_name)?;
          Ok(player.state(player_id))
        })();
        let _ = respond_to.send(result);
      }
      AudioCommand::TogglePlayback {
        player_id,
        respond_to,
      } => {
        let result = (|| {
          let player = engine.player_mut(player_id)?;
          player.ensure_output()?;
          let sink = player
            .sink
            .as_ref()
            .ok_or_else(|| "output is not initialized".to_string())?;

          let is_playing = !sink.is_paused() && !sink.empty();
          if is_playing {
            sink.pause();
            return Ok(player.state(player_id));
          }

          if sink.empty() {
            let decoder = player.decoder_from_loaded_mp3()?;
            sink.append(decoder);
          }

          sink.play();
          Ok(player.state(player_id))
        })();
        let _ = respond_to.send(result);
      }
      AudioCommand::Stop {
        player_id,
        respond_to,
      } => {
        let result = (|| {
          let player = engine.player_mut(player_id)?;
          player.ensure_output()?;
          player.reset_sink()?;
          Ok(player.state(player_id))
        })();
        let _ = respond_to.send(result);
      }
      AudioCommand::GetState {
        player_id,
        respond_to,
      } => {
        let result = engine.player(player_id).map(|player| player.state(player_id));
        let _ = respond_to.send(result);
      }
      AudioCommand::PlayPcmF32 {
        player_id,
        sample_rate,
        channels,
        samples,
        respond_to,
      } => {
        let result = (|| {
          if sample_rate == 0 {
            return Err("sample_rate must be > 0".to_string());
          }
          if channels == 0 {
            return Err("channels must be > 0".to_string());
          }

          let player = engine.player_mut(player_id)?;
          player.ensure_output()?;
          let sink = player
            .sink
            .as_ref()
            .ok_or_else(|| "output is not initialized".to_string())?;

          let source = SamplesBuffer::new(channels, sample_rate, samples);
          sink.append(source);
          sink.play();
          Ok(player.state(player_id))
        })();
        let _ = respond_to.send(result);
      }
    }
  }
}

fn resolve_output_device(host: &cpal::Host, device_id: &str) -> Result<cpal::Device, String> {
  if device_id == "default" {
    return host
      .default_output_device()
      .ok_or_else(|| "デフォルトの出力デバイスが見つかりません".to_string());
  }

  let index: usize = device_id
    .parse()
    .map_err(|_| format!("不正なdevice idです: {device_id}"))?;

  let mut devices = host.output_devices().map_err(|e| e.to_string())?;
  devices
    .nth(index)
    .ok_or_else(|| format!("出力デバイスが見つかりません (index={index})"))
}

#[tauri::command]
pub fn audio_list_output_devices() -> Result<Vec<AudioOutputDevice>, String> {
  let host = cpal::default_host();
  let mut result = Vec::new();

  result.push(AudioOutputDevice {
    id: "default".to_string(),
    name: "システムデフォルト".to_string(),
  });

  let devices = host.output_devices().map_err(|e| e.to_string())?;
  for (index, device) in devices.enumerate() {
    let name = device
      .name()
      .unwrap_or_else(|_| format!("出力デバイス {index}"));
    result.push(AudioOutputDevice {
      id: index.to_string(),
      name,
    });
  }

  Ok(result)
}

#[tauri::command]
pub fn audio_create_player(state: State<'_, AudioController>) -> Result<PlayerId, String> {
  state.call(|respond_to| AudioCommand::CreatePlayer { respond_to })
}

#[tauri::command]
pub fn audio_destroy_player(state: State<'_, AudioController>, player_id: PlayerId) -> Result<(), String> {
  state.call(|respond_to| AudioCommand::DestroyPlayer { player_id, respond_to })
}

#[tauri::command]
pub fn audio_set_player_device(
  state: State<'_, AudioController>,
  player_id: PlayerId,
  device_id: String,
) -> Result<AudioPlayerState, String> {
  state.call(|respond_to| AudioCommand::SetPlayerDevice {
    player_id,
    device_id,
    respond_to,
  })
}

#[tauri::command]
pub fn audio_load_mp3(
  state: State<'_, AudioController>,
  player_id: PlayerId,
  bytes: Vec<u8>,
  file_name: String,
) -> Result<AudioPlayerState, String> {
  state.call(|respond_to| AudioCommand::LoadMp3 {
    player_id,
    bytes,
    file_name,
    respond_to,
  })
}

#[tauri::command]
pub fn audio_toggle_playback(state: State<'_, AudioController>, player_id: PlayerId) -> Result<AudioPlayerState, String> {
  state.call(|respond_to| AudioCommand::TogglePlayback { player_id, respond_to })
}

#[tauri::command]
pub fn audio_stop(state: State<'_, AudioController>, player_id: PlayerId) -> Result<AudioPlayerState, String> {
  state.call(|respond_to| AudioCommand::Stop { player_id, respond_to })
}

#[tauri::command]
pub fn audio_get_state(state: State<'_, AudioController>, player_id: PlayerId) -> Result<AudioPlayerState, String> {
  state.call(|respond_to| AudioCommand::GetState { player_id, respond_to })
}

#[tauri::command]
pub fn audio_play_pcm_f32(
  state: State<'_, AudioController>,
  player_id: PlayerId,
  sample_rate: u32,
  channels: u16,
  samples: Vec<f32>,
) -> Result<AudioPlayerState, String> {
  state.call(|respond_to| AudioCommand::PlayPcmF32 {
    player_id,
    sample_rate,
    channels,
    samples,
    respond_to,
  })
}

