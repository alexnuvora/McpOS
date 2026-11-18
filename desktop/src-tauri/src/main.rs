#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine;
use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::{path::{Path, PathBuf}, sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}}, time::Duration};
use xcap::{image::{codecs::jpeg::JpegEncoder, DynamicImage}, Monitor};
use uiautomation::UIAutomation;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

const SUPABASE_URL: &str = "https://kvwwabuqydwsbhlcqxwz.supabase.co";
const SUPABASE_ANON_KEY: Option<&str> = option_env!("SUPABASE_ANON_KEY");
const KEYRING_SERVICE: &str = "co.mcpos.desktop";
const TOKEN_KEY: &str = "device_token";
const DEVICE_ID_KEY: &str = "device_id";

#[derive(Serialize)]
struct DeviceStatus {
    paired: bool,
    connected: bool,
    device_id: Option<String>,
}

#[derive(Deserialize)]
struct PairingResponse {
    token: String,
    device_id: String,
    device_name: String,
}

fn credential(key: &str) -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, key).map_err(|error| format!("Windows Credential Manager: {error}"))
}

fn stored_token() -> Option<String> {
    credential(TOKEN_KEY).ok()?.get_password().ok()
}

async fn heartbeat() -> bool {
    let Some(token) = stored_token() else { return false };
    let Some(api_key) = SUPABASE_ANON_KEY else { return false };
    if api_key.is_empty() { return false; }

    reqwest::Client::new()
        .post(format!("{SUPABASE_URL}/functions/v1/device-heartbeat"))
        .header("apikey", api_key)
        .bearer_auth(token)
        .send()
        .await
        .map(|response| response.status().is_success())
        .unwrap_or(false)
}

struct ScreenCaptureConsent(Arc<AtomicBool>);
struct AccessibilityConsent(Arc<AtomicBool>);
struct ApprovedFolders(Arc<Mutex<Vec<PathBuf>>>);

#[tauri::command]
fn get_accessibility_consent(consent: tauri::State<'_, AccessibilityConsent>) -> bool {
    consent.0.load(Ordering::Relaxed)
}

#[tauri::command]
fn set_accessibility_consent(enabled: bool, consent: tauri::State<'_, AccessibilityConsent>) -> bool {
    consent.0.store(enabled, Ordering::Relaxed);
    enabled
}

fn get_accessibility_snapshot() -> Result<serde_json::Value, String> {
    let automation = UIAutomation::new().map_err(|_| "Windows UI Automation could not start.".to_string())?;
    let root = automation.get_root_element().map_err(|_| "Windows desktop accessibility tree is unavailable.".to_string())?;
    let walker = automation.get_control_view_walker().map_err(|_| "Windows accessibility control view is unavailable.".to_string())?;
    let children = walker.get_children(&root).unwrap_or_default();
    let mut windows = Vec::new();
    for element in children.iter().take(40) {
        let name = element.get_name().unwrap_or_default();
        let class_name = element.get_classname().unwrap_or_default();
        let control_type = element.get_localized_control_type().unwrap_or_default();
        let process_id = element.get_process_id().unwrap_or_default();
        windows.push(serde_json::json!({
            "name": name.chars().take(160).collect::<String>(),
            "class_name": class_name.chars().take(100).collect::<String>(),
            "control_type": control_type.chars().take(60).collect::<String>(),
            "process_id": process_id
        }));
    }
    Ok(serde_json::json!({ "scope": "top_level_windows", "count": windows.len(), "windows": windows }))
}
#[tauri::command]
fn get_screen_capture_consent(consent: tauri::State<'_, ScreenCaptureConsent>) -> bool {
    consent.0.load(Ordering::Relaxed)
}

#[tauri::command]
fn set_screen_capture_consent(enabled: bool, consent: tauri::State<'_, ScreenCaptureConsent>) -> bool {
    consent.0.store(enabled, Ordering::Relaxed);
    enabled
}

