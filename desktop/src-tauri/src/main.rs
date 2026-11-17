#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use computer_use::{CaptureOptions, ClickOptions, ClickTarget, Computer};
use keyring::Entry;
use screenshots::Screen;
use std::io::Cursor;
use serde::{Deserialize, Serialize};
use std::{sync::{Arc, atomic::{AtomicBool, Ordering}}, time::Duration};
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
const SCREEN_CAPTURE_APPROVAL_KEY: &str = "approval_screen_capture";
const ACCESSIBILITY_APPROVAL_KEY: &str = "approval_accessibility";
const POINTER_APPROVAL_KEY: &str = "approval_pointer";
const KEYBOARD_APPROVAL_KEY: &str = "approval_keyboard";

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

#[tauri::command]

fn is_approved(key: &str) -> bool {
    credential(key).ok().and_then(|entry| entry.get_password().ok())
        .map(|value| value == "approved").unwrap_or(false)
}

fn save_approval(key: &str, approved: bool) -> Result<(), String> {
    let entry = credential(key)?;
    if approved {
        entry.set_password("approved")
            .map_err(|_| "Could not securely save this permission.".to_string())
    } else {
        let _ = entry.delete_credential();
        Ok(())
    }
}

#[tauri::command]
fn get_screen_capture_approval() -> bool { is_approved(SCREEN_CAPTURE_APPROVAL_KEY) }

#[tauri::command]
fn set_screen_capture_approval(approved: bool) -> Result<(), String> {
    save_approval(SCREEN_CAPTURE_APPROVAL_KEY, approved)
}

#[tauri::command]
fn get_accessibility_approval() -> bool { is_approved(ACCESSIBILITY_APPROVAL_KEY) }

#[tauri::command]
fn set_accessibility_approval(approved: bool) -> Result<(), String> {
    save_approval(ACCESSIBILITY_APPROVAL_KEY, approved)
}

#[tauri::command]
fn get_pointer_approval() -> bool { is_approved(POINTER_APPROVAL_KEY) }

#[tauri::command]
fn set_pointer_approval(approved: bool) -> Result<(), String> {
    save_approval(POINTER_APPROVAL_KEY, approved)
}

#[tauri::command]
fn get_keyboard_approval() -> bool { is_approved(KEYBOARD_APPROVAL_KEY) }

#[tauri::command]
fn set_keyboard_approval(approved: bool) -> Result<(), String> {
    save_approval(KEYBOARD_APPROVAL_KEY, approved)
}

#[tauri::command]
fn inspect_application(app_name: String) -> Result<String, String> {
    if !is_approved(ACCESSIBILITY_APPROVAL_KEY) {
        return Err("Windows accessibility access is disabled. Approve it in McpOS Desktop first.".into());
    }
    if app_name.trim().is_empty() || app_name.len() > 128 {
        return Err("Enter a valid application name or process reference.".into());
    }
    let mut computer = Computer::new().map_err(|error| format!("Could not initialise Windows UI Automation: {error}"))?;
    let options = CaptureOptions::default().include_screenshot(false).launch_if_needed(false);
    let state = computer.get_app_state(&app_name, &options)
        .map_err(|error| format!("Could not inspect {app_name}: {error}"))?;
    Ok(state.render())
}

#[tauri::command]
fn click_application(app_name: String, x: f64, y: f64) -> Result<(), String> {
    if !is_approved(POINTER_APPROVAL_KEY) {
        return Err("Mouse control is disabled. Approve mouse control in McpOS Desktop first.".into());
    }
    if app_name.trim().is_empty() || app_name.len() > 128 || !x.is_finite() || !y.is_finite() {
        return Err("Invalid application or screen coordinates.".into());
    }
    let mut computer = Computer::new().map_err(|error| error.to_string())?;
    computer.click(&app_name, ClickTarget::Screen { x, y }, ClickOptions::default())
        .map(|_| ()).map_err(|error| format!("Mouse action failed: {error}"))
}

#[tauri::command]
fn type_application_text(app_name: String, value: String) -> Result<(), String> {
    if !is_approved(KEYBOARD_APPROVAL_KEY) {
        return Err("Keyboard control is disabled. Approve keyboard control in McpOS Desktop first.".into());
    }
    if app_name.trim().is_empty() || app_name.len() > 128 || value.len() > 4000 {
        return Err("Invalid application or text length (maximum 4,000 characters).".into());
    }
    let mut computer = Computer::new().map_err(|error| error.to_string())?;
    computer.type_text(&app_name, &value).map_err(|error| format!("Text input failed: {error}"))
}

#[tauri::command]
fn press_application_key(app_name: String, key: String) -> Result<(), String> {
    if !is_approved(KEYBOARD_APPROVAL_KEY) {
        return Err("Keyboard control is disabled. Approve keyboard control in McpOS Desktop first.".into());
    }
    if app_name.trim().is_empty() || app_name.len() > 128 || key.trim().is_empty() || key.len() > 64 {
        return Err("Invalid application or key chord.".into());
    }
    let mut computer = Computer::new().map_err(|error| error.to_string())?;
    computer.press_key(&app_name, &key).map_err(|error| format!("Key action failed: {error}"))
}

#[tauri::command]
fn capture_screen() -> Result<String, String> {
    if !is_approved(SCREEN_CAPTURE_APPROVAL_KEY) {
        return Err("Screen capture is disabled. Approve it in the McpOS desktop app first.".into());
    }
    let screens = Screen::all().map_err(|error| format!("Could not enumerate displays: {error:?}"))?;
    let screen = screens.first().ok_or("No display is available.")?;
    let captured = screen.capture().map_err(|error| format!("Screen capture failed: {error:?}"))?;
    let mut output = Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(captured)
        .write_to(&mut output, image::ImageFormat::Png)
        .map_err(|error| format!("Could not encode the screen image: {error}"))?;
    Ok(format!("data:image/png;base64,{}", BASE64.encode(output.into_inner())))
}

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
        .invoke_handler(tauri::generate_handler![pair_device, get_device_status, get_screen_capture_approval, set_screen_capture_approval, capture_screen, get_accessibility_approval, set_accessibility_approval, get_pointer_approval, set_pointer_approval, get_keyboard_approval, set_keyboard_approval, inspect_application, click_application, type_application_text, press_application_key])
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
            start_heartbeat(app.handle().clone(), connection_state);
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
