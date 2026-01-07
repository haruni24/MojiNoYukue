use std::{
  collections::{HashMap, VecDeque},
  io::Cursor,
  sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Arc, Mutex,
  },
};

use coreaudio::audio_unit::audio_format::LinearPcmFlags;
use coreaudio::audio_unit::render_callback::{self, data};
use coreaudio::audio_unit::{AudioUnit, Element, SampleFormat, Scope, StreamFormat};
use coreaudio::sys::{
  kAudioHardwarePropertyDefaultOutputDevice, kAudioHardwarePropertyDevices,
  kAudioObjectPropertyElementMain, kAudioObjectPropertyScopeGlobal,
  kAudioObjectPropertyScopeOutput, kAudioObjectSystemObject,
  kAudioDevicePropertyDeviceNameCFString,
  kAudioDevicePropertyStreams, AudioDeviceID, AudioObjectGetPropertyData,
  AudioObjectGetPropertyDataSize, AudioObjectPropertyAddress,
};
use rodio::Decoder;
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

/// 共有オーディオバッファ
struct SharedBuffer {
  samples: Mutex<VecDeque<f32>>,
  is_paused: AtomicBool,
}

impl SharedBuffer {
  fn new() -> Arc<Self> {
    Arc::new(Self {
      samples: Mutex::new(VecDeque::new()),
      is_paused: AtomicBool::new(false),
    })
  }

  fn push_samples(&self, data: &[f32]) {
    if let Ok(mut buf) = self.samples.lock() {
      buf.extend(data.iter().copied());
    }
  }

  fn clear(&self) {
    if let Ok(mut buf) = self.samples.lock() {
      buf.clear();
    }
  }

  fn is_empty(&self) -> bool {
    self.samples.lock().map(|b| b.is_empty()).unwrap_or(true)
  }

  fn pause(&self) {
    self.is_paused.store(true, Ordering::SeqCst);
  }

  fn resume(&self) {
    self.is_paused.store(false, Ordering::SeqCst);
  }

  fn is_paused(&self) -> bool {
    self.is_paused.load(Ordering::SeqCst)
  }
}

struct AudioEngineInner {
  next_player_id: PlayerId,
  players: HashMap<PlayerId, PlayerInner>,
}

struct PlayerInner {
  device_id: String,
  audio_unit: Option<AudioUnit>,
  buffer: Option<Arc<SharedBuffer>>,
  sample_rate: f64,
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
    let player_id = if self.next_player_id == 0 {
      1
    } else {
      self.next_player_id
    };
    self.next_player_id = player_id;

    self.players.insert(
      player_id,
      PlayerInner {
        device_id: "default".to_string(),
        audio_unit: None,
        buffer: None,
        sample_rate: 48000.0,
        mp3: None,
        file_name: String::new(),
      },
    );

    player_id
  }

  fn destroy_player(&mut self, player_id: PlayerId) -> Result<(), String> {
    if let Some(mut player) = self.players.remove(&player_id) {
      if let Some(mut au) = player.audio_unit.take() {
        let _ = au.stop();
      }
      Ok(())
    } else {
      Err(format!("player not found: {player_id}"))
    }
  }

  fn player_mut(&mut self, player_id: PlayerId) -> Result<&mut PlayerInner, String> {
    self
      .players
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
    let (is_paused, is_empty) = match &self.buffer {
      Some(buf) => (buf.is_paused(), buf.is_empty()),
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
    if self.audio_unit.is_some() && self.buffer.is_some() {
      return Ok(());
    }

    let device_id = if self.device_id == "default" {
      get_default_output_device()?
    } else {
      self
        .device_id
        .parse::<AudioDeviceID>()
        .map_err(|_| format!("不正なdevice idです: {}", self.device_id))?
    };

    let (audio_unit, sample_rate, buffer) = create_audio_unit_for_device(device_id)?;

    self.audio_unit = Some(audio_unit);
    self.buffer = Some(buffer);
    self.sample_rate = sample_rate;
    Ok(())
  }

  fn set_device(&mut self, device_id: String) -> Result<(), String> {
    // 既存のAudioUnitを停止
    if let Some(mut au) = self.audio_unit.take() {
      let _ = au.stop();
    }
    self.buffer = None;

    self.device_id = device_id;
    self.ensure_output()
  }

  fn load_mp3(&mut self, bytes: Vec<u8>, file_name: String) -> Result<(), String> {
    self.mp3 = Some(Arc::from(bytes));
    self.file_name = file_name;
    if let Some(buf) = &self.buffer {
      buf.clear();
    }
    Ok(())
  }

  fn decode_mp3_to_f32(&self) -> Result<(Vec<f32>, u32, u16), String> {
    use rodio::Source;

    let bytes = self
      .mp3
      .as_ref()
      .ok_or_else(|| "MP3が未選択です".to_string())?;

    let decoder = Decoder::new(Cursor::new(bytes.clone())).map_err(|e| e.to_string())?;

    let source_sample_rate = decoder.sample_rate();
    let source_channels = decoder.channels();

    let samples: Vec<f32> = decoder.convert_samples::<f32>().collect();

    Ok((samples, source_sample_rate, source_channels))
  }

  fn play_samples(
    &mut self,
    samples: Vec<f32>,
    source_rate: u32,
    source_channels: u16,
  ) -> Result<(), String> {
    self.ensure_output()?;

    let buffer = self
      .buffer
      .as_ref()
      .ok_or("バッファが初期化されていません")?;

    let target_rate = self.sample_rate as u32;
    let target_channels = 2u16; // CoreAudioは通常ステレオ

    // サンプルレートとチャンネル数を変換
    let converted = convert_audio(&samples, source_rate, source_channels, target_rate, target_channels);

    buffer.push_samples(&converted);
    buffer.resume();

    // AudioUnitを開始
    if let Some(au) = self.audio_unit.as_mut() {
      au.start().map_err(|e| format!("再生開始に失敗: {:?}", e))?;
    }

    Ok(())
  }
}

