#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine;
use enigo::{Axis, Button, Coordinate, Direction, Enigo, Key, Keyboard, Mouse, Settings};
use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::{path::{Path, PathBuf}, sync::{mpsc::sync_channel, Arc, Mutex, atomic::{AtomicBool, Ordering}}, time::{Duration, SystemTime, UNIX_EPOCH}};
use xcap::{image::{codecs::jpeg::JpegEncoder, DynamicImage}, Monitor};
use uiautomation::UIAutomation;
use uuid::Uuid;
use tauri::{utils::config::WebviewUrl, webview::{DownloadEvent, NewWindowResponse, WebviewWindowBuilder}};
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

async fn authorize_pending_command(command_id: &str) -> bool {
    let Some(token) = stored_token() else { return false };
    let Some(api_key) = SUPABASE_ANON_KEY else { return false };
    if api_key.is_empty() { return false; }
    let response = reqwest::Client::new()
        .post(format!("{SUPABASE_URL}/functions/v1/device-poll"))
        .header("apikey", api_key).bearer_auth(token)
        .json(&serde_json::json!({ "authorize_command_id": command_id }))
        .send().await;
    match response {
        Ok(response) if response.status().is_success() => response.json::<serde_json::Value>().await.ok().and_then(|value| value.get("authorized").and_then(|v| v.as_bool())).unwrap_or(false),
        _ => false,
    }
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
struct PendingAction(Arc<Mutex<Option<RelayCommand>>>);
struct BrowserConsent(Arc<AtomicBool>);
#[derive(Clone, Serialize)]
struct AutomationPolicy {
    mode: String,
    paused: bool,
    expires_at: Option<u64>,
    auto_pointer: bool,
    auto_keyboard: bool,
    auto_browser: bool,
    auto_screen: bool,
}
struct AutomationPolicyState(Arc<Mutex<AutomationPolicy>>);
fn now_epoch() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}
fn policy_active(policy: &AutomationPolicy) -> bool {
    !policy.paused && policy.mode != "manual" && policy.expires_at.map(|expiry| expiry > now_epoch()).unwrap_or(false)
}
fn policy_auto_approves(policy: &AutomationPolicy, command: &str) -> bool {
    if !policy_active(policy) { return false; }
    if policy.mode == "all" {
        return matches!(command, "input.pointer.click" | "input.pointer.move" | "input.pointer.scroll" | "input.keyboard.type" | "input.keyboard.shortcut" | "browser.open" | "browser.click" | "browser.type" | "screen.capture");
    }
    match command {
        "input.pointer.click" | "input.pointer.move" | "input.pointer.scroll" => policy.auto_pointer,
        "input.keyboard.type" | "input.keyboard.shortcut" => policy.auto_keyboard,
        "browser.open" | "browser.click" | "browser.type" => policy.auto_browser,
        "screen.capture" => policy.auto_screen,
        _ => false,
    }
}
fn policy_json(policy: &AutomationPolicy) -> serde_json::Value {
    serde_json::to_value(policy).unwrap_or_else(|_| serde_json::json!({"mode":"manual","paused":true}))
}

#[tauri::command]
fn get_automation_policy(policy: tauri::State<'_, AutomationPolicyState>) -> serde_json::Value {
    policy.0.lock().map(|p| policy_json(&p)).unwrap_or_else(|_| serde_json::json!({"mode":"manual","paused":true}))
}
#[tauri::command]
fn set_automation_policy(mode: String, expiry_minutes: u64, auto_pointer: bool, auto_keyboard: bool, auto_browser: bool, auto_screen: bool, policy: tauri::State<'_, AutomationPolicyState>) -> Result<serde_json::Value, String> {
    if !matches!(mode.as_str(), "manual" | "selected" | "all") { return Err("Invalid automation mode.".into()); }
    if !matches!(expiry_minutes, 15 | 60 | 240 | 480) { return Err("Choose a supported session expiry.".into()); }
    let mut p = policy.0.lock().map_err(|_| "Automation policy unavailable.".to_string())?;
    p.mode = mode.clone();
    p.paused = false;
    p.expires_at = if mode == "manual" { None } else { Some(now_epoch() + expiry_minutes * 60) };
    p.auto_pointer = mode == "all" || (mode == "selected" && auto_pointer);
    p.auto_keyboard = mode == "all" || (mode == "selected" && auto_keyboard);
    p.auto_browser = mode == "all" || (mode == "selected" && auto_browser);
    p.auto_screen = mode == "all" || (mode == "selected" && auto_screen);
    Ok(policy_json(&p))
}
#[tauri::command]
async fn pause_automation(policy: tauri::State<'_, AutomationPolicyState>, pending: tauri::State<'_, PendingAction>) -> Result<serde_json::Value, String> {
    {
        let mut p = policy.0.lock().map_err(|_| "Automation policy unavailable.".to_string())?;
        p.paused = true;
    }
    let command = {
        pending.0.lock().map_err(|_| "Pending action state unavailable.".to_string())?.take()
    };
    if let Some(command) = command {
        let _ = submit_relay_result(&command.id, serde_json::json!({}), Some("Automation paused locally before execution.".into())).await;
    }
    let p = policy.0.lock().map_err(|_| "Automation policy unavailable.".to_string())?;
    Ok(policy_json(&p))
}

#[tauri::command]
fn get_browser_consent(consent: tauri::State<'_, BrowserConsent>) -> bool {
    consent.0.load(Ordering::Relaxed)
}

