//! Chat-mode agents: Claude Code driven over its structured stdio protocol
//! (`claude -p --input-format stream-json --output-format stream-json`)
//! instead of a PTY. Each stdout line is one JSON event; we forward the raw
//! line to the frontend, which turns the stream into chat messages.

use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Stdio};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

/// How many bytes of recent event lines to keep so a reconnecting window
/// (macOS keeps the app alive when its window closes) can rebuild the chat.
const MAX_LOG: usize = 8 * 1024 * 1024;

/// Upper bound on transcript entries returned when reopening a session.
const MAX_HISTORY: usize = 4000;

pub struct Chat {
    stdin: Mutex<ChildStdin>,
    child: Arc<Mutex<Child>>,
    /// Rolling log of the event lines sent to the frontend (deltas excluded).
    log: Arc<Mutex<EventLog>>,
}

#[derive(Default)]
struct EventLog {
    lines: VecDeque<String>,
    bytes: usize,
}

impl EventLog {
    fn push(&mut self, line: String) {
        self.bytes += line.len();
        self.lines.push_back(line);
        while self.bytes > MAX_LOG {
            match self.lines.pop_front() {
                Some(l) => self.bytes -= l.len(),
                None => break,
            }
        }
    }
}

#[derive(Default)]
pub struct ChatStore(pub Mutex<HashMap<String, Chat>>);

#[derive(Debug, Clone, Serialize)]
struct LineEvent {
    id: String,
    /// One JSON object, exactly as Claude Code printed it.
    line: String,
}

#[derive(Debug, Clone, Serialize)]
struct StderrEvent {
    id: String,
    text: String,
}

#[derive(Debug, Clone, Serialize)]
struct ExitEvent {
    id: String,
    code: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct ChatSpawnOpts {
    pub id: String,
    /// Program to run, normally "claude"; resolved like a terminal agent's.
    pub command: String,
    /// The agent's own extra args (e.g. `--model sonnet`).
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    /// Claude Code `--permission-mode` (default, acceptEdits, plan, ...).
    #[serde(default)]
    pub permission_mode: Option<String>,
    /// Session to continue (`--resume`).
    #[serde(default)]
    pub resume: Option<String>,
}

fn emit_line(app: &AppHandle, log: &Mutex<EventLog>, id: &str, line: String) {
    // Token deltas only matter live; the finished message follows anyway.
    if !line.starts_with("{\"type\":\"stream_event\"") {
        log.lock().unwrap().push(line.clone());
    }
    let _ = app.emit(
        "chat:event",
        LineEvent {
            id: id.to_string(),
            line,
        },
    );
}

#[tauri::command]
pub fn spawn_chat(
    app: AppHandle,
    store: State<'_, ChatStore>,
    opts: ChatSpawnOpts,
) -> Result<(), String> {
    if store.0.lock().unwrap().contains_key(&opts.id) {
        return Err(format!("chat {} already running", opts.id));
    }

    let mut args = opts.args.clone();
    args.extend(
        [
            "-p",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-partial-messages",
        ]
        .map(String::from),
    );
    if let Some(mode) = opts.permission_mode.as_ref().filter(|m| !m.is_empty()) {
        args.push("--permission-mode".into());
        args.push(mode.clone());
    }
    if let Some(sid) = opts.resume.as_ref().filter(|s| !s.is_empty()) {
        args.push("--resume".into());
        args.push(sid.clone());
    }

    let (program, args) = crate::platform::user_command(&opts.command, &args);
    let mut cmd = crate::platform::command(&program);
    cmd.args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(cwd) = opts.cwd.as_ref().filter(|c| !c.is_empty()) {
        cmd.current_dir(cwd);
    }

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    log::info!("spawned chat {} ({})", opts.id, opts.command);
    let stdin = child.stdin.take().ok_or("no stdin")?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stderr = child.stderr.take().ok_or("no stderr")?;

    let child = Arc::new(Mutex::new(child));
    let log: Arc<Mutex<EventLog>> = Arc::default();
    store.0.lock().unwrap().insert(
        opts.id.clone(),
        Chat {
            stdin: Mutex::new(stdin),
            child: child.clone(),
            log: log.clone(),
        },
    );

    // stdout: one JSON event per line. When it closes the process is done,
    // so this thread also reaps it and reports the exit.
    let out_app = app.clone();
    let out_id = opts.id.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            let line = line.trim();
            if line.starts_with('{') {
                emit_line(&out_app, &log, &out_id, line.to_string());
            }
        }
        let code = child.lock().unwrap().wait().ok().and_then(|s| s.code());
        if let Some(store) = out_app.try_state::<ChatStore>() {
            store.0.lock().unwrap().remove(&out_id);
        }
        let _ = out_app.emit("chat:exit", ExitEvent { id: out_id, code });
    });

    // stderr: surfaced as-is (bad flags, auth errors, ...).
    let err_app = app.clone();
    let err_id = opts.id.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines() {
            let Ok(text) = line else { break };
            if text.trim().is_empty() {
                continue;
            }
            let _ = err_app.emit(
                "chat:stderr",
                StderrEvent {
                    id: err_id.clone(),
                    text,
                },
            );
        }
    });

    Ok(())
}