/// CoreAudioからデフォルト出力デバイスIDを取得
fn get_default_output_device() -> Result<AudioDeviceID, String> {
  let property_address = AudioObjectPropertyAddress {
    mSelector: kAudioHardwarePropertyDefaultOutputDevice,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain,
  };

  let mut device_id: AudioDeviceID = 0;
  let mut data_size = std::mem::size_of::<AudioDeviceID>() as u32;

  let status = unsafe {
    AudioObjectGetPropertyData(
      kAudioObjectSystemObject,
      &property_address,
      0,
      std::ptr::null(),
      &mut data_size,
      &mut device_id as *mut _ as *mut _,
    )
  };

  if status != 0 {
    return Err(format!(
      "デフォルト出力デバイスの取得に失敗しました (status: {})",
      status
    ));
  }

  Ok(device_id)
}

/// CoreAudioから全出力デバイスを取得
fn get_all_output_devices() -> Result<Vec<(AudioDeviceID, String)>, String> {
  // デバイスIDのリストを取得
  let property_address = AudioObjectPropertyAddress {
    mSelector: kAudioHardwarePropertyDevices,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain,
  };

  let mut data_size: u32 = 0;
  let status = unsafe {
    AudioObjectGetPropertyDataSize(
      kAudioObjectSystemObject,
      &property_address,
      0,
      std::ptr::null(),
      &mut data_size,
    )
  };

  if status != 0 {
    return Err(format!("デバイスリストサイズの取得に失敗 (status: {})", status));
  }

  let device_count = data_size as usize / std::mem::size_of::<AudioDeviceID>();
  let mut device_ids: Vec<AudioDeviceID> = vec![0; device_count];

  let status = unsafe {
    AudioObjectGetPropertyData(
      kAudioObjectSystemObject,
      &property_address,
      0,
      std::ptr::null(),
      &mut data_size,
      device_ids.as_mut_ptr() as *mut _,
    )
  };

  if status != 0 {
    return Err(format!("デバイスリストの取得に失敗 (status: {})", status));
  }

  // 各デバイスが出力をサポートしているかチェックし、名前を取得
  let mut result = Vec::new();

  for device_id in device_ids {
    if has_output_streams(device_id) {
      if let Ok(name) = get_device_name(device_id) {
        result.push((device_id, name));
      }
    }
  }

  Ok(result)
}

/// デバイスが出力ストリームを持っているかチェック
fn has_output_streams(device_id: AudioDeviceID) -> bool {
  let property_address = AudioObjectPropertyAddress {
    mSelector: kAudioDevicePropertyStreams,
    mScope: kAudioObjectPropertyScopeOutput,
    mElement: kAudioObjectPropertyElementMain,
  };

  let mut data_size: u32 = 0;
  let status = unsafe {
    AudioObjectGetPropertyDataSize(
      device_id,
      &property_address,
      0,
      std::ptr::null(),
      &mut data_size,
    )
  };

  status == 0 && data_size > 0
}

