use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};

use base64::Engine;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

/// How many bytes of recent pty output to keep so a reconnecting window
/// (macOS keeps the app alive when its window closes) can repaint.
const MAX_SNAPSHOT: usize = 512 * 1024;

/// A single running agent: a PTY plus the process attached to it.
pub struct Agent {
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    /// Rolling buffer of the most recent raw pty output.
    snapshot: Arc<Mutex<VecDeque<u8>>>,
}

#[derive(Default)]
pub struct AgentStore(pub Mutex<HashMap<String, Agent>>);

#[derive(Debug, Clone, Serialize)]
struct OutputEvent {
    id: String,
    /// base64-encoded raw bytes from the pty
    b64: String,
}

#[derive(Debug, Clone, Serialize)]
struct ExitEvent {
    id: String,
    code: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct SpawnOpts {
    pub id: String,
    /// Program to run, e.g. "claude". Resolved through a login shell so it
    /// picks up the user's real PATH (GUI apps on macOS don't inherit it).
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    pub cols: u16,
    pub rows: u16,
}

fn shell_quote(s: &str) -> String {
    // Single-quote for POSIX shells, escaping embedded single quotes.
    format!("'{}'", s.replace('\'', "'\\''"))
}

#[tauri::command]
pub fn spawn_agent(
    app: AppHandle,
    store: State<'_, AgentStore>,
    opts: SpawnOpts,
) -> Result<(), String> {
    {
        let map = store.0.lock().unwrap();
        if map.contains_key(&opts.id) {
            return Err(format!("agent {} already running", opts.id));
        }
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: opts.rows.max(1),
            cols: opts.cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let mut line = shell_quote(&opts.command);
    for a in &opts.args {
        line.push(' ');
        line.push_str(&shell_quote(a));
    }
    let invocation = format!("exec {line}");

    let mut cmd = CommandBuilder::new(&shell);
    cmd.arg("-l");
    cmd.arg("-c");
    cmd.arg(&invocation);
    if let Some(cwd) = opts.cwd.as_ref().filter(|c| !c.is_empty()) {
        cmd.cwd(cwd);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    log::info!("spawned agent {} ({})", opts.id, opts.command);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let killer = child.clone_killer();

    let snapshot: Arc<Mutex<VecDeque<u8>>> = Arc::new(Mutex::new(VecDeque::new()));

    let agent = Agent {
        writer: Mutex::new(writer),
        master: Mutex::new(pair.master),
        killer: Mutex::new(killer),
        snapshot: snapshot.clone(),
    };
    store.0.lock().unwrap().insert(opts.id.clone(), agent);

    // Reader thread: stream pty output to the frontend.
    let out_app = app.clone();
    let out_id = opts.id.clone();
    std::thread::spawn(move || {
        let engine = base64::engine::general_purpose::STANDARD;
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    {
                        let mut snap = snapshot.lock().unwrap();
                        snap.extend(&buf[..n]);
                        let overflow = snap.len().saturating_sub(MAX_SNAPSHOT);
                        if overflow > 0 {
                            snap.drain(..overflow);
                        }
                    }
                    let b64 = engine.encode(&buf[..n]);
                    let _ = out_app.emit(
                        "agent:output",
                        OutputEvent {
                            id: out_id.clone(),
                            b64,
                        },
                    );
                }
                Err(_) => break,
            }
        }
    });

    // Wait thread: report exit and drop the handle.
    let exit_app = app.clone();
    let exit_id = opts.id.clone();
    std::thread::spawn(move || {
        let mut child = child;
        let code = child.wait().ok().map(|s| s.exit_code() as i64);
        if let Some(store) = exit_app.try_state::<AgentStore>() {
            store.0.lock().unwrap().remove(&exit_id);
        }
        let _ = exit_app.emit(
            "agent:exit",
            ExitEvent {
                id: exit_id,
                code,
            },
        );
    });

    Ok(())
}

#[tauri::command]
pub fn write_agent(store: State<'_, AgentStore>, id: String, data: String) -> Result<(), String> {
    let map = store.0.lock().unwrap();
    let agent = map.get(&id).ok_or("no such agent")?;
    let mut w = agent.writer.lock().unwrap();
    w.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    w.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn resize_agent(
    store: State<'_, AgentStore>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let map = store.0.lock().unwrap();
    let agent = map.get(&id).ok_or("no such agent")?;
    let res = agent.master.lock().unwrap().resize(PtySize {
        rows: rows.max(1),
        cols: cols.max(1),
        pixel_width: 0,
        pixel_height: 0,
    });
    res.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn kill_agent(store: State<'_, AgentStore>, id: String) -> Result<(), String> {
    let map = store.0.lock().unwrap();
    if let Some(agent) = map.get(&id) {
        let _ = agent.killer.lock().unwrap().kill();
    }
    Ok(())
}

#[tauri::command]
pub fn agent_running(store: State<'_, AgentStore>, id: String) -> bool {
    store.0.lock().unwrap().contains_key(&id)
}

/// Base64 of the recent output buffer for a still-running agent, so a
/// reconnecting window can repaint its terminal. `None` if no such agent.
#[tauri::command]
pub fn agent_snapshot(store: State<'_, AgentStore>, id: String) -> Option<String> {
    let map = store.0.lock().unwrap();
    let agent = map.get(&id)?;
    let snap = agent.snapshot.lock().unwrap();
    let bytes: Vec<u8> = snap.iter().copied().collect();
    Some(base64::engine::general_purpose::STANDARD.encode(bytes))
}