fn capture_screen_jpeg() -> Result<(String, u32, u32), String> {
    let monitors = Monitor::all().map_err(|_| "Windows could not enumerate the displays.".to_string())?;
    let monitor = monitors.first().ok_or("No active display was found.".to_string())?;
    let image = monitor.capture_image().map_err(|_| "Windows screen capture failed.".to_string())?;
    let width = image.width();
    let height = image.height();
    let mut bytes = Vec::new();
    JpegEncoder::new_with_quality(&mut bytes, 68)
        .encode_image(&DynamicImage::ImageRgba8(image))
        .map_err(|_| "Could not encode the screen image.".to_string())?;
    if bytes.len() > 4 * 1024 * 1024 {
        return Err("Screen image exceeds the 4 MB safety limit.".to_string());
    }
    Ok((base64::engine::general_purpose::STANDARD.encode(bytes), width, height))
}
#[tauri::command]
fn get_device_status(connected: tauri::State<'_, Arc<AtomicBool>>) -> DeviceStatus {
    let paired = stored_token().is_some();
    let device_id = credential(DEVICE_ID_KEY).ok().and_then(|entry| entry.get_password().ok());
    DeviceStatus { paired, connected: connected.load(Ordering::Relaxed), device_id }
}

#[tauri::command]
async fn pair_device(code: String, connected: tauri::State<'_, Arc<AtomicBool>>) -> Result<String, String> {
    let connection_state = Arc::clone(&connected);
    let clean_code: String = code.chars().filter(|character| character.is_ascii_alphanumeric()).collect::<String>().to_uppercase();
    if clean_code.len() != 10 {
        return Err("Enter the 10-character code shown in your McpOS dashboard.".into());
    }
    let api_key = SUPABASE_ANON_KEY.ok_or("Desktop build is missing its Supabase public API key. Install the latest build.")?;
    if api_key.is_empty() {
        return Err("Desktop build is missing its Supabase public API key. Install the latest build.".into());
    }

    let response = reqwest::Client::new()
        .post(format!("{SUPABASE_URL}/functions/v1/pairing-complete"))
        .header("apikey", api_key)
        .json(&serde_json::json!({ "code": clean_code }))
        .send()
        .await
        .map_err(|_| "Could not reach the McpOS pairing service. Check your internet connection.".to_string())?;

    if !response.status().is_success() {
        let status = response.status();
        let details = response.json::<serde_json::Value>().await.unwrap_or_default();
        let message = details.get("error").and_then(|value| value.as_str()).unwrap_or("Pairing failed.");
        return Err(format!("{message} ({status})"));
    }

    let paired = response.json::<PairingResponse>().await
        .map_err(|_| "The pairing service returned an invalid response.".to_string())?;
    credential(TOKEN_KEY)?.set_password(&paired.token)
        .map_err(|_| "Could not securely store the device credential in Windows Credential Manager.".to_string())?;
    credential(DEVICE_ID_KEY)?.set_password(&paired.device_id)
        .map_err(|_| "Could not store the device identity.".to_string())?;

    connection_state.store(heartbeat().await, Ordering::Relaxed);
    Ok(paired.device_name)
}


#[derive(Deserialize)]
struct RelayCommand {
    id: String,
    command: String,
    payload: serde_json::Value,
}

#[derive(Deserialize)]
#[tauri::command]
fn get_approved_folders(folders: tauri::State<'_, ApprovedFolders>) -> Vec<String> {
    folders.0.lock().map(|items| items.iter().map(|path| path.display().to_string()).collect()).unwrap_or_default()
}

#[tauri::command]
fn pick_approved_folder(folders: tauri::State<'_, ApprovedFolders>) -> Result<Vec<String>, String> {
    let Some(selected) = rfd::FileDialog::new().pick_folder() else {
        return Ok(get_folder_paths(&folders.0));
    };
    let canonical = selected.canonicalize().map_err(|_| "Could not resolve the selected folder.".to_string())?;
    let mut approved = folders.0.lock().map_err(|_| "Folder approval state is unavailable.".to_string())?;
    if !approved.iter().any(|existing| existing == &canonical) { approved.push(canonical); }
    Ok(approved.iter().map(|path| path.display().to_string()).collect())
}

#[tauri::command]
fn remove_approved_folder(path: String, folders: tauri::State<'_, ApprovedFolders>) -> Result<Vec<String>, String> {
    let target = PathBuf::from(path).canonicalize().map_err(|_| "Folder is no longer available.".to_string())?;
    let mut approved = folders.0.lock().map_err(|_| "Folder approval state is unavailable.".to_string())?;
    approved.retain(|existing| existing != &target);
    Ok(approved.iter().map(|item| item.display().to_string()).collect())
}

fn get_folder_paths(folders: &Arc<Mutex<Vec<PathBuf>>>) -> Vec<String> {
    folders.lock().map(|items| items.iter().map(|path| path.display().to_string()).collect()).unwrap_or_default()
}