/// デバイス名を取得
fn get_device_name(device_id: AudioDeviceID) -> Result<String, String> {
  let property_address = AudioObjectPropertyAddress {
    mSelector: kAudioDevicePropertyDeviceNameCFString,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain,
  };

  let mut name_ref: coreaudio::sys::CFStringRef = std::ptr::null();
  let mut data_size = std::mem::size_of::<coreaudio::sys::CFStringRef>() as u32;

  let status = unsafe {
    AudioObjectGetPropertyData(
      device_id,
      &property_address,
      0,
      std::ptr::null(),
      &mut data_size,
      &mut name_ref as *mut _ as *mut _,
    )
  };

  if status != 0 || name_ref.is_null() {
    return Err("デバイス名の取得に失敗".to_string());
  }

  // CFStringをRust Stringに変換
  let name = unsafe {
    let length = coreaudio::sys::CFStringGetLength(name_ref);
    let max_size = coreaudio::sys::CFStringGetMaximumSizeForEncoding(
      length,
      coreaudio::sys::kCFStringEncodingUTF8,
    ) + 1;

    let mut buffer = vec![0u8; max_size as usize];
    let success = coreaudio::sys::CFStringGetCString(
      name_ref,
      buffer.as_mut_ptr() as *mut _,
      max_size,
      coreaudio::sys::kCFStringEncodingUTF8,
    );

    coreaudio::sys::CFRelease(name_ref as *const _);

    if success != 0 {
      let len = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
      String::from_utf8_lossy(&buffer[..len]).to_string()
    } else {
      return Err("デバイス名の変換に失敗".to_string());
    }
  };

  Ok(name)
}

/// 指定デバイス用のAudioUnitを作成
fn create_audio_unit_for_device(
  device_id: AudioDeviceID,
) -> Result<(AudioUnit, f64, Arc<SharedBuffer>), String> {
  // HAL Output AudioUnitを作成
  let mut audio_unit = AudioUnit::new(coreaudio::audio_unit::IOType::HalOutput)
    .map_err(|e| format!("AudioUnit作成に失敗: {:?}", e))?;

  // 出力デバイスを設定
  audio_unit
    .set_property(
      coreaudio::sys::kAudioOutputUnitProperty_CurrentDevice,
      Scope::Global,
      Element::Output,
      Some(&device_id),
    )
    .map_err(|e| format!("出力デバイスの設定に失敗: {:?}", e))?;

  // ストリームフォーマットを設定（48kHz, ステレオ, f32, Non-Interleaved）
  let sample_rate = 48000.0;
  let stream_format = StreamFormat {
    sample_rate,
    sample_format: SampleFormat::F32,
    flags: LinearPcmFlags::IS_FLOAT | LinearPcmFlags::IS_NON_INTERLEAVED,
    channels: 2,
  };

  audio_unit
    .set_property(
      coreaudio::sys::kAudioUnitProperty_StreamFormat,
      Scope::Input,
      Element::Output,
      Some(&stream_format.to_asbd()),
    )
    .map_err(|e| format!("ストリームフォーマットの設定に失敗: {:?}", e))?;

  // 共有バッファを作成
  let buffer = SharedBuffer::new();
  let buffer_clone = Arc::clone(&buffer);

  // レンダーコールバックを設定
  type Args = render_callback::Args<data::NonInterleaved<f32>>;

  audio_unit
    .set_render_callback(move |args: Args| {
      let Args {
        num_frames, mut data, ..
      } = args;

      if buffer_clone.is_paused() {
        for channel in data.channels_mut() {
          for sample in channel {
            *sample = 0.0;
          }
        }
        return Ok(());
      }

      if let Ok(mut buf) = buffer_clone.samples.lock() {
        // チャンネルデータを収集
        let mut channels: Vec<&mut [f32]> = data.channels_mut().collect();
        let num_channels = channels.len();

        // ステレオ出力（インターリーブされたデータをデインターリーブ）
        for frame in 0..num_frames {
          for ch in 0..num_channels {
            // インターリーブされたサンプル: [L0, R0, L1, R1, ...]
            let sample = buf.pop_front().unwrap_or(0.0);
            channels[ch][frame] = sample;
          }
        }
      } else {
        for channel in data.channels_mut() {
          for sample in channel {
            *sample = 0.0;
          }
        }
      }

      Ok(())
    })
    .map_err(|e| format!("レンダーコールバックの設定に失敗: {:?}", e))?;

  Ok((audio_unit, sample_rate, buffer))
}