#[tauri::command]
fn set_browser_consent(enabled: bool, consent: tauri::State<'_, BrowserConsent>, app: tauri::AppHandle) -> bool {
    consent.0.store(enabled, Ordering::Relaxed);
    if !enabled {
        for window in isolated_browser_windows(&app) { let _ = window.close(); }
        if let Ok(mut selected) = app.state::<SelectedBrowserWindow>().0.lock() { *selected = None; }
    }
    enabled
}


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

// Read-only discovery: never launch an application or expose arbitrary PATH contents.
fn discover_developer_tools() -> serde_json::Value {
    let candidates: &[(&str, &[&str])] = &[
        ("VS Code", &["Code.exe", "code.cmd"]),
        ("Chrome", &["chrome.exe"]),
        ("Git", &["git.exe"]),
        ("Node.js", &["node.exe"]),
        ("npm", &["npm.cmd"]),
        ("Python", &["python.exe", "py.exe"]),
        ("PowerShell", &["pwsh.exe", "powershell.exe"]),
    ];
    let mut directories: Vec<PathBuf> = std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).collect();
    for variable in ["LOCALAPPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)"] {
        if let Some(root) = std::env::var_os(variable) {
            let base = PathBuf::from(root);
            directories.push(base.clone());
            for suffix in ["Programs/Microsoft VS Code/bin", "Programs/Microsoft VS Code", "Google/Chrome/Application", "Microsoft VS Code/bin", "Microsoft VS Code", "Git/bin", "Git/cmd", "nodejs", "PowerShell/7"] {
                directories.push(base.join(suffix));
            }
        }
    }
    let found: Vec<serde_json::Value> = candidates.iter().map(|(name, executables)| {
        let path = directories.iter().flat_map(|directory| executables.iter().map(move |exe| directory.join(exe)))
            .find(|candidate| candidate.is_file());
        serde_json::json!({"name": name, "installed": path.is_some(), "executable": path.map(|p| p.to_string_lossy().to_string())})
    }).collect();
    serde_json::json!({"tools": found, "read_only": true})
}

fn capture_screen_jpeg() -> Result<(String, u32, u32), String> {
    let monitors = Monitor::all().map_err(|_| "Windows could not enumerate the displays.".to_string())?;
    let monitor = monitors.iter().find(|monitor| monitor.is_primary().unwrap_or(false)).or_else(|| monitors.first()).ok_or("No active display was found.".to_string())?;
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


#[derive(Clone, Deserialize)]
struct RelayCommand {
    id: String,
    command: String,
    payload: serde_json::Value,
}

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
        let truncated = items.len() >= 100;
        return (serde_json::json!({ "path": target.display().to_string(), "items": items, "truncated": truncated }), None);
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
#[derive(Deserialize)]
struct RelayPollResponse {
    command: Option<RelayCommand>,
}

fn browser_url_allowed(url: &url::Url) -> bool {
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() || url.port_or_known_default() != Some(443) { return false; }
    // Apply the same lexical policy to initial URLs and every top-level redirect.
    // This does not constrain DNS resolution or subresource requests.
    let Some(url::Host::Domain(domain)) = url.host() else { return false; };
    let host = domain.trim_end_matches('.').to_ascii_lowercase();
    if host.len() > 253 || !host.contains('.') { return false; }
    if ["localhost", "local", "internal", "home.arpa", "lan", "corp", "test", "invalid", "onion"].iter().any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}"))) { return false; }
    host.split('.').all(|label| !label.is_empty() && label.len() <= 63 && !label.starts_with('-') && !label.ends_with('-') && label.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-'))
}

#[cfg(test)]
mod browser_policy_tests {
    use super::{browser_url_allowed, is_isolated_browser_label};
    #[test]
    fn recognizes_only_isolated_browser_labels() {
        assert!(is_isolated_browser_label("mcpos-isolated-browser"));
        assert!(is_isolated_browser_label("mcpos-isolated-browser-11111111-1111-4111-8111-111111111111"));
        for label in ["main", "mcpos-isolated-browser-other", "mcpos-isolated-browser-", "unrelated"] {
            assert!(!is_isolated_browser_label(label));
        }
    }
    #[test]
    fn rejects_non_public_navigation_syntax() {
        for raw in ["http://example.com", "https://localhost./", "https://a.local./", "https://router.home.arpa", "https://127.0.0.1", "https://2130706433", "https://[::1]", "https://8.8.8.8", "https://[::ffff:127.0.0.1]", "https://server", "https://example.com:8443", "https://user:password@example.com", "https://a.internal", "https://a.lan", "https://a.onion", "https://example..com"] {
            assert!(!browser_url_allowed(&url::Url::parse(raw).unwrap()), "accepted {raw}");
        }
    }
    #[test]
    fn permits_normal_https_navigation() {
        for raw in ["https://example.com", "https://example.com:443/path", "https://sub.example.com/path?x=1", "https://example.com./"] {
            assert!(browser_url_allowed(&url::Url::parse(raw).unwrap()), "rejected {raw}");
        }
    }
}

const BROWSER_WINDOW_PREFIX: &str = "mcpos-isolated-browser";
const MAX_BROWSER_WINDOWS: usize = 6;

fn is_isolated_browser_label(label: &str) -> bool {
    label == BROWSER_WINDOW_PREFIX || label.strip_prefix("mcpos-isolated-browser-").is_some_and(|id| Uuid::parse_str(id).is_ok())
}

fn isolated_browser_windows(app: &tauri::AppHandle) -> Vec<tauri::WebviewWindow> {
    app.webview_windows().into_iter().filter_map(|(label, window)| {
        is_isolated_browser_label(&label).then_some(window)
    }).collect()
}

struct SelectedBrowserWindow(Mutex<Option<String>>);

fn select_browser_window(app: &tauri::AppHandle, window: &tauri::WebviewWindow) {
    if let Ok(mut selected) = app.state::<SelectedBrowserWindow>().0.lock() {
        *selected = Some(window.label().to_string());
    }
}

fn active_browser_window(app: &tauri::AppHandle, window_id: Option<&str>) -> Result<tauri::WebviewWindow, String> {
    if let Some(id) = window_id {
        if !is_isolated_browser_label(id) { return Err("Invalid isolated browser window ID.".into()); }
        return app.get_webview_window(id).ok_or_else(|| "The selected browser window is closed or unknown. List windows again.".into());
    }
    let windows = isolated_browser_windows(app);
    let selected = app.state::<SelectedBrowserWindow>().0.lock().ok().and_then(|id| id.clone());
    if let Some(window) = windows.iter().find(|window| Some(window.label()) == selected.as_deref()) { return Ok(window.clone()); }
    if windows.len() == 1 { return Ok(windows[0].clone()); }
    if windows.is_empty() { return Err("Open a page in the isolated browser first.".into()); }
    Err("List windows and select an explicit window ID before continuing.".into())
}

fn browser_window_list(app: &tauri::AppHandle) -> serde_json::Value {
    let selected = app.state::<SelectedBrowserWindow>().0.lock().ok().and_then(|id| id.clone());
    let mut windows: Vec<_> = isolated_browser_windows(app).into_iter().map(|window| {
        let url = window.url().ok().filter(browser_url_allowed).map(|url| format!("{}{}", url.origin().ascii_serialization(), url.path()));
        serde_json::json!({"windowId":window.label(),"url":url,"focused":window.is_focused().unwrap_or(false),"selected":Some(window.label()) == selected.as_deref()})
    }).collect();
    windows.sort_by(|a,b| a["windowId"].as_str().cmp(&b["windowId"].as_str()));
    serde_json::json!({"windows":windows,"browser_window_count":windows.len()})
}

// Every child inherits the opener's WebView2 environment, but never the main application's capabilities.
fn browser_window_policy<'a>(builder: WebviewWindowBuilder<'a, tauri::Wry, tauri::AppHandle>, app: &tauri::AppHandle)
    -> WebviewWindowBuilder<'a, tauri::Wry, tauri::AppHandle> {
    let handle = app.clone();
    let consent = app.state::<BrowserConsent>().0.clone();
    let nav_consent = consent.clone();
    builder.title("McpOS Isolated Browser")
        .on_navigation(move |url| nav_consent.load(Ordering::Relaxed) && (browser_url_allowed(url) || url.as_str() == "about:blank"))
        .on_download(|_, event| !matches!(event, DownloadEvent::Requested { .. }))
        .on_new_window(move |url, features| {
            if !consent.load(Ordering::Relaxed) || isolated_browser_windows(&handle).len() >= MAX_BROWSER_WINDOWS
                || !(browser_url_allowed(&url) || url.as_str() == "about:blank") {
                return NewWindowResponse::Deny;
            }
            let label = format!("{BROWSER_WINDOW_PREFIX}-{}", Uuid::new_v4());
            let blank = url::Url::parse("about:blank").expect("valid bootstrap URL");
            let child = WebviewWindowBuilder::new(&handle, label, WebviewUrl::External(blank)).window_features(features);
            match browser_window_policy(child, &handle).build() {
                Ok(window) if consent.load(Ordering::Relaxed) => { select_browser_window(&handle, &window); NewWindowResponse::Create { window } },
                Ok(window) => { let _ = window.close(); NewWindowResponse::Deny },
                Err(_) => NewWindowResponse::Deny,
            }
        })
}

