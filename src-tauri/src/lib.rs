mod audio;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(audio::AudioController::new())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      audio::audio_list_output_devices,
      audio::audio_create_player,
      audio::audio_destroy_player,
      audio::audio_set_player_device,
      audio::audio_load_mp3,
      audio::audio_toggle_playback,
      audio::audio_stop,
      audio::audio_get_state,
      audio::audio_play_pcm_f32,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
