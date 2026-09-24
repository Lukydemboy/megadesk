mod platform;
mod pty;

use std::fs;

use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager};

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
    platform::login_shell()
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

/// Open a directory in Zed. Run through a login shell on macOS/Linux so
/// `zed` resolves on the user's real PATH (GUI apps on macOS don't inherit it).
#[tauri::command]
fn open_in_zed(path: String) -> Result<(), String> {
    let (program, args) = platform::user_command("zed", &[path]);
    platform::command(&program)
        .args(&args)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Open a URL (an http/https link an agent printed in its terminal) in the
/// user's default browser.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    // Only hand off well-formed web URLs — never arbitrary shell fragments.
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("only http/https URLs are allowed".into());
    }
    platform::open_url(&url).map_err(|e| e.to_string())
}

/// Current branch of the git repo at `path`, or `None` if it's not inside
/// one (or has no commits/branch yet).
#[tauri::command]
fn git_branch(path: String) -> Option<String> {
    let out = platform::command("git")
        .args(["branch", "--show-current"])
        .current_dir(path)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let branch = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if branch.is_empty() {
        None
    } else {
        Some(branch)
    }
}

/// The 5 most recently active local branches (by commit date) other than
/// the one currently checked out, most recent first.
#[tauri::command]
fn git_recent_branches(path: String) -> Vec<String> {
    let current = git_branch(path.clone()).unwrap_or_default();
    let out = platform::command("git")
        .args([
            "for-each-ref",
            "--sort=-committerdate",
            "--format=%(refname:short)",
            "refs/heads/",
        ])
        .current_dir(&path)
        .output();
    let Ok(out) = out else { return Vec::new() };
    if !out.status.success() {
        return Vec::new();
    }
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(|s| s.trim().to_string())
        .filter(|b| !b.is_empty() && *b != current)
        .take(5)
        .collect()
}