fn open_isolated_browser(app: &tauri::AppHandle, raw_url: &str, new_window: bool, window_id: Option<&str>) -> Result<String, String> {
    let url = url::Url::parse(raw_url).map_err(|_| "The browser URL is invalid.".to_string())?;
    if !browser_url_allowed(&url) { return Err("The browser only permits public HTTPS sites without embedded credentials.".to_string()); }
    if !app.state::<BrowserConsent>().0.load(Ordering::Relaxed) { return Err("Isolated browser consent is disabled.".into()); }
    let windows = isolated_browser_windows(app);
    if !new_window && !windows.is_empty() {
        let window = active_browser_window(app, window_id)?;
        select_browser_window(app, &window);
        window.navigate(url).map_err(|_| "Could not navigate the isolated browser.".to_string())?;
        let _ = window.show();
        let _ = window.set_focus();
        return Ok("Navigation requested in the selected isolated browser window.".into());
    }
    if windows.len() >= MAX_BROWSER_WINDOWS { return Err("Close an isolated browser window before opening another (maximum six).".into()); }
    let mut profile = app.path().app_local_data_dir().map_err(|_| "Could not resolve the isolated browser profile directory.".to_string())?;
    profile.push("isolated-browser-profile");
    std::fs::create_dir_all(&profile).map_err(|_| "Could not create the isolated browser profile.".to_string())?;
    let label = format!("{BROWSER_WINDOW_PREFIX}-{}", Uuid::new_v4());
    let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::External(url)).data_directory(profile);
    let window = browser_window_policy(builder, app).build().map_err(|_| "Could not create the isolated browser window.".to_string())?;
    select_browser_window(app, &window);
    Ok("Opened a window in the separate McpOS browser profile.".into())
}

