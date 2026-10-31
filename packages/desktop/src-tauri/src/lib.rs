//! React App Explorer's desktop shell. Starts the sidecar (local server + scanner + the built viewer,
//! one Bun executable), waits for it to print its URL and points the window there. The page talks
//! to the sidecar over HTTP like it does to Vite in development — no Tauri IPC is exposed to it.

use std::sync::Mutex;
use tauri::{Manager, RunEvent, Url};
use tauri_plugin_shell::{process::{CommandChild, CommandEvent}, ShellExt};

/// The running sidecar, killed when the app exits.
struct Sidecar(Mutex<Option<CommandChild>>);

const URL_PREFIX: &str = "RAE_SERVER_URL=";

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Sidecar(Mutex::new(None)))
        .setup(|app| {
            // TypeScript 7's native binary ships as a resource folder, with the lib.*.d.ts files it needs.
            let tsgo = app.path().resource_dir()?.join("tsgo").join(format!("tsc{}", std::env::consts::EXE_SUFFIX));
            let snapshots = app.path().app_data_dir()?.join("snapshots");

            let (mut events, child) = app
                .shell()
                .sidecar("rae-server")?
                .args(["--port", "0", "--snapshots"])
                .arg(snapshots)
                .env("RAE_TSGO_PATH", tsgo)
                .spawn()?;
            app.state::<Sidecar>().0.lock().unwrap().replace(child);

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut navigated = false;
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
                        CommandEvent::Stderr(line) => eprintln!("[rae-server] {}", String::from_utf8_lossy(&line).trim_end()),
                        CommandEvent::Terminated(status) => {
                            eprintln!("[rae-server] exited: {:?}", status.code);
                            if let Some(window) = handle.get_webview_window("main") {
                                let _ = window.eval("document.getElementById('msg') && (document.getElementById('msg').textContent = 'The local server stopped. Restart the app.')");
                            }
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