fn write_line(chat: &Chat, value: &serde_json::Value) -> Result<(), String> {
    let mut w = chat.stdin.lock().unwrap();
    let mut line = serde_json::to_string(value).map_err(|e| e.to_string())?;
    line.push('\n');
    w.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
    w.flush().map_err(|e| e.to_string())
}

/// Send one user turn. `content` is a Messages API content value: a string
/// or an array of text/image blocks. Claude Code doesn't echo user input,
/// so the message is also logged and emitted like any other event.
#[tauri::command]
pub fn send_chat(
    app: AppHandle,
    store: State<'_, ChatStore>,
    id: String,
    content: serde_json::Value,
) -> Result<(), String> {
    let map = store.0.lock().unwrap();
    let chat = map.get(&id).ok_or("no such chat")?;
    let msg = serde_json::json!({
        "type": "user",
        "message": { "role": "user", "content": content },
    });
    write_line(chat, &msg)?;
    emit_line(&app, &chat.log, &id, msg.to_string());
    Ok(())
}

/// Stop the current turn; the process stays up for the next message.
#[tauri::command]
pub fn interrupt_chat(store: State<'_, ChatStore>, id: String) -> Result<(), String> {
    let map = store.0.lock().unwrap();
    let chat = map.get(&id).ok_or("no such chat")?;
    let req = serde_json::json!({
        "type": "control_request",
        "request_id": uuid::Uuid::new_v4().to_string(),
        "request": { "subtype": "interrupt" },
    });
    write_line(chat, &req)
}

#[tauri::command]
pub fn kill_chat(store: State<'_, ChatStore>, id: String) -> Result<(), String> {
    let map = store.0.lock().unwrap();
    if let Some(chat) = map.get(&id) {
        let _ = chat.child.lock().unwrap().kill();
    }
    Ok(())
}

#[tauri::command]
pub fn chat_running(store: State<'_, ChatStore>, id: String) -> bool {
    store.0.lock().unwrap().contains_key(&id)
}

/// The logged event lines of a still-running chat, so a reconnecting window
/// can rebuild it. `None` if no such chat.
#[tauri::command]
pub fn chat_log(store: State<'_, ChatStore>, id: String) -> Option<Vec<String>> {
    let map = store.0.lock().unwrap();
    let chat = map.get(&id)?;
    let log = chat.log.lock().unwrap();
    Some(log.lines.iter().cloned().collect())
}

/// The user/assistant entries of a saved Claude Code session transcript
/// (`<config dir>/projects/<project>/<session>.jsonl`), so a chat reopened
/// after a restart shows its earlier messages. Empty if it can't be found.
#[tauri::command]
pub fn chat_history(app: AppHandle, session_id: String) -> Vec<String> {
    if session_id.is_empty() || session_id.contains(['/', '\\', '.']) {
        return Vec::new();
    }
    let base = std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(std::path::PathBuf::from)
        .or_else(|| app.path().home_dir().ok().map(|h| h.join(".claude")));
    let Some(projects) = base.map(|b| b.join("projects")) else {
        return Vec::new();
    };
    let file = format!("{session_id}.jsonl");
    let path = std::fs::read_dir(&projects)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path().join(&file))
        .find(|p| p.is_file());
    let Some(path) = path else {
        return Vec::new();
    };
    let Ok(text) = std::fs::read_to_string(&path) else {
        return Vec::new();
    };

    let mut out: VecDeque<String> = VecDeque::new();
    for line in text.lines() {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let kind = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
        let flag = |k: &str| v.get(k).and_then(|b| b.as_bool()).unwrap_or(false);
        if !matches!(kind, "user" | "assistant") || flag("isSidechain") || flag("isMeta") {
            continue;
        }
        out.push_back(line.to_string());
        if out.len() > MAX_HISTORY {
            out.pop_front();
        }
    }
    out.into()
}