/// Check out an existing local branch in the git repo at `path`.
#[tauri::command]
fn git_switch_branch(path: String, branch: String) -> Result<(), String> {
    let out = platform::command("git")
        .args(["checkout", &branch])
        .current_dir(path)
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// Force-delete a local branch in the git repo at `path`. (Force, not the
/// safe `-d`, because "Manage branches" is meant to let you clear out
/// merged/abandoned branches without git second-guessing you — you already
/// confirmed in the UI.)
#[tauri::command]
fn git_delete_branch(path: String, branch: String) -> Result<(), String> {
    let out = platform::command("git")
        .args(["branch", "-D", &branch])
        .current_dir(path)
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// The repo's default branch ("main", "master", ...) — what "Reset to
/// main" switches back to. Prefers the remote's default (`origin/HEAD`,
/// authoritative when it's set up) and falls back to a local `main` or
/// `master` for repos without a remote tracking ref.
#[tauri::command]
fn git_default_branch(path: String) -> Option<String> {
    let out = platform::command("git")
        .args(["symbolic-ref", "refs/remotes/origin/HEAD"])
        .current_dir(&path)
        .output()
        .ok();
    if let Some(out) = out {
        if out.status.success() {
            let refname = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if let Some(name) = refname.strip_prefix("refs/remotes/origin/") {
                return Some(name.to_string());
            }
        }
    }
    for candidate in ["main", "master"] {
        let exists = platform::command("git")
            .args([
                "show-ref",
                "--verify",
                "--quiet",
                &format!("refs/heads/{candidate}"),
            ])
            .current_dir(&path)
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if exists {
            return Some(candidate.to_string());
        }
    }
    None
}

#[derive(serde::Serialize)]
struct BranchInfo {
    name: String,
    current: bool,
    #[serde(rename = "commitTime")]
    commit_time: i64,
    #[serde(rename = "commitHash")]
    commit_hash: String,
    #[serde(rename = "commitSubject")]
    commit_subject: String,
}

/// All local branches with their latest-commit info, most recently
/// committed first.
#[tauri::command]
fn git_all_branches(path: String) -> Vec<BranchInfo> {
    const SEP: &str = "\u{1f}";
    let format = format!(
        "%(refname:short){SEP}%(HEAD){SEP}%(committerdate:unix){SEP}%(objectname:short){SEP}%(subject)"
    );
    let out = platform::command("git")
        .args([
            "for-each-ref",
            "--sort=-committerdate",
            &format!("--format={format}"),
            "refs/heads/",
        ])
        .current_dir(&path)
        .output();
    let Ok(out) = out else { return Vec::new() };
    if !out.status.success() {
        return Vec::new();
    }
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|line| {
            let mut parts = line.split(SEP);
            let name = parts.next()?.to_string();
            let current = parts.next()? == "*";
            let commit_time = parts.next()?.parse().unwrap_or(0);
            let commit_hash = parts.next()?.to_string();
            let commit_subject = parts.next().unwrap_or("").to_string();
            if name.is_empty() {
                return None;
            }
            Some(BranchInfo {
                name,
                current,
                commit_time,
                commit_hash,
                commit_subject,
            })
        })
        .collect()
}

/// Split a `host` + `owner/repo`-ish `path` (as found in a git remote URL)
/// into a browsable source URL for the given branch, for the hosts we know
/// how to link into. `None` for anything unrecognised — the caller hides
/// the button rather than guessing.
fn branch_source_url(host: &str, repo_path: &str, branch: &str) -> Option<String> {
    let host_l = host.to_lowercase();
    let encoded_branch = branch.replace(' ', "%20");
    if host_l == "github.com" {
        return Some(format!("https://github.com/{repo_path}/tree/{encoded_branch}"));
    }
    if host_l == "bitbucket.org" {
        return Some(format!("https://bitbucket.org/{repo_path}/src/{encoded_branch}"));
    }
    if host_l == "gitlab.com" {
        return Some(format!("https://gitlab.com/{repo_path}/-/tree/{encoded_branch}"));
    }
    // Self-hosted Bitbucket Server: remote path looks like `scm/PROJECT/repo`.
    if let Some(rest) = repo_path.strip_prefix("scm/") {
        let mut it = rest.splitn(2, '/');
        let project = it.next()?;
        let repo = it.next()?;
        return Some(format!(
            "https://{host}/projects/{project}/repos/{repo}/browse?at=refs%2Fheads%2F{encoded_branch}"
        ));
    }
    None
}

/// Parse a git remote URL (`git@host:owner/repo.git` or
/// `https://host/owner/repo.git`) into `(host, owner/repo)`.
fn parse_remote(remote: &str) -> Option<(String, String)> {
    let remote = remote.trim();
    let (host, repo_path) = if let Some(rest) = remote.strip_prefix("git@") {
        rest.split_once(':')?
    } else if let Some(rest) = remote
        .strip_prefix("https://")
        .or_else(|| remote.strip_prefix("http://"))
        .or_else(|| remote.strip_prefix("ssh://"))
    {
        let rest = rest.rsplit('@').next().unwrap_or(rest); // drop user@ if present
        let (host, path) = rest.split_once('/')?;
        let host = host.split(':').next().unwrap_or(host); // drop :port
        (host, path)
    } else {
        return None;
    };
    let repo_path = repo_path.trim_end_matches(".git").trim_matches('/');
    if host.is_empty() || repo_path.is_empty() {
        return None;
    }
    Some((host.to_string(), repo_path.to_string()))
}

/// The `(host, owner/repo)` of the git repo's `origin` remote at `path`, or
/// `None` if there's no remote or it doesn't parse as one we recognise.
fn resolve_remote(path: &str) -> Option<(String, String)> {
    let out = platform::command("git")
        .args(["remote", "get-url", "origin"])
        .current_dir(path)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let remote = String::from_utf8_lossy(&out.stdout).trim().to_string();
    parse_remote(&remote)
}

/// A browsable URL for `branch` on the repo's `origin` remote (GitHub,
/// Bitbucket Cloud/Server, GitLab), or `None` if there's no remote or its
/// host isn't one we know how to link into.
#[tauri::command]
fn git_branch_source_url(path: String, branch: String) -> Option<String> {
    let (host, repo_path) = resolve_remote(&path)?;
    branch_source_url(&host, &repo_path, &branch)
}

/// A PR/merge-request creation URL for `branch` against the repo's default
/// branch on its `origin` remote (GitHub, Bitbucket Cloud/Server, GitLab),
/// or `None` if there's no remote or its host isn't one we know how to
/// link into. We don't resolve the actual default branch — the host picks
/// it as the compare target when we only give it the source.
fn pr_url(host: &str, repo_path: &str, branch: &str) -> Option<String> {
    let host_l = host.to_lowercase();
    let encoded_branch = branch.replace(' ', "%20");
    if host_l == "github.com" {
        return Some(format!("https://github.com/{repo_path}/pull/new/{encoded_branch}"));
    }
    if host_l == "bitbucket.org" {
        return Some(format!(
            "https://bitbucket.org/{repo_path}/pull-requests/new?source={encoded_branch}&t=1"
        ));
    }
    if host_l == "gitlab.com" {
        return Some(format!(
            "https://gitlab.com/{repo_path}/-/merge_requests/new?merge_request%5Bsource_branch%5D={encoded_branch}"
        ));
    }
    // Self-hosted Bitbucket Server: remote path looks like `scm/PROJECT/repo`.
    if let Some(rest) = repo_path.strip_prefix("scm/") {
        let mut it = rest.splitn(2, '/');
        let project = it.next()?;
        let repo = it.next()?;
        return Some(format!(
            "https://{host}/projects/{project}/repos/{repo}/pull-requests?create&sourceBranch=refs%2Fheads%2F{encoded_branch}"
        ));
    }
    None
}

#[tauri::command]
fn git_create_pr_url(path: String, branch: String) -> Option<String> {
    let (host, repo_path) = resolve_remote(&path)?;
    pr_url(&host, &repo_path, &branch)
}

/// Tauri's default menu, but with "Close Window" (Cmd/Ctrl+W) replaced by a
/// "Close Tab" item — see the comment in `run`'s `setup` for why.
fn build_menu(app_handle: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let pkg_info = app_handle.package_info();
    let about_metadata = AboutMetadata {
        name: Some(pkg_info.name.clone()),
        version: Some(pkg_info.version.to_string()),
        ..Default::default()
    };

    let close_tab = MenuItem::with_id(
        app_handle,
        "close_tab",
        "Close Tab",
        true,
        Some("CmdOrCtrl+W"),
    )?;

    let window_menu = Submenu::with_items(
        app_handle,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app_handle, None)?,
            &PredefinedMenuItem::maximize(app_handle, None)?,
            #[cfg(target_os = "macos")]
            &PredefinedMenuItem::separator(app_handle)?,
            &close_tab,
        ],
    )?;

    Menu::with_items(
        app_handle,
        &[
            #[cfg(target_os = "macos")]
            &Submenu::with_items(
                app_handle,
                pkg_info.name.clone(),
                true,
                &[
                    &PredefinedMenuItem::about(app_handle, None, Some(about_metadata))?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &PredefinedMenuItem::services(app_handle, None)?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &PredefinedMenuItem::hide(app_handle, None)?,
                    &PredefinedMenuItem::hide_others(app_handle, None)?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &PredefinedMenuItem::quit(app_handle, None)?,
                ],
            )?,
            #[cfg(not(target_os = "macos"))]
            &Submenu::with_items(app_handle, "File", true, &[&PredefinedMenuItem::quit(app_handle, None)?])?,
            // macOS needs these for clipboard shortcuts to reach the
            // webview at all. Elsewhere the webview handles them natively,
            // and the menu's Ctrl+C/V/A/Z accelerators would swallow those
            // keys before the terminal sees them (no Ctrl+C to interrupt).
            #[cfg(target_os = "macos")]
            &Submenu::with_items(
                app_handle,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app_handle, None)?,
                    &PredefinedMenuItem::redo(app_handle, None)?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &PredefinedMenuItem::cut(app_handle, None)?,
                    &PredefinedMenuItem::copy(app_handle, None)?,
                    &PredefinedMenuItem::paste(app_handle, None)?,
                    &PredefinedMenuItem::select_all(app_handle, None)?,
                ],
            )?,
            #[cfg(target_os = "macos")]
            &Submenu::with_items(
                app_handle,
                "View",
                true,
                &[&PredefinedMenuItem::fullscreen(app_handle, None)?],
            )?,
            &window_menu,
        ],
    )
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

                // Toggling native fullscreen on macOS moves the webview into
                // a new host window; WKWebView doesn't reliably re-fire a DOM
                // focus event afterwards, leaving the terminal unable to
                // receive keystrokes until the user clicks it. Tell the
                // frontend explicitly whenever the window regains key focus
                // so it can restore focus to the active terminal itself.
                let focus_win = win.clone();
                win.on_window_event(move |event| {
                    if let tauri::WindowEvent::Focused(true) = event {
                        let _ = focus_win.emit("window-focused", ());
                    }
                });
            }

            // The app has one window but many terminal tabs per pane, so
            // Cmd/Ctrl+W closing the whole window (the OS-default menu
            // binding) would be surprising — swap it for a "Close Tab" item
            // that the frontend handles by closing the focused pane's active
            // tab instead.
            let handle = app.handle();
            app.set_menu(build_menu(handle)?)?;
            app.on_menu_event(|app, event| {
                if event.id() == "close_tab" {
                    if let Some(win) = app.get_webview_window("main") {
                        let _ = win.emit("close-active-tab", ());
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            home_dir,
            login_shell,
            open_in_zed,
            open_url,
            git_branch,
            git_recent_branches,
            git_switch_branch,
            git_delete_branch,
            git_all_branches,
            git_default_branch,
            git_branch_source_url,
            git_create_pr_url,
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