fn browser_eval_and_collect(app: &tauri::AppHandle, window_id: Option<&str>, expression: &str) -> Result<serde_json::Value, String> {
    if !app.state::<BrowserConsent>().0.load(Ordering::Relaxed) { return Err("Isolated browser consent is disabled.".into()); }
    let window = active_browser_window(app, window_id)?;
    let current = window.url().map_err(|_| "Could not verify the selected browser URL.")?;
    if !browser_url_allowed(&current) { return Err("Wait for the selected window to load a permitted HTTPS page.".into()); }
    let expected = serde_json::to_string(current.as_str()).map_err(|_| "Could not prepare browser navigation guard.")?;
    let script = format!("(() => {{ if (location.href !== {expected}) return {{ok:false,error:'Page changed; request a new snapshot.'}}; try {{ return ({expression}); }} catch (error) {{ return {{ok:false,error:String(error).slice(0,200)}}; }} }})()");
    let (sender, receiver) = sync_channel(1);
    window.eval_with_callback(script, move |body| { let _ = sender.try_send(body); })
        .map_err(|_| "Could not execute the browser operation.".to_string())?;
    let body = receiver.recv_timeout(Duration::from_secs(8)).map_err(|_| "Browser result timed out; the page may still be loading or have closed.")?;
    if body.len() > 100_000 { return Err("Browser result exceeds the permitted size.".into()); }
    let mut value: serde_json::Value = serde_json::from_str(&body).map_err(|_| "The isolated browser returned an invalid result.")?;
    if let Some(inner) = value.as_str() { value = serde_json::from_str(inner).map_err(|_| "The isolated browser returned an invalid result.")?; }
    if value.get("ok").and_then(|item| item.as_bool()) != Some(true) {
        return Err(value.get("error").and_then(|item| item.as_str()).unwrap_or("The browser operation returned no result.").into());
    }
    if let Some(object) = value.as_object_mut() {
        object.insert("browser_window_count".into(), serde_json::json!(isolated_browser_windows(app).len()));
        object.insert("browser_window".into(), serde_json::json!(window.label()));
        object.insert("windows".into(), browser_window_list(app)["windows"].clone());
    }
    Ok(value)
}

fn get_browser_snapshot(app: &tauri::AppHandle, window_id: Option<&str>) -> Result<serde_json::Value, String> {
    browser_eval_and_collect(app, window_id, r#"(() => {
        // Prefer a verified unique semantic locator; otherwise build a full structural path.
        const cssPath = (element) => {
            const unique = selector => {
                try { const matches = document.querySelectorAll(selector); return matches.length === 1 && matches[0] === element; } catch { return false; }
            };
            const tag = element.tagName.toLowerCase();
            if (element.id) {
                const selector = '#' + CSS.escape(element.id);
                if (unique(selector)) return selector;
            }
            for (const attr of ['aria-label', 'data-testid', 'name', 'placeholder']) {
                const value = element.getAttribute(attr);
                if (value) {
                    const selector = tag + '[' + attr + '="' + CSS.escape(value) + '"]';
                    if (selector.length <= 256 && unique(selector)) return selector;
                }
            }
            const parts = [];
            for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
                const tag = node.tagName.toLowerCase();
                const siblings = node.parentElement ? Array.from(node.parentElement.children).filter(item => item.tagName === node.tagName) : [];
                parts.unshift(tag + (siblings.length > 1 ? ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')' : ''));
                if (node.id) {
                    const candidate = ['#' + CSS.escape(node.id), ...parts.slice(1)].join(' > ');
                    if (candidate.length <= 256 && unique(candidate)) return candidate;
                }
                const candidate = parts.join(' > ');
                if (candidate.length <= 256 && unique(candidate)) return candidate;
            }
            return null;
        };
        const roles = ['button','link','menuitem','menuitemcheckbox','menuitemradio','tab','option','checkbox','radio','switch','combobox','textbox','searchbox','treeitem'];
        const candidates = Array.from(document.querySelectorAll('a[href],button,input,textarea,select,summary,[contenteditable="true"],' + roles.map(role => '[role="' + role + '"]').join(',')))
            .filter(element => {
                const style = getComputedStyle(element);
                return element.getClientRects().length && !element.closest('[hidden],[inert],[aria-hidden="true"]') && style.visibility === 'visible' && style.display !== 'none';
            });
        // Prioritise active dialogs and menus, then visible viewport elements, then remaining controls.
        const priority = element => {
            const bounds = element.getBoundingClientRect();
            return (element.closest('[role="dialog"],[aria-modal="true"],[role="menu"],[role="listbox"],[role="alertdialog"]') ? 4 : 0)
                + (bounds.bottom > 0 && bounds.right > 0 && bounds.top < innerHeight && bounds.left < innerWidth ? 2 : 0)
                + (element === document.activeElement ? 1 : 0);
        };
        candidates.sort((a,b) => priority(b) - priority(a));
        const interactive = candidates.slice(0, 160).map(element => {
            const bounds = element.getBoundingClientRect();
            const sensitive = element.matches('input[type=password],input[autocomplete=current-password],input[autocomplete=new-password]');
            return {
                selector: cssPath(element),
                tag: element.tagName.toLowerCase(),
                role: element.getAttribute('role') || undefined,
                label: (element.getAttribute('aria-label') || element.getAttribute('placeholder') || (sensitive ? '' : element.innerText) || element.getAttribute('name') || '').trim().slice(0, 140),
                type: element.getAttribute('type') || undefined,
                disabled: Boolean(element.disabled || element.closest('[aria-disabled="true"]')),
                editable: element.matches('input:not([type="hidden"]),textarea,[contenteditable="true"]'),
                sensitive,
                bounds: {x:Math.round(bounds.x),y:Math.round(bounds.y),width:Math.round(bounds.width),height:Math.round(bounds.height)}
            };
        });
        return { ok: true, url: location.origin + location.pathname, title: document.title, text: (document.body?.innerText || '').slice(0, 12000), interactive, interactiveTotal: candidates.length, truncated: candidates.length > interactive.length };
    })()"#)
}

