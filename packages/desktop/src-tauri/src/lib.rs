//! React App Explorer's desktop shell. Starts the sidecar (local server + scanner + the built viewer,
//! one Bun executable), waits for it to print its URL and points the window there. The page talks
//! to the sidecar over HTTP like it does to Vite in development — no Tauri IPC is exposed to it.

use std::sync::Mutex;
use tauri::{Manager, RunEvent, Url};
use tauri_plugin_shell::{process::{CommandChild, CommandEvent}, ShellExt};

/// The running sidecar, killed when the app exits.
struct Sidecar(Mutex<Option<CommandChild>>);

const URL_PREFIX: &str = "RAE_SERVER_URL=";

/// Shows why the sidecar stopped, on the loading page (navigating back to it if the viewer was open).
fn show_failure(handle: &tauri::AppHandle, reason: &str, details: &str, navigated: bool) {
    let Some(window) = handle.get_webview_window("main") else { return };
    let script = format!(
        "window.raeServerFailed && window.raeServerFailed({}, {})",
        serde_json::to_string(reason).unwrap_or_default(),
        serde_json::to_string(details).unwrap_or_default()
    );
    if navigated {
        // the viewer is open: go back to the bundled page first (it defines raeServerFailed)
        let home = if cfg!(windows) { "http://tauri.localhost/" } else { "tauri://localhost/" };
        if let Ok(url) = Url::parse(home) {
            let _ = window.navigate(url);
        }
    }
    // the page may still be loading: try now and again shortly (the call is idempotent)
    let _ = window.eval(&script);
    std::thread::spawn(move || {
        for ms in [400, 1500] {
            std::thread::sleep(std::time::Duration::from_millis(ms));
            let _ = window.eval(&script);
        }
    });
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Sidecar(Mutex::new(None)))
        .setup(|app| {
            // TypeScript 7's native binary ships as a resource folder, with the lib.*.d.ts files it needs.
            let tsgo = app.path().resource_dir()?.join("tsgo").join(format!("tsc{}", std::env::consts::EXE_SUFFIX));
            let snapshots = app.path().app_data_dir()?.join("snapshots");
            // ~/Library/Logs/dev.rae.explorer/server.log on macOS: what the user sends when something breaks
            let log_file = app.path().app_log_dir()?.join("server.log");

            let spawned = app
                .shell()
                .sidecar("rae-server")?
                .args(["--port", "0", "--snapshots"])
                .arg(snapshots)
                .arg("--log")
                .arg(log_file)
                .env("RAE_TSGO_PATH", tsgo)
                .spawn();
            let (mut events, child) = match spawned {
                Ok(pair) => pair,
                Err(e) => {
                    show_failure(app.handle(), "It couldn't be started.", &e.to_string(), false);
                    return Ok(());
                }
            };
            app.state::<Sidecar>().0.lock().unwrap().replace(child);

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut navigated = false;
                // the sidecar's last stderr lines, shown if it dies
                let mut stderr: Vec<String> = Vec::new();
                while let Some(event) = events.recv().await {
                    match event {
                        CommandEvent::Stdout(line) if !navigated => {
                            let line = String::from_utf8_lossy(&line);
                            if let Some(url) = line.trim().strip_prefix(URL_PREFIX) {
                                if let (Some(window), Ok(url)) = (handle.get_webview_window("main"), Url::parse(url)) {
                                    eprintln!("[rae] opening {url}");
                                    let _ = window.navigate(url);
                                    navigated = true;
                                }
                            }
                        }
                        CommandEvent::Stderr(line) => {
                            let line = String::from_utf8_lossy(&line).trim_end().to_string();
                            eprintln!("[rae-server] {line}");
                            stderr.push(line);
                            if stderr.len() > 20 {
                                stderr.remove(0);
                            }
                        }
                        CommandEvent::Error(e) => {
                            stderr.push(e);
                        }
                        CommandEvent::Terminated(status) => {
                            let reason = match (status.code, status.signal) {
                                (_, Some(9)) => "It was killed by macOS (signal 9) — usually Gatekeeper blocking an app downloaded from the internet.".to_string(),
                                (_, Some(sig)) => format!("It was stopped by signal {sig}."),
                                (Some(code), _) => format!("It exited with code {code}."),
                                _ => "It exited.".to_string(),
                            };
                            eprintln!("[rae-server] exited: {reason}");
                            show_failure(&handle, &reason, &stderr.join("\n"), navigated);
                            break;
                        }
                        _ => {}
                    }
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the app");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(child) = handle.state::<Sidecar>().0.lock().unwrap().take() {
                let _ = child.kill();
            }
        }
    });
}
