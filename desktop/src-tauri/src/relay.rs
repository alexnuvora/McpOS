use std::{
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock, atomic::{AtomicBool, Ordering}},
    time::Duration,
};

use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use tauri::Emitter;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;

static PENDING_APPROVALS: OnceLock<Mutex<HashMap<String, tokio::sync::oneshot::Sender<bool>>>> = OnceLock::new();

fn pending_approvals() -> &'static Mutex<HashMap<String, tokio::sync::oneshot::Sender<bool>>> {
    PENDING_APPROVALS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn stored_value(key: &str) -> Option<String> {
    crate::credential(key).ok()?.get_password().ok()
}

#[tauri::command]
pub(crate) fn respond_remote_action(request_id: String, approved: bool) -> Result<(), String> {
    if request_id.is_empty() || request_id.len() > 80 {
        return Err("Invalid approval request.".into());
    }
    let sender = pending_approvals().lock()
        .map_err(|_| "Approval state is unavailable.".to_string())?
        .remove(&request_id)
        .ok_or("This approval request has expired.")?;
    sender.send(approved).map_err(|_| "The approval request has expired.".to_string())
}

async fn request_action_approval(
    app: &tauri::AppHandle,
    request_id: &str,
    command: &str,
    args: &Value,
) -> bool {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    if let Ok(mut pending) = pending_approvals().lock() {
        pending.insert(request_id.to_string(), sender);
    } else {
        return false;
    }
    crate::show_main_window(app);
    let payload = serde_json::json!({
        "requestId": request_id,
        "command": command,
        "args": args,
        "expiresInSeconds": 30
    });
    if app.emit("remote-action-request", payload).is_err() {
        if let Ok(mut pending) = pending_approvals().lock() { pending.remove(request_id); }
        return false;
    }
    match tokio::time::timeout(Duration::from_secs(30), receiver).await {
        Ok(Ok(approved)) => approved,
        _ => {
            if let Ok(mut pending) = pending_approvals().lock() { pending.remove(request_id); }
            false
        }
    }
}

async fn execute_remote_command(
    app: tauri::AppHandle,
    request_id: String,
    command: String,
    args: Value,
) -> Result<Value, String> {
    let permission_key = match command.as_str() {
        "capture_screen" => crate::SCREEN_CAPTURE_APPROVAL_KEY,
        "inspect_application" => crate::ACCESSIBILITY_APPROVAL_KEY,
        "click_application" => crate::POINTER_APPROVAL_KEY,
        "type_application_text" | "press_application_key" => crate::KEYBOARD_APPROVAL_KEY,
        _ => return Err("This desktop command is not supported.".into()),
    };
    if !crate::is_approved(permission_key) {
        return Err("The required desktop permission is disabled on this computer.".into());
    }
    if !request_action_approval(&app, &request_id, &command, &args).await {
        return Err("The local user denied this action or the approval timed out.".into());
    }

    tokio::task::spawn_blocking(move || {
        match command.as_str() {
            "capture_screen" => crate::capture_screen().map(Value::String),
            "inspect_application" => {
                let app_name = args.get("appName").and_then(Value::as_str)
                    .ok_or("Application name is missing.")?.to_string();
                crate::inspect_application(app_name).map(Value::String)
            }
            "click_application" => {
                let app_name = args.get("appName").and_then(Value::as_str)
                    .ok_or("Application name is missing.")?.to_string();
                let x = args.get("x").and_then(Value::as_f64).ok_or("X coordinate is missing.")?;
                let y = args.get("y").and_then(Value::as_f64).ok_or("Y coordinate is missing.")?;
                crate::click_application(app_name, x, y).map(|_| Value::Bool(true))
            }
            "type_application_text" => {
                let app_name = args.get("appName").and_then(Value::as_str)
                    .ok_or("Application name is missing.")?.to_string();
                let value = args.get("value").and_then(Value::as_str)
                    .ok_or("Text is missing.")?.to_string();
                crate::type_application_text(app_name, value).map(|_| Value::Bool(true))
            }
            "press_application_key" => {
                let app_name = args.get("appName").and_then(Value::as_str)
                    .ok_or("Application name is missing.")?.to_string();
                let key = args.get("key").and_then(Value::as_str)
                    .ok_or("Key chord is missing.")?.to_string();
                crate::press_application_key(app_name, key).map(|_| Value::Bool(true))
            }
            _ => Err("This desktop command is not supported.".into()),
        }
    }).await.map_err(|_| "Desktop action worker failed.".to_string())?
}

