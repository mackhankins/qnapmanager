pub mod client;
pub mod commands;
pub mod config;
pub mod error;
pub mod models;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::save_config,
            commands::test_connection,
            commands::list_library,
            commands::toggle_temporary_tag,
            commands::delete_item,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