fn execute_browser_action(command: &RelayCommand, app: &tauri::AppHandle) -> Result<serde_json::Value, String> {
    if !app.state::<BrowserConsent>().0.load(Ordering::Relaxed) { return Err("Isolated browser consent is disabled.".into()); }
    let window_id = command.payload.get("windowId").and_then(|value| value.as_str());
    let operation = command.payload.get("windowAction").and_then(|value| value.as_str()).unwrap_or(command.command.as_str());
    match operation {
        "browser.list" => Ok(browser_window_list(app)),
        "browser.switch" => {
            let id = window_id.ok_or("Window ID required.")?;
            let window = active_browser_window(app, Some(id))?;
            window.show().map_err(|_| "Could not show selected window.")?;
            window.set_focus().map_err(|_| "Could not focus selected window.")?;
            select_browser_window(app, &window);
            Ok(browser_window_list(app))
        },
        "browser.close" => {
            let id = window_id.ok_or("Window ID required.")?;
            let window = active_browser_window(app, Some(id))?;
            window.close().map_err(|_| "Could not close selected browser window.")?;
            Ok(serde_json::json!({"closedWindowId":id}))
        },
        "browser.snapshot" => get_browser_snapshot(app, window_id),
        "browser.open" => {
            let raw_url = command.payload.get("targetUrl").or_else(|| command.payload.get("url")).and_then(|value| value.as_str()).ok_or("A URL is required.")?;
            let new_window = command.payload.get("newWindow").and_then(|value| value.as_bool()).unwrap_or(false);
            let message = open_isolated_browser(app, raw_url, new_window, window_id)?;
            Ok(serde_json::json!({ "action": "open", "message": message, "windows": browser_window_list(app)["windows"], "browser_window_count": isolated_browser_windows(app).len() }))
        },
        "browser.click" => {
            let selector = command.payload.get("selector").and_then(|value| value.as_str()).ok_or("A CSS selector is required.")?;
            if selector.is_empty() || selector.len() > 256 { return Err("CSS selector must be 1–256 characters.".to_string()); }
            let selector_js = serde_json::to_string(selector).map_err(|_| "Invalid CSS selector.".to_string())?;
            browser_eval_and_collect(app, window_id, &format!("(() => {{ const selector = {selector_js}; const matches = document.querySelectorAll(selector); if (matches.length !== 1) return {{ ok: false, error: matches.length ? 'AMBIGUOUS_SELECTOR: request a new snapshot and use a unique selector' : 'ELEMENT_NOT_FOUND: request a new snapshot', selector }}; const element = matches[0]; if (!element.getClientRects().length || element.closest('[hidden],[inert],[aria-hidden=true],[aria-disabled=true]') || element.disabled || getComputedStyle(element).visibility !== 'visible') return {{ ok: false, error: 'ELEMENT_NOT_INTERACTABLE: request a new snapshot', selector }}; element.click(); return {{ ok: true, action: 'click', verification: 'dispatched_only', selector, element: (element.innerText || element.getAttribute('aria-label') || element.tagName).slice(0, 160) }}; }})()"))
        },
        "browser.type" => {
            let selector = command.payload.get("selector").and_then(|value| value.as_str()).ok_or("A CSS selector is required.")?;
            let text = command.payload.get("text").and_then(|value| value.as_str()).ok_or("Text is required.")?;
            if selector.is_empty() || selector.len() > 256 || text.is_empty() || text.chars().count() > 200 || text.chars().any(|character| character.is_control()) { return Err("Selector or text is outside the allowed limits.".to_string()); }
            let selector_js = serde_json::to_string(selector).map_err(|_| "Invalid CSS selector.".to_string())?;
            let text_js = serde_json::to_string(text).map_err(|_| "Invalid text.".to_string())?;
            browser_eval_and_collect(app, window_id, &format!("(() => {{ const selector = {selector_js}; const matches = document.querySelectorAll(selector); if (matches.length !== 1) return {{ ok: false, error: matches.length ? 'AMBIGUOUS_SELECTOR: request a new snapshot and use a unique selector' : 'ELEMENT_NOT_FOUND: request a new snapshot', selector }}; const element = matches[0]; if (!element.getClientRects().length || element.closest('[hidden],[inert],[aria-hidden=true],[aria-disabled=true]') || element.disabled || getComputedStyle(element).visibility !== 'visible') return {{ ok: false, error: 'ELEMENT_NOT_INTERACTABLE: request a new snapshot', selector }}; if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element.isContentEditable)) return {{ ok: false, error: 'Target is not an editable field', selector }}; if (element.matches('input[type=password],input[autocomplete=current-password],input[autocomplete=new-password]')) return {{ ok: false, error: 'Password fields require direct local entry', selector }}; element.focus(); if ('value' in element) {{ const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set; if (setter) setter.call(element, {text_js}); else element.value = {text_js}; }} else element.textContent = {text_js}; element.dispatchEvent(new InputEvent('input', {{ bubbles: true, inputType: 'insertText', data: {text_js} }})); element.dispatchEvent(new Event('change', {{ bubbles: true }})); return {{ ok: true, action: 'type', selector, characters: {text_js}.length }}; }})()"))
        },
        _ => Err("Unsupported browser action.".to_string()),
    }
}
fn execute_input_action(command: &RelayCommand) -> Result<serde_json::Value, String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|_| "Windows input simulation could not start.".to_string())?;
    match command.command.as_str() {
        "input.pointer.move" => {
            let x = command.payload.get("x").and_then(|v| v.as_i64()).ok_or("An x coordinate is required.")?;
            let y = command.payload.get("y").and_then(|v| v.as_i64()).ok_or("A y coordinate is required.")?;
            let (width, height) = enigo.main_display().map_err(|_| "Could not read display dimensions.")?;
            if x < 0 || y < 0 || x >= width as i64 || y >= height as i64 { return Err("Coordinates outside primary display.".into()); }
            enigo.move_mouse(x as i32, y as i32, Coordinate::Abs).map_err(|_| "Pointer movement failed.")?;
            Ok(serde_json::json!({"action":"move","x":x,"y":y}))
        },
        "input.pointer.scroll" => {
            let steps = command.payload.get("steps").and_then(|v| v.as_i64()).ok_or("Scroll steps required.")?;
            if steps.abs() > 12 { return Err("Scroll is limited to 12 steps per request.".into()); }
            let axis = match command.payload.get("axis").and_then(|v| v.as_str()).unwrap_or("vertical") {
                "vertical" => Axis::Vertical, "horizontal" => Axis::Horizontal, _ => return Err("Invalid scroll axis.".into())
            };
            enigo.scroll(steps as i32, axis).map_err(|_| "Pointer scroll failed.")?;
            Ok(serde_json::json!({"action":"scroll","steps":steps}))
        },
        "input.pointer.click" => {
            let x = command.payload.get("x").and_then(|value| value.as_i64()).ok_or("A valid x coordinate is required.")?;
            let y = command.payload.get("y").and_then(|value| value.as_i64()).ok_or("A valid y coordinate is required.")?;
            let button = command.payload.get("button").and_then(|value| value.as_str()).unwrap_or("left");
            let (width, height) = enigo.main_display().map_err(|_| "Could not read the primary display dimensions.".to_string())?;
            if x < 0 || y < 0 || x >= width as i64 || y >= height as i64 { return Err("Click coordinates are outside the primary display.".to_string()); }
            let mouse_button = match button { "left" => Button::Left, "right" => Button::Right, _ => return Err("Only left and right clicks are supported.".to_string()) };
            enigo.move_mouse(x as i32, y as i32, Coordinate::Abs).map_err(|_| "Could not move the pointer.".to_string())?;
            enigo.button(mouse_button, Direction::Click).map_err(|_| "The click action failed.".to_string())?;
            Ok(serde_json::json!({ "action": "click", "x": x, "y": y, "button": button, "approved_locally": true }))
        },
        "input.keyboard.type" => {
            let text = command.payload.get("text").and_then(|value| value.as_str()).ok_or("Text is required.")?;
            if text.is_empty() || text.chars().count() > 200 || text.chars().any(|character| character.is_control()) { return Err("Text must be 1–200 characters and contain no control characters.".to_string()); }
            enigo.text(text).map_err(|_| "Windows could not enter the approved text.".to_string())?;
            Ok(serde_json::json!({ "action": "type_text", "characters": text.chars().count(), "approved_locally": true }))
        },
        "input.keyboard.shortcut" => {
            let names = command.payload.get("keys").and_then(|value| value.as_array()).ok_or("A shortcut key array is required.")?;
            if names.len() < 2 || names.len() > 4 { return Err("A shortcut must contain 2–4 keys.".into()); }
            let mut keys: Vec<Key> = Vec::new();
            for name in names {
                let value = name.as_str().ok_or("Shortcut keys must be strings.")?;
                let key = match value.to_ascii_uppercase().as_str() {
                    "CTRL" | "CONTROL" => Key::Control, "SHIFT" => Key::Shift, "ALT" => Key::Alt, "WIN" | "META" => Key::Meta,
                    "ENTER" => Key::Return, "TAB" => Key::Tab, "ESC" | "ESCAPE" => Key::Escape, "SPACE" => Key::Space,
                    "BACKSPACE" => Key::Backspace, "DELETE" => Key::Delete, "HOME" => Key::Home, "END" => Key::End,
                    "PAGEUP" => Key::PageUp, "PAGEDOWN" => Key::PageDown, "UP" => Key::UpArrow, "DOWN" => Key::DownArrow,
                    "LEFT" => Key::LeftArrow, "RIGHT" => Key::RightArrow,
                    "F1" => Key::F1, "F2" => Key::F2, "F3" => Key::F3, "F4" => Key::F4, "F5" => Key::F5, "F6" => Key::F6,
                    "F7" => Key::F7, "F8" => Key::F8, "F9" => Key::F9, "F10" => Key::F10, "F11" => Key::F11, "F12" => Key::F12,
                    v if v.len() == 1 && v.as_bytes()[0].is_ascii_alphanumeric() => Key::Unicode(v.chars().next().unwrap().to_ascii_lowercase()),
                    _ => return Err("Unsupported shortcut key. Use modifiers, letters, digits, F1–F12, navigation and editing keys.".into()),
                };
                keys.push(key);
            }
            let mut pressed: Vec<Key> = Vec::new();
            for key in &keys {
                if let Err(_) = enigo.key(*key, Direction::Press) {
                    for held in pressed.iter().rev() { let _ = enigo.key(*held, Direction::Release); }
                    return Err("Windows could not press the requested shortcut.".into());
                }
                pressed.push(*key);
            }
            for key in pressed.iter().rev() {
                enigo.key(*key, Direction::Release).map_err(|_| "Windows could not release a shortcut key.".to_string())?;
            }
            Ok(serde_json::json!({ "action": "keyboard_shortcut", "keys": names, "approved_locally": true }))
        },
        _ => Err("Unsupported input action.".to_string()),
    }
}