async fn run_relay_session(
    app: tauri::AppHandle,
    relay_connected: Arc<AtomicBool>,
    relay_url: String,
    token: String,
    device_id: String,
) -> Result<(), String> {
    use tokio_tungstenite::tungstenite::http::header::{AUTHORIZATION, HeaderName, HeaderValue};
    let mut request = relay_url.into_client_request()
        .map_err(|_| "The saved relay URL is invalid.".to_string())?;
    request.headers_mut().insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {token}"))
            .map_err(|_| "The device credential is invalid.".to_string())?,
    );
    request.headers_mut().insert(
        HeaderName::from_static("x-device-id"),
        HeaderValue::from_str(&device_id)
            .map_err(|_| "The device identity is invalid.".to_string())?,
    );

    let (mut socket, _) = tokio_tungstenite::connect_async(request).await
        .map_err(|error| format!("Relay connection failed: {error}"))?;
    relay_connected.store(true, Ordering::Relaxed);
    let _ = app.emit("relay-status", serde_json::json!({ "connected": true }));

    while let Some(message) = socket.next().await {
        let message = message.map_err(|error| format!("Relay connection closed: {error}"))?;
        match message {
            tokio_tungstenite::tungstenite::Message::Text(text) => {
                let Ok(value) = serde_json::from_str::<Value>(&text) else { continue; };
                if value.get("type").and_then(Value::as_str) != Some("command") { continue; }
                let Some(id) = value.get("id").and_then(Value::as_str).map(str::to_string) else { continue; };
                let Some(command) = value.get("command").and_then(Value::as_str).map(str::to_string) else { continue; };
                let args = value.get("args").cloned().unwrap_or_else(|| serde_json::json!({}));
                let response = match execute_remote_command(app.clone(), id.clone(), command, args).await {
                    Ok(result) => serde_json::json!({ "type": "result", "id": id, "ok": true, "result": result }),
                    Err(error) => serde_json::json!({ "type": "result", "id": id, "ok": false, "error": error }),
                };
                socket.send(tokio_tungstenite::tungstenite::Message::Text(response.to_string().into())).await
                    .map_err(|error| format!("Could not return desktop result: {error}"))?;
            }
            tokio_tungstenite::tungstenite::Message::Ping(payload) => {
                socket.send(tokio_tungstenite::tungstenite::Message::Pong(payload)).await
                    .map_err(|error| format!("Could not answer relay ping: {error}"))?;
            }
            tokio_tungstenite::tungstenite::Message::Close(_) => break,
            _ => {}
        }
    }
    relay_connected.store(false, Ordering::Relaxed);
    let _ = app.emit("relay-status", serde_json::json!({ "connected": false }));
    Ok(())
}

pub(crate) fn start_relay(app: tauri::AppHandle, relay_connected: Arc<AtomicBool>) {
    tauri::async_runtime::spawn(async move {
        loop {
            let token = crate::stored_token();
            let device_id = stored_value(crate::DEVICE_ID_KEY);
            let relay_url = stored_value(crate::RELAY_URL_KEY);
            if let (Some(token), Some(device_id), Some(relay_url)) = (token, device_id, relay_url) {
                if let Err(error) = run_relay_session(app.clone(), relay_connected.clone(), relay_url, token, device_id).await {
                    let _ = app.emit("relay-status", serde_json::json!({ "connected": false, "error": error }));
                }
            }
            relay_connected.store(false, Ordering::Relaxed);
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    });
}