fn execute_files_command(command: &RelayCommand, folders: &Arc<Mutex<Vec<PathBuf>>>) -> (serde_json::Value, Option<String>) {
    let approved = match folders.lock() { Ok(items) => items.clone(), Err(_) => return (serde_json::json!({}), Some("Approved-folder state is unavailable.".to_string())) };
    if command.command == "files.list" && command.payload.get("path").is_none() {
        let roots: Vec<_> = approved.iter().map(|path| serde_json::json!({ "path": path.display().to_string(), "name": path.file_name().and_then(|v| v.to_str()).unwrap_or("Approved folder") })).collect();
        return (serde_json::json!({ "approved_folders": roots }), None);
    }
    let requested = match command.payload.get("path").and_then(|value| value.as_str()) {
        Some(value) if !value.trim().is_empty() => value,
        _ => return (serde_json::json!({}), Some("A file or folder path is required.".to_string())),
    };
    let target = match Path::new(requested).canonicalize() {
        Ok(path) => path,
        Err(_) => return (serde_json::json!({}), Some("The requested path does not exist.".to_string())),
    };
    if !approved.iter().any(|root| target.starts_with(root)) {
        return (serde_json::json!({}), Some("Access denied. This path is outside every locally approved folder.".to_string()));
    }
    if command.command == "files.list" {
        let entries = match std::fs::read_dir(&target) { Ok(items) => items, Err(_) => return (serde_json::json!({}), Some("Could not read this folder.".to_string())) };
        let mut items = Vec::new();
        for entry in entries.flatten().take(100) {
            let kind = match entry.file_type() { Ok(kind) if kind.is_file() => "file", Ok(kind) if kind.is_dir() => "folder", _ => continue };
            let name = entry.file_name().to_string_lossy().to_string();
            let size = entry.metadata().map(|meta| meta.len()).unwrap_or(0);
            items.push(serde_json::json!({ "name": name, "kind": kind, "size_bytes": size }));
        }
        return (serde_json::json!({ "path": target.display().to_string(), "items": items, "truncated": items.len() >= 100 }), None);
    }
    if command.command == "files.read" {
        if !target.is_file() { return (serde_json::json!({}), Some("Only files can be read.".to_string())); }
        let allowed_extensions = ["txt","md","csv","json","yaml","yml","toml","log","html","css","js","ts","tsx","rs","py","xml"];
        let extension = target.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
        if !allowed_extensions.contains(&extension.as_str()) { return (serde_json::json!({}), Some("This file type is not enabled for text reading.".to_string())); }
        let metadata = match std::fs::metadata(&target) { Ok(meta) => meta, Err(_) => return (serde_json::json!({}), Some("Could not inspect the requested file.".to_string())) };
        if metadata.len() > 512 * 1024 { return (serde_json::json!({}), Some("File exceeds the 512 KB text-read limit.".to_string())); }
        let content = match std::fs::read_to_string(&target) { Ok(text) => text, Err(_) => return (serde_json::json!({}), Some("File is not valid UTF-8 text or could not be read.".to_string())) };
        return (serde_json::json!({ "path": target.display().to_string(), "content": content }), None);
    }
    (serde_json::json!({}), Some("Unsupported file operation.".to_string()))
}
struct RelayPollResponse {
    command: Option<RelayCommand>,
}