async fn submit_relay_result(command_id: &str, result: serde_json::Value, error_message: Option<String>) -> Result<(), String> {
    let token = stored_token().ok_or("This computer is no longer paired.".to_string())?;
    let api_key = SUPABASE_ANON_KEY.filter(|value| !value.is_empty()).ok_or("Desktop relay is not configured.".to_string())?;
    let mut body = serde_json::json!({ "command_id": command_id, "result": result });
    if let Some(message) = error_message { body["error_message"] = serde_json::Value::String(message); }
    let response = reqwest::Client::new().post(format!("{SUPABASE_URL}/functions/v1/device-result"))
        .header("apikey", api_key).bearer_auth(&token).json(&body).send().await
        .map_err(|_| "Could not submit the action result.".to_string())?;
    if !response.status().is_success() { return Err(format!("The relay rejected the action result ({}).", response.status())); }
    Ok(())
}

#[tauri::command]
fn get_pending_action(pending: tauri::State<'_, PendingAction>) -> Option<serde_json::Value> {
    pending.0.lock().ok()?.as_ref().map(|command| serde_json::json!({ "id": command.id, "command": command.command, "payload": command.payload.clone() }))
}

#[tauri::command]
async fn approve_pending_action(pending: tauri::State<'_, PendingAction>, app: tauri::AppHandle, browser_consent: tauri::State<'_, BrowserConsent>, policy: tauri::State<'_, AutomationPolicyState>) -> Result<String, String> {
    if policy.0.lock().map(|p| p.paused || p.expires_at.map(|e| e <= now_epoch()).unwrap_or(false)).unwrap_or(true) {
        return Err("Automation is paused or the session has expired. Resume it locally first.".into());
    }
    let command = pending.0.lock().map_err(|_| "Approval state is unavailable.".to_string())?.clone().ok_or("There is no pending action to approve.")?;
    if !heartbeat().await || !authorize_pending_command(&command.id).await {
        pending.0.lock().map_err(|_| "Approval state is unavailable.".to_string())?.take();
        return Err("McpOS could not verify that this device and AI session are still authorised. The action was not executed.".to_string());
    }
    if policy.0.lock().map(|p| p.paused || p.expires_at.map(|e| e <= now_epoch()).unwrap_or(false)).unwrap_or(true) {
        pending.0.lock().map_err(|_| "Approval state is unavailable.".to_string())?.take();
        return Err("Automation was paused or expired while authorisation was being checked. The action was not executed.".to_string());
    }
    let action_result = if command.command.starts_with("browser.") && !browser_consent.0.load(Ordering::Relaxed) {
        Err("Isolated browser consent was switched off before approval.".to_string())
    } else if command.command.starts_with("browser.") {
        execute_browser_action(&command, &app)
    } else {
        execute_input_action(&command)
    };
    let (mut result, error) = match action_result { Ok(result) => (result, None), Err(message) => (serde_json::json!({}), Some(message)) };
    if error.is_none() { result["approval_mode"] = serde_json::Value::String("manual".into()); }
    let submission = submit_relay_result(&command.id, result, error.clone()).await;
    pending.0.lock().map_err(|_| "Approval state is unavailable.".to_string())?.take();
    submission?;
    if let Some(message) = error { Err(message) } else { Ok("The approved action was executed on this computer.".to_string()) }
}

