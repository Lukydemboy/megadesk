//! Directory listing for the "Open project" palette's folder browser.

use std::fs;
use std::path::Path;

use serde::Serialize;

#[derive(Serialize)]
pub struct DirEntry {
    name: String,
    path: String,
    /// The folder is a git repo root, so the palette can badge it.
    git: bool,
}

/// The sub-folders of `path` (files are skipped), sorted by name. Entries
/// that can't be read, e.g. a permission-denied folder, are left out.
#[tauri::command]
pub fn list_dirs(path: String) -> Result<Vec<DirEntry>, String> {
    let mut dirs: Vec<DirEntry> = fs::read_dir(&path)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .map(|e| DirEntry {
            name: e.file_name().to_string_lossy().to_string(),
            git: Path::new(&e.path()).join(".git").exists(),
            path: e.path().to_string_lossy().to_string(),
        })
        .collect();
    dirs.sort_by_key(|d| d.name.to_lowercase());
    Ok(dirs)
}