async fn poll_relay_once(connected: &Arc<AtomicBool>, screen_consent: &Arc<AtomicBool>, accessibility_consent: &Arc<AtomicBool>, approved_folders: &Arc<Mutex<Vec<PathBuf>>>) {
    let Some(token) = stored_token() else { return };
    let Some(api_key) = SUPABASE_ANON_KEY else { return };
    if api_key.is_empty() { return; }

    let client = reqwest::Client::new();
    let response = match client
        .post(format!("{SUPABASE_URL}/functions/v1/device-poll"))
        .header("apikey", api_key)
        .bearer_auth(&token)
        .json(&serde_json::json!({}))
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => response,
        _ => return,
    };

    let Ok(envelope) = response.json::<RelayPollResponse>().await else { return };
    let Some(command) = envelope.command else { return };

    let device_id = credential(DEVICE_ID_KEY).ok().and_then(|entry| entry.get_password().ok());
    let (result, error_message) = match command.command.as_str() {
        "desktop.status" => (
            serde_json::json!({
                "paired": true,
                "connected": connected.load(Ordering::Relaxed),
                "device_id": device_id,
                "agent_version": env!("CARGO_PKG_VERSION"),
                "supported_commands": ["desktop.status", "screen.capture", "desktop.accessibility"],
                "execution_enabled": false,
                "permissions": {
                    "screen.capture": screen_consent.load(Ordering::Relaxed),
                    "screen.accessibility": accessibility_consent.load(Ordering::Relaxed),
                    "input.pointer": false,
                    "input.keyboard": false,
                    "browser.control": false,
                    "files.read": false,
                    "files.write": false,
                    "apps.launch": false
                }
            }),
            None,
        ),
        "screen.capture" => {
            if !screen_consent.load(Ordering::Relaxed) {
                (serde_json::json!({}), Some("Screen capture consent is switched off on this Windows computer.".to_string()))
            } else {
                match capture_screen_jpeg() {
                    Ok((image_base64, width, height)) => (
                        serde_json::json!({ "image_base64": image_base64, "mime_type": "image/jpeg", "width": width, "height": height }),
                        None,
                    ),
                    Err(message) => (serde_json::json!({}), Some(message)),
                }
            }
        },
        "desktop.accessibility" => {
            if !accessibility_consent.load(Ordering::Relaxed) {
                (serde_json::json!({}), Some("Windows accessibility consent is switched off on this computer.".to_string()))
            } else {
                match get_accessibility_snapshot() {
                    Ok(snapshot) => (snapshot, None),
                    Err(message) => (serde_json::json!({}), Some(message)),
                }
            }
        },
        "files.list" | "files.read" => execute_files_command(&command, approved_folders),
        _ => (serde_json::json!({}), Some("Unsupported desktop command.".to_string())),
    };

    let mut body = serde_json::json!({
        "command_id": command.id,
        "result": result
    });
    if let Some(message) = error_message {
        body["error_message"] = serde_json::Value::String(message);
    }

    let _ = client
        .post(format!("{SUPABASE_URL}/functions/v1/device-result"))
        .header("apikey", api_key)
        .bearer_auth(&token)
        .json(&body)
        .send()
        .await;
}

fn start_relay_polling(connected: Arc<AtomicBool>, screen_consent: Arc<AtomicBool>, accessibility_consent: Arc<AtomicBool>, approved_folders: Arc<Mutex<Vec<PathBuf>>>) {
    tauri::async_runtime::spawn(async move {
        loop {
            poll_relay_once(&connected, &screen_consent, &accessibility_consent, &approved_folders).await;
            tokio::time::sleep(Duration::from_secs(10)).await;
        }
    });
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn start_heartbeat(app: tauri::AppHandle, connected: Arc<AtomicBool>) {
    tauri::async_runtime::spawn(async move {
        loop {
            let is_connected = if stored_token().is_some() { heartbeat().await } else { false };
            connected.store(is_connected, Ordering::Relaxed);
            if let Some(tray) = app.tray_by_id("main") {
                let tooltip = if is_connected { "McpOS — Connected" } else { "McpOS — Disconnected" };
                let _ = tray.set_tooltip(Some(tooltip));
            }
            tokio::time::sleep(Duration::from_secs(30)).await;
        }
    });
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![pair_device, get_device_status, get_screen_capture_consent, set_screen_capture_consent, get_accessibility_consent, set_accessibility_consent, get_approved_folders, pick_approved_folder, remove_approved_folder])
        .setup(|app| {
            let open = MenuItem::with_id(app, "open", "Open McpOS", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit McpOS", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            let icon = app.default_window_icon().cloned().ok_or("McpOS application icon is missing")?;

            TrayIconBuilder::new()
                .icon(icon)
                .tooltip("McpOS — Disconnected")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            let connection_state = Arc::new(AtomicBool::new(false));
            app.manage(connection_state.clone());
            let screen_consent = Arc::new(AtomicBool::new(false));
            app.manage(ScreenCaptureConsent(screen_consent.clone()));
            let accessibility_consent = Arc::new(AtomicBool::new(false));
            app.manage(AccessibilityConsent(accessibility_consent.clone()));
            let approved_folders = Arc::new(Mutex::new(Vec::new()));
            app.manage(ApprovedFolders(approved_folders.clone()));
            start_heartbeat(app.handle().clone(), connection_state.clone());
            start_relay_polling(connection_state, screen_consent, accessibility_consent, approved_folders);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running McpOS Desktop");
}
