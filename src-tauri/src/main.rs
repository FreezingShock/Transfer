// Transfer desktop shell (Tauri 2).
//
// Thin by design: all sorting logic lives in transfer-core (std-only, no
// network). This file wires it to a window, a tray icon and launch-at-login.
// Plugins: autostart; dialog, opener and notification are called only from Rust
// (folder picker, opening/revealing files, move notices).
// No fs/shell/http plugins are installed, so the web UI cannot touch the disk or
// the network except through the commands below.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Deserialize;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use transfer_core::engine::Engine;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;
use transfer_core::browse;
use transfer_core::settings::{Mode, Source};
use transfer_core::watch::{self, WatchEvent, WatchHandle};
use transfer_core::{json, Line};

struct App {
    eng: Arc<Mutex<Engine>>,
    _watch: Mutex<Option<WatchHandle>>,
}

type Res = Result<String, String>;

fn line(s: &str) -> Result<Line, String> {
    Line::parse(s).ok_or_else(|| format!("unknown line {s}"))
}

// ------------------------------------------------------------- commands ----

#[tauri::command]
fn get_state(app: State<App>) -> String {
    json::state(&app.eng.lock().unwrap())
}

/// The plans for one watched folder, or every folder a sweep covers.
fn plans_for(e: &Engine, source: &Option<String>) -> Vec<transfer_core::Plan> {
    match source {
        Some(p) => {
            let p = PathBuf::from(p);
            match e.settings.sources.iter().find(|s| s.path == p && s.mode != Mode::Off) {
                Some(s) => vec![e.plan(&s.path, 2)],
                None => vec![],
            }
        }
        None => e.plan_all(2),
    }
}

/// Dry run. Moves nothing.
#[tauri::command]
fn plan(app: State<App>, source: Option<String>) -> String {
    json::plans(&plans_for(&app.eng.lock().unwrap(), &source))
}

#[tauri::command]
fn apply(app: State<App>, source: Option<String>) -> String {
    let mut e = app.eng.lock().unwrap();
    let moves: Vec<_> = plans_for(&e, &source).into_iter().flat_map(|p| p.moves).collect();
    let done: Vec<_> = e.apply(&moves, "sweep").into_iter().filter_map(Result::ok).collect();
    json::entries(&done)
}

