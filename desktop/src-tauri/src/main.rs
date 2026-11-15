#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let open = MenuItem::with_id(app, "open", "Open McpOS", true, None::<&str>)?;
            let pause = MenuItem::with_id(app, "pause", "Pause desktop access", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit McpOS", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &pause, &quit])?;

            let icon = app
                .default_window_icon()
                .cloned()
                .ok_or("McpOS application icon is missing")?;

            TrayIconBuilder::new()
                .icon(icon)
                .tooltip("McpOS — Disconnected")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => show_main_window(app),
                    "pause" => {
                        // Until a device session exists, disconnected is already the safe state.
                        if let Some(tray) = app.tray_by_id("main") {
                            let _ = tray.set_tooltip(Some("McpOS — Paused"));
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

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