/// オーディオのサンプルレートとチャンネル数を変換
fn convert_audio(
  samples: &[f32],
  source_rate: u32,
  source_channels: u16,
  target_rate: u32,
  target_channels: u16,
) -> Vec<f32> {
  let source_channels = source_channels as usize;
  let target_channels = target_channels as usize;

  // まずチャンネル数を変換
  let channel_converted: Vec<f32> = if source_channels == target_channels {
    samples.to_vec()
  } else if source_channels == 1 && target_channels == 2 {
    // モノラル → ステレオ
    samples.iter().flat_map(|&s| [s, s]).collect()
  } else if source_channels == 2 && target_channels == 1 {
    // ステレオ → モノラル
    samples
      .chunks(2)
      .map(|chunk| {
        if chunk.len() == 2 {
          (chunk[0] + chunk[1]) / 2.0
        } else {
          chunk[0]
        }
      })
      .collect()
  } else {
    // その他の場合は最初のN個のチャンネルを使用
    let frame_count = samples.len() / source_channels;
    let mut result = Vec::with_capacity(frame_count * target_channels);
    for frame_idx in 0..frame_count {
      let base = frame_idx * source_channels;
      for ch in 0..target_channels {
        let src_ch = ch.min(source_channels - 1);
        result.push(samples[base + src_ch]);
      }
    }
    result
  };

  // サンプルレートを変換（線形補間）
  if source_rate == target_rate {
    return channel_converted;
  }

  let frame_count = channel_converted.len() / target_channels;
  let ratio = source_rate as f64 / target_rate as f64;
  let new_frame_count = (frame_count as f64 / ratio) as usize;

  let mut result = Vec::with_capacity(new_frame_count * target_channels);

  for new_frame in 0..new_frame_count {
    let src_pos = new_frame as f64 * ratio;
    let src_frame = src_pos as usize;
    let frac = (src_pos - src_frame as f64) as f32;

    for ch in 0..target_channels {
      let idx0 = src_frame * target_channels + ch;
      let idx1 = ((src_frame + 1).min(frame_count - 1)) * target_channels + ch;

      let s0 = channel_converted.get(idx0).copied().unwrap_or(0.0);
      let s1 = channel_converted.get(idx1).copied().unwrap_or(0.0);

      result.push(s0 + (s1 - s0) * frac);
    }
  }

  result
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

          // バッファがあって一時停止中なら再開
          if let Some(buf) = &player.buffer {
            if buf.is_paused() {
              buf.resume();
              if let Some(au) = player.audio_unit.as_mut() {
                au.start().map_err(|e| format!("再生開始に失敗: {:?}", e))?;
              }
              return Ok(player.state(player_id));
            }
            // 再生中なら一時停止
            if !buf.is_empty() {
              buf.pause();
              return Ok(player.state(player_id));
            }
          }

          // バッファが空ならMP3をデコードして再生
          let (samples, source_rate, source_channels) = player.decode_mp3_to_f32()?;
          player.play_samples(samples, source_rate, source_channels)?;
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
          if let Some(buf) = &player.buffer {
            buf.clear();
            buf.pause();
          }
          Ok(player.state(player_id))
        })();
        let _ = respond_to.send(result);
      }
      AudioCommand::GetState {
        player_id,
        respond_to,
      } => {
        let result = engine
          .player(player_id)
          .map(|player| player.state(player_id));
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
          player.play_samples(samples, sample_rate, channels)?;
          Ok(player.state(player_id))
        })();
        let _ = respond_to.send(result);
      }
    }
  }
}

#[tauri::command]
pub fn audio_list_output_devices() -> Result<Vec<AudioOutputDevice>, String> {
  let mut result = Vec::new();

  // デフォルトデバイスを追加
  let default_device_id = get_default_output_device()?;
  let default_name = get_device_name(default_device_id).unwrap_or_else(|_| "不明".to_string());

  result.push(AudioOutputDevice {
    id: "default".to_string(),
    name: format!("システムデフォルト（{default_name}）"),
  });

  // 全出力デバイスを追加
  let devices = get_all_output_devices()?;
  for (device_id, name) in devices {
    result.push(AudioOutputDevice {
      id: device_id.to_string(),
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
pub fn audio_destroy_player(
  state: State<'_, AudioController>,
  player_id: PlayerId,
) -> Result<(), String> {
  state.call(|respond_to| AudioCommand::DestroyPlayer {
    player_id,
    respond_to,
  })
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
pub fn audio_toggle_playback(
  state: State<'_, AudioController>,
  player_id: PlayerId,
) -> Result<AudioPlayerState, String> {
  state.call(|respond_to| AudioCommand::TogglePlayback {
    player_id,
    respond_to,
  })
}

#[tauri::command]
pub fn audio_stop(
  state: State<'_, AudioController>,
  player_id: PlayerId,
) -> Result<AudioPlayerState, String> {
  state.call(|respond_to| AudioCommand::Stop {
    player_id,
    respond_to,
  })
}

#[tauri::command]
pub fn audio_get_state(
  state: State<'_, AudioController>,
  player_id: PlayerId,
) -> Result<AudioPlayerState, String> {
  state.call(|respond_to| AudioCommand::GetState {
    player_id,
    respond_to,
  })
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
