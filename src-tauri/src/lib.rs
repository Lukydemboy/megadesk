mod pty;

use std::fs;

use tauri::{AppHandle, Manager};

use pty::AgentStore;

fn config_file(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("megadesk.json"))
}

#[tauri::command]
fn load_config(app: AppHandle) -> Result<String, String> {
    let path = config_file(&app)?;
    match fs::read_to_string(&path) {
        Ok(s) => Ok(s),
        Err(_) => Ok(String::new()),
    }
}

#[tauri::command]
fn save_config(app: AppHandle, contents: String) -> Result<(), String> {
    let path = config_file(&app)?;
    fs::write(&path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn home_dir(app: AppHandle) -> Result<String, String> {
    app.path()
        .home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

/// The user's login shell (e.g. `/bin/zsh`), so the frontend can spawn a
/// plain interactive terminal without hard-coding one.
#[tauri::command]
fn login_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
}

/// Persist a file dropped onto a terminal into a cache dir and hand back its
/// absolute path. The webview can't see where a dragged file actually lives
/// (and it may be a browser image with no path at all), so we take the bytes
/// and materialise our own copy for the agent to read.
#[tauri::command]
fn save_dropped_file(app: AppHandle, name: String, data: Vec<u8>) -> Result<String, String> {
    let stem = std::path::Path::new(&name)
        .file_name()
        .map(|s| s.to_string_lossy().replace(['/', '\\'], "_"))
        .filter(|s| !s.is_empty() && s != "." && s != "..")
        .unwrap_or_else(|| "dropped".to_string());

    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("dropped");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    // Drop stale copies (older than a day) so the cache doesn't grow forever.
    if let Ok(entries) = fs::read_dir(&dir) {
        let day = std::time::Duration::from_secs(60 * 60 * 24);
        for entry in entries.flatten() {
            let old = entry
                .metadata()
                .and_then(|m| m.modified())
                .map(|t| t.elapsed().map(|e| e > day).unwrap_or(false))
                .unwrap_or(false);
            if old {
                let _ = fs::remove_file(entry.path());
            }
        }
    }

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = dir.join(format!("{ts}-{stem}"));
    fs::write(&path, &data).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

/// Open a directory in Zed. Run through a login shell so `zed` resolves on
/// the user's real PATH (GUI apps on macOS don't inherit it).
#[tauri::command]
fn open_in_zed(path: String) -> Result<(), String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let quoted = format!("'{}'", path.replace('\'', "'\\''"));
    std::process::Command::new(&shell)
        .args(["-l", "-c", &format!("exec zed {quoted}")])
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Open a URL (an http/https link an agent printed in its terminal) in the
/// user's default browser. Run through a login shell so `open` resolves and
/// behaves like it would from the user's own shell.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    // Only hand off well-formed web URLs — never arbitrary shell fragments.
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("only http/https URLs are allowed".into());
    }
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let quoted = format!("'{}'", url.replace('\'', "'\\''"));
    std::process::Command::new(&shell)
        .args(["-l", "-c", &format!("exec open {quoted}")])
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AgentStore::default())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.show();
                let _ = win.set_focus();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            home_dir,
            login_shell,
            open_in_zed,
            open_url,
            save_dropped_file,
            pty::spawn_agent,
            pty::write_agent,
            pty::resize_agent,
            pty::kill_agent,
            pty::agent_running,
            pty::agent_snapshot,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