/// Native folder picker. Runs off the main thread (async command).
#[tauri::command]
async fn pick_folder(handle: AppHandle) -> Option<String> {
    let picked = handle.dialog().file().set_title("Choose a folder for Transfer to watch").blocking_pick_folder()?;
    picked.into_path().ok().map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn undo(app: State<App>, id: u64) -> Res {
    app.eng.lock().unwrap().undo(id).map(|e| json::entry(&e))
}

#[tauri::command]
fn correct(app: State<App>, id: u64, line: String) -> Res {
    let l = self::line(&line)?;
    app.eng.lock().unwrap().correct(id, l).map(|e| json::entry(&e))
}

#[tauri::command]
fn route(app: State<App>, path: String, line: String) -> Res {
    let l = self::line(&line)?;
    let mut e = app.eng.lock().unwrap();
    // only files that sit directly in a watched folder can be routed
    let p = PathBuf::from(&path);
    if !e.settings.sweep_sources().any(|s| p.parent() == Some(s.as_path())) {
        return Err("that file isn't in a watched folder".into());
    }
    e.route(&p, l).map(|x| json::entry(&x))
}

/// Only paths inside a watched folder (or its sorted folders) can be opened.
fn watched(e: &Engine, path: &str) -> Result<(PathBuf, bool), String> {
    let p = PathBuf::from(path);
    let is_folder = e.settings.sources.iter().any(|s| {
        p == s.path || (p.parent() == Some(s.path.as_path()) && p.file_name().and_then(|n| n.to_str()).and_then(Line::from_folder).is_some())
    });
    if is_folder || browse::owner(&e.settings, &p).is_some() {
        Ok((p, is_folder))
    } else {
        Err("that isn't in a watched folder".into())
    }
}

#[tauri::command]
fn open_path(handle: AppHandle, app: State<App>, path: String) -> Result<(), String> {
    let (p, is_folder) = watched(&app.eng.lock().unwrap(), &path)?;
    // a sorted folder that doesn't exist yet: make it so Explorer has something to open
    if is_folder && !p.exists() {
        std::fs::create_dir_all(&p).ok();
    }
    handle.opener().open_path(p.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn reveal(handle: AppHandle, app: State<App>, path: String) -> Result<(), String> {
    let (p, _) = watched(&app.eng.lock().unwrap(), &path)?;
    handle.opener().reveal_item_in_dir(p).map_err(|e| e.to_string())
}

#[tauri::command]
fn move_to(app: State<App>, path: String, line: String) -> Res {
    let l = self::line(&line)?;
    app.eng.lock().unwrap().move_to(&PathBuf::from(path), l).map(|e| json::entry(&e))
}

#[tauri::command]
fn search(app: State<App>, query: String) -> String {
    let settings = app.eng.lock().unwrap().settings.clone();
    json::files(&browse::search(&settings, &query, 60))
}

/// Can read every candidate file, so it runs off the UI thread and without
/// holding the engine lock (the watcher keeps working meanwhile).
#[tauri::command]
async fn duplicates(app: State<'_, App>) -> Result<String, String> {
    let settings = app.eng.lock().unwrap().settings.clone();
    Ok(json::duplicates(&browse::duplicates(&settings)))
}

#[tauri::command]
fn trash_files(app: State<App>, paths: Vec<String>) -> Result<usize, String> {
    let p: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    app.eng.lock().unwrap().trash_watched(&p)
}

#[tauri::command]
fn trash(app: State<App>, paths: Vec<String>) -> Result<usize, String> {
    let p: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    app.eng.lock().unwrap().trash(&p)
}

#[derive(Deserialize)]
struct SourceDto {
    path: String,
    mode: String,
    lines: Vec<String>,
    #[serde(default)]
    custom: bool,
    #[serde(default)]
    color: String,
}
#[derive(Deserialize)]
struct SettingsDto {
    sources: Vec<SourceDto>,
    confidence: f32,
    stale_installer_days: u32,
    settle_secs: u64,
    paused: bool,
    launch_at_login: bool,
    #[serde(default)]
    theme: Option<String>,
}

#[tauri::command]
fn save_settings(handle: AppHandle, app: State<App>, settings: SettingsDto) -> Result<(), String> {
    {
        let mut e = app.eng.lock().unwrap();
        let s = &mut e.settings;
        s.sources = settings
            .sources
            .into_iter()
            .filter(|x| PathBuf::from(&x.path).is_dir())
            .map(|x| Source {
                path: PathBuf::from(x.path),
                mode: Mode::parse(&x.mode),
                lines: x.lines.iter().filter_map(|l| Line::parse(l)).filter(|l| *l != Line::Holding).collect(),
                custom: x.custom,
                color: x.color.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '#').take(9).collect(),
            })
            .collect();
        if let Some(t) = settings.theme.filter(|t| ["system", "light", "dark"].contains(&t.as_str())) {
            s.theme = t;
        }
        s.confidence = settings.confidence.clamp(0.3, 0.99);
        s.stale_installer_days = settings.stale_installer_days.max(1);
        s.settle_secs = settings.settle_secs.max(1);
        s.paused = settings.paused;
        s.launch_at_login = settings.launch_at_login;
        e.save_settings().map_err(|x| x.to_string())?;
    }
    let al = handle.autolaunch();
    let _ = if settings.launch_at_login { al.enable() } else { al.disable() };
    refresh_tray_label(&handle);
    Ok(())
}

// ------------------------------------------------------------- tray --------

fn show(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn toggle_pause(app: &AppHandle) {
    let st = app.state::<App>();
    let mut e = st.eng.lock().unwrap();
    e.settings.paused = !e.settings.paused;
    let _ = e.save_settings();
    drop(e);
    refresh_tray_label(app);
    let _ = app.emit("transfer://state", ());
}

fn refresh_tray_label(app: &AppHandle) {
    let paused = app.state::<App>().eng.lock().unwrap().settings.paused;
    if let Some(item) = app.try_state::<MenuItem<tauri::Wry>>() {
        let _ = item.set_text(if paused { "Resume sorting" } else { "Pause sorting" });
    }
}

// ------------------------------------------------------------- main --------

fn main() {
    let eng = Engine::open(Engine::default_home()).expect("open Transfer data folder");
    let eng = Arc::new(Mutex::new(eng));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--hidden"])))
        .manage(App { eng: eng.clone(), _watch: Mutex::new(None) })
        .invoke_handler(tauri::generate_handler![
            get_state, plan, apply, pick_folder, undo, correct, route, trash, save_settings,
            open_path, reveal, move_to, search, duplicates, trash_files
        ])
        .setup(move |app| {
            // live watcher → UI event per move
            let handle = app.handle().clone();
            let w = watch::start(eng.clone(), move |ev| match ev {
                WatchEvent::Moved(e) => {
                    let _ = handle.emit("transfer://moved", json::entry(&e));
                    // a Windows notice only when the window isn't on screen
                    let visible = handle.get_webview_window("main").and_then(|w| w.is_visible().ok()).unwrap_or(false);
                    if !visible {
                        let name = e.from.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                        let from = e.from.parent().and_then(|p| p.file_name()).map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                        let _ = handle.notification().builder().title(format!("Moved to {}", e.line.folder())).body(format!("{name} · from {from}")).show();
                    }
                }
                WatchEvent::Failed(msg) => eprintln!("transfer: {msg}"),
            });
            *app.state::<App>()._watch.lock().unwrap() = Some(w);

            // tray: the app lives here; closing the window keeps it running
            let open = MenuItem::with_id(app, "open", "Open Transfer", true, None::<&str>)?;
            let paused = eng.lock().unwrap().settings.paused;
            let pause = MenuItem::with_id(app, "pause", if paused { "Resume sorting" } else { "Pause sorting" }, true, None::<&str>)?;
            let sweep = MenuItem::with_id(app, "sweep", "Sweep now", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Transfer", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&open, &pause, &sweep, &sep, &quit])?;
            app.manage(pause.clone());
            TrayIconBuilder::with_id("transfer")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Transfer")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, ev| {
                    // left click opens/hides the window; right click shows the menu
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            if w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false) {
                                let _ = w.hide();
                            } else {
                                show(app);
                            }
                        }
                    }
                })
                .on_menu_event(|app, ev| match ev.id.as_ref() {
                    "open" => show(app),
                    "pause" => toggle_pause(app),
                    "sweep" => {
                        show(app);
                        let _ = app.emit("transfer://sweep", ());
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            // first launch registers launch-at-login if the setting is on
            if eng.lock().unwrap().settings.launch_at_login {
                let _ = app.autolaunch().enable();
            }
            if !std::env::args().any(|a| a == "--hidden") {
                show(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Transfer");
}
