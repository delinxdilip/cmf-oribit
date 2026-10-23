use serde::{Deserialize, Serialize};
use std::{
    io::{BufRead, BufReader},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

// MARK: - Event protocol

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DialEvent {
    #[serde(rename = "type")]
    event_type: String,
}

impl DialEvent {
    fn is_valid(&self) -> bool {
        matches!(
            self.event_type.as_str(),
            "ROTATE_CW"
                | "ROTATE_CCW"
                | "PRESS_SINGLE_TOGGLE"
                | "PRESS_SINGLE_PLAY"
                | "PRESS_SINGLE_PAUSE"
                | "PRESS_DOUBLE"
                | "PRESS_TRIPLE"
        )
    }
}

// MARK: - Detector process state

#[derive(Default)]
struct DetectorState {
    child: Arc<Mutex<Option<Child>>>,
}

// MARK: - Start detector

#[tauri::command]
fn start_detector(
    app: AppHandle,
    state: State<'_, DetectorState>,
) -> Result<(), String> {
    let mut child_slot = state
        .child
        .lock()
        .map_err(|_| "Detector state lock is unavailable".to_string())?;

    // Prevent accidentally launching multiple detector processes.
    if child_slot.is_some() {
        return Err("The dial detector is already running".to_string());
    }

    // During development, the executable is built by native/macos/Makefile.
    let detector_path: PathBuf =
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../native/macos/orbit");

    if !detector_path.is_file() {
        return Err(format!(
            "Detector executable not found at {}. Run `make` in native/macos first.",
            detector_path.display()
        ));
    }

    let mut child = Command::new(&detector_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|error| {
            format!("Failed to launch dial detector: {error}")
        })?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture detector stdout".to_string())?;

    // Keep the child process handle so it can be stopped later.
    *child_slot = Some(child);
    drop(child_slot);

    println!("Oribit: dial detector started");

    // Share the process slot with the reader thread so it can clean
    // up the child handle if the detector exits unexpectedly.
    let child_slot = Arc::clone(&state.child);
    let app_handle = app.clone();

    thread::spawn(move || {
        let reader = BufReader::new(stdout);

        for line in reader.lines() {
            let line = match line {
                Ok(line) => line,
                Err(error) => {
                    eprintln!("Oribit: failed to read detector output: {error}");
                    break;
                }
            };

            if line.trim().is_empty() {
                continue;
            }

            match serde_json::from_str::<DialEvent>(&line) {
                Ok(event) if event.is_valid() => {
                    if let Err(error) =
                        app_handle.emit("dial-event", event.clone())
                    {
                        eprintln!("Oribit: failed to emit dial event: {error}");
                    }
                }
                Ok(event) => {
                    eprintln!(
                        "Oribit: ignoring unknown event type: {}",
                        event.event_type
                    );
                }
                Err(error) => {
                    eprintln!(
                        "Oribit: invalid JSON from detector: {error}"
                    );
                }
            }
        }

        println!("Oribit: detector output stream closed");

        // Release the stored child handle if this reader observed EOF.
        if let Ok(mut slot) = child_slot.lock() {
            if let Some(mut child) = slot.take() {
                let _ = child.wait();
            }
        }
    });

    Ok(())
}

// MARK: - Stop detector

#[tauri::command]
fn stop_detector(
    state: State<'_, DetectorState>,
) -> Result<(), String> {
    let child = {
        let mut slot = state
            .child
            .lock()
            .map_err(|_| "Detector state lock is unavailable".to_string())?;

        slot.take()
    };

    if let Some(mut child) = child {
        // The detector may already have exited.
        let _ = child.kill();
        let _ = child.wait();

        println!("Oribit: dial detector stopped");
    }

    Ok(())
}

// MARK: - Dial overlay window

#[tauri::command]
fn show_dial(window: WebviewWindow) -> Result<(), String> {
    if window.label() != "dial" {
        return Err("show_dial must be called from the dial window".to_string());
    }

    window.show().map_err(|error| format!("Could not show dial: {error}"))?;
    window.set_focus().map_err(|error| format!("Could not focus dial: {error}"))?;
    Ok(())
}

#[tauri::command]
fn hide_dial(window: WebviewWindow) -> Result<(), String> {
    if window.label() != "dial" {
        return Err("hide_dial must be called from the dial window".to_string());
    }

    window.hide().map_err(|error| format!("Could not hide dial: {error}"))?;
    Ok(())
}

// MARK: - Tauri application

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(DetectorState::default())
        .invoke_handler(tauri::generate_handler![
            start_detector,
            stop_detector,
            show_dial,
            hide_dial
        ])
        .build(tauri::generate_context!())
        .expect("error while building Oribit");

    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            let state = app_handle.state::<DetectorState>();

            if let Ok(mut slot) = state.child.lock() {
                if let Some(mut child) = slot.take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }
    });
}