//! OS differences in how we launch user commands and helper processes.
//!
//! On macOS/Linux user commands go through the login shell
//! (`$SHELL -l -c 'exec ...'`) so GUI launches see the user's real PATH.
//! Windows has no `$SHELL` or login shell — GUI apps already get the full
//! PATH — so there we resolve the program ourselves and run it directly.

use std::process::Command;

/// A `std::process::Command` for a background helper (git, zed, the URL
/// opener). A Windows release build is a GUI-subsystem app with no console,
/// so without CREATE_NO_WINDOW every console child (e.g. the `git` behind
/// the branch chip, polled every couple of seconds) flashes up its own
/// console window and steals focus.
pub fn command(program: &str) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// The user's interactive shell, for plain terminals.
pub fn login_shell() -> String {
    #[cfg(windows)]
    {
        "powershell.exe".to_string()
    }
    #[cfg(not(windows))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
    }
}

/// Program + args that launch the user command `program args...`.
pub fn user_command(program: &str, args: &[String]) -> (String, Vec<String>) {
    #[cfg(windows)]
    {
        (resolve_program(program), args.to_vec())
    }
    #[cfg(not(windows))]
    {
        let quote = |s: &str| format!("'{}'", s.replace('\'', "'\\''"));
        let mut line = quote(program);
        for a in args {
            line.push(' ');
            line.push_str(&quote(a));
        }
        (
            login_shell(),
            vec!["-l".into(), "-c".into(), format!("exec {line}")],
        )
    }
}

/// Find `program` on PATH, trying the PATHEXT extensions *before* the bare
/// name: npm puts an extensionless POSIX shim (`claude`) next to the
/// runnable `claude.cmd`, and picking the shim fails to launch. Returns the
/// input unchanged if nothing matches, so the spawn error names it.
#[cfg(windows)]
fn resolve_program(program: &str) -> String {
    use std::path::Path;

    let has_dir = program.contains(['\\', '/']);
    let has_ext = Path::new(program).extension().is_some();
    let exts: Vec<String> = std::env::var("PATHEXT")
        .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into())
        .split(';')
        .filter(|e| !e.is_empty())
        .map(str::to_string)
        .collect();

    let try_in = |base: &Path| -> Option<String> {
        if !has_ext {
            for ext in &exts {
                let mut p = base.as_os_str().to_owned();
                p.push(ext);
                let p = std::path::PathBuf::from(p);
                if p.is_file() {
                    return Some(p.to_string_lossy().into_owned());
                }
            }
        }
        base.is_file().then(|| base.to_string_lossy().into_owned())
    };

    if has_dir {
        return try_in(Path::new(program)).unwrap_or_else(|| program.to_string());
    }
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            if let Some(found) = try_in(&dir.join(program)) {
                return found;
            }
        }
    }
    program.to_string()
}

/// Open an http(s) URL in the default browser.
pub fn open_url(url: &str) -> std::io::Result<()> {
    #[cfg(windows)]
    let mut cmd = {
        // Unlike `cmd /c start`, this doesn't treat `&` in the URL as a
        // command separator.
        let mut c = command("rundll32.exe");
        c.args(["url.dll,FileProtocolHandler", url]);
        c
    };
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = command("open");
        c.arg(url);
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = {
        let mut c = command("xdg-open");
        c.arg(url);
        c
    };
    cmd.spawn().map(|_| ())
}