#[tauri::command]
async fn deny_pending_action(pending: tauri::State<'_, PendingAction>) -> Result<String, String> {
    let command = pending.0.lock().map_err(|_| "Approval state is unavailable.".to_string())?.clone().ok_or("There is no pending action to deny.")?;
    let submission = submit_relay_result(&command.id, serde_json::json!({}), Some("The user denied this action on the Windows computer.".to_string())).await;
    pending.0.lock().map_err(|_| "Approval state is unavailable.".to_string())?.take();
    submission?;
    Ok("Action denied. Nothing was executed.".to_string())
}
async fn poll_relay_once(connected: &Arc<AtomicBool>, screen_consent: &Arc<AtomicBool>, accessibility_consent: &Arc<AtomicBool>, browser_consent: &Arc<AtomicBool>, approved_folders: &Arc<Mutex<Vec<PathBuf>>>, pending_action: &Arc<Mutex<Option<RelayCommand>>>, policy: &Arc<Mutex<AutomationPolicy>>, app: &tauri::AppHandle) {
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

    if matches!(command.command.as_str(), "input.pointer.click" | "input.pointer.move" | "input.pointer.scroll") || command.command == "input.keyboard.type" || command.command == "input.keyboard.shortcut" || command.command == "browser.open" || command.command == "browser.click" || command.command == "browser.type" {
        if command.command.starts_with("browser.") && !browser_consent.load(Ordering::Relaxed) {
            let _ = submit_relay_result(&command.id, serde_json::json!({}), Some("Isolated browser consent is switched off on this Windows computer.".to_string())).await;
            return;
        }
        let auto = policy.lock().map(|p| policy_auto_approves(&p, &command.command)).unwrap_or(false);
        if auto {
            let authorised = heartbeat().await && authorize_pending_command(&command.id).await;
            let still_allowed = policy.lock().map(|p| policy_auto_approves(&p, &command.command)).unwrap_or(false);
            let action = if !authorised {
                Err("Device or AI session is no longer authorised. Action blocked.".to_string())
            } else if !still_allowed {
                Err("Automation was paused or the session expired before execution. Action blocked.".to_string())
            } else if command.command.starts_with("browser.") {
                execute_browser_action(&command, app)
            } else {
                execute_input_action(&command)
            };
            let (mut result, error) = match action { Ok(v) => (v, None), Err(e) => (serde_json::json!({}), Some(e)) };
            if error.is_none() { result["approval_mode"] = serde_json::Value::String("auto".into()); }
            let _ = submit_relay_result(&command.id, result, error).await;
            return;
        }
        let command_id = command.id.clone();
        let already_pending = {
            let mut pending = pending_action.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            if pending.is_none() { *pending = Some(command); false } else { true }
        };
        if already_pending {
            let _ = submit_relay_result(&command_id, serde_json::json!({}), Some("Another local approval is already pending.".to_string())).await;
        } else { show_main_window(app); }
        return;
    }

    let device_id = credential(DEVICE_ID_KEY).ok().and_then(|entry| entry.get_password().ok());
    let (result, error_message) = match command.command.as_str() {
        "desktop.status" => (
            serde_json::json!({
                "paired": true,
                "connected": connected.load(Ordering::Relaxed),
                "device_id": device_id,
                "agent_version": env!("CARGO_PKG_VERSION"),
                "supported_commands": ["desktop.status", "screen.capture", "desktop.accessibility", "files.list", "files.read", "input.pointer.click", "input.pointer.move", "input.pointer.scroll", "input.keyboard.type", "input.keyboard.shortcut", "browser.open", "browser.snapshot", "browser.click", "browser.type"],
                "execution_enabled": policy.lock().map(|p| policy_active(&p)).unwrap_or(false),
                "automation_policy": policy.lock().map(|p| policy_json(&p)).unwrap_or_else(|_| serde_json::json!({"mode":"manual","paused":true})),
                "developer_tools": discover_developer_tools(),
                "permissions": {
                    "screen.capture": screen_consent.load(Ordering::Relaxed),
                    "screen.accessibility": accessibility_consent.load(Ordering::Relaxed),
                    "input.pointer": true,
                    "input.keyboard": true,
                    "browser.control": browser_consent.load(Ordering::Relaxed),
                    "files.read": !approved_folders.lock().map(|items| items.is_empty()).unwrap_or(true),
                    "files.write": false,
                    "apps.launch": false
                }
            }),
            None,
        ),
        "screen.capture" => {
            let (paused_or_expired, allowed_by_policy) = policy.lock().map(|p| {
                (p.paused || p.expires_at.map(|e| e <= now_epoch()).unwrap_or(p.mode != "manual"), policy_auto_approves(&p, "screen.capture"))
            }).unwrap_or((true, false));
            if paused_or_expired {
                (serde_json::json!({}), Some("Automation is paused or the local session has expired.".into()))
            } else if !screen_consent.load(Ordering::Relaxed) && !allowed_by_policy {
                (serde_json::json!({}), Some("Screen capture requires its local consent switch or an active session that explicitly allows captures.".into()))
            } else {
                match capture_screen_jpeg() {
                    Ok((image_base64, width, height)) => (
                        serde_json::json!({ "image_base64": image_base64, "mime_type": "image/jpeg", "width": width, "height": height, "approval_mode": if allowed_by_policy { "auto" } else { "local_consent" } }),
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
        "browser.snapshot" => {
            if !browser_consent.load(Ordering::Relaxed) {
                (serde_json::json!({}), Some("Isolated browser consent is switched off on this Windows computer.".to_string()))
            } else {
                match get_browser_snapshot(app, None) { Ok(snapshot) => (snapshot, None), Err(message) => (serde_json::json!({}), Some(message)) }
            }
        },
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

fn start_relay_polling(connected: Arc<AtomicBool>, screen_consent: Arc<AtomicBool>, accessibility_consent: Arc<AtomicBool>, browser_consent: Arc<AtomicBool>, approved_folders: Arc<Mutex<Vec<PathBuf>>>, pending_action: Arc<Mutex<Option<RelayCommand>>>, policy: Arc<Mutex<AutomationPolicy>>, app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            poll_relay_once(&connected, &screen_consent, &accessibility_consent, &browser_consent, &approved_folders, &pending_action, &policy, &app).await;
            // Faster polling only during an active automation session; retain idle cadence.
            let active = connected.load(Ordering::Relaxed) && policy.lock().map(|p| p.mode != "manual" && policy_active(&p)).unwrap_or(false);
            tokio::time::sleep(Duration::from_secs(if active { 2 } else { 10 })).await;
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
        .invoke_handler(tauri::generate_handler![pair_device, get_device_status, get_screen_capture_consent, set_screen_capture_consent, get_accessibility_consent, set_accessibility_consent, get_approved_folders, pick_approved_folder, remove_approved_folder, get_pending_action, approve_pending_action, deny_pending_action, get_browser_consent, set_browser_consent, get_automation_policy, set_automation_policy, pause_automation])
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
            let pending_action = Arc::new(Mutex::new(None));
            app.manage(PendingAction(pending_action.clone()));
            let browser_consent = Arc::new(AtomicBool::new(false));
            app.manage(BrowserConsent(browser_consent.clone()));
            app.manage(SelectedBrowserWindow(Mutex::new(None)));
            let automation_policy = Arc::new(Mutex::new(AutomationPolicy { mode: "manual".into(), paused: false, expires_at: None, auto_pointer: false, auto_keyboard: false, auto_browser: false, auto_screen: false }));
            app.manage(AutomationPolicyState(automation_policy.clone()));
            start_heartbeat(app.handle().clone(), connection_state.clone());
            start_relay_polling(connection_state, screen_consent, accessibility_consent, browser_consent, approved_folders, pending_action, automation_policy, app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running McpOS Desktop");
}
