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
use tauri_plugin_updater::UpdaterExt;
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
//
// Every command is async, so Tauri runs it on a worker thread instead of the
// main (window) thread: a slow disk or a long move never freezes the window.

#[tauri::command]
async fn get_state(app: State<'_, App>) -> Res {
    Ok(json::state(&app.eng.lock().unwrap()))
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
async fn plan(app: State<'_, App>, source: Option<String>) -> Res {
    Ok(json::plans(&plans_for(&app.eng.lock().unwrap(), &source)))
}

#[tauri::command]
async fn apply(app: State<'_, App>, source: Option<String>) -> Res {
    let mut e = app.eng.lock().unwrap();
    let moves: Vec<_> = plans_for(&e, &source).into_iter().flat_map(|p| p.moves).collect();
    let done: Vec<_> = e.apply(&moves, "sweep").into_iter().filter_map(Result::ok).collect();
    Ok(json::entries(&done))
}

/// Native folder picker.
#[tauri::command]
async fn pick_folder(handle: AppHandle) -> Option<String> {
    let picked = handle.dialog().file().set_title("Choose a folder for Transfer to watch").blocking_pick_folder()?;
    picked.into_path().ok().map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
async fn undo(app: State<'_, App>, id: u64) -> Res {
    app.eng.lock().unwrap().undo(id).map(|e| json::entry(&e))
}

#[tauri::command]
async fn correct(app: State<'_, App>, id: u64, line: String) -> Res {
    let l = self::line(&line)?;
    app.eng.lock().unwrap().correct(id, l).map(|e| json::entry(&e))
}

#[tauri::command]
async fn route(app: State<'_, App>, path: String, line: String) -> Res {
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
async fn open_path(handle: AppHandle, app: State<'_, App>, path: String) -> Result<(), String> {
    let (p, is_folder) = watched(&app.eng.lock().unwrap(), &path)?;
    // a sorted folder that doesn't exist yet: make it so Explorer has something to open
    if is_folder && !p.exists() {
        std::fs::create_dir_all(&p).ok();
    }
    handle.opener().open_path(p.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
async fn reveal(handle: AppHandle, app: State<'_, App>, path: String) -> Result<(), String> {
    let (p, _) = watched(&app.eng.lock().unwrap(), &path)?;
    handle.opener().reveal_item_in_dir(p).map_err(|e| e.to_string())
}

#[tauri::command]
async fn move_to(app: State<'_, App>, path: String, line: String) -> Res {
    let l = self::line(&line)?;
    app.eng.lock().unwrap().move_to(&PathBuf::from(path), l).map(|e| json::entry(&e))
}

#[tauri::command]
async fn search(app: State<'_, App>, query: String) -> Res {
    let settings = app.eng.lock().unwrap().settings.clone();
    Ok(json::files(&browse::search(&settings, &query, 60)))
}

/// Can read every candidate file, so it runs without holding the engine lock
/// (the watcher keeps working meanwhile).
#[tauri::command]
async fn duplicates(app: State<'_, App>) -> Res {
    let settings = app.eng.lock().unwrap().settings.clone();
    Ok(json::duplicates(&browse::duplicates(&settings)))
}

/// The only network call in the app: asks GitHub Releases for latest.json (signed; the
/// public key is in tauri.conf.json). Returns the new version, or None when up to date.
#[tauri::command]
async fn check_update(handle: AppHandle) -> Result<Option<String>, String> {
    let up = handle.updater().map_err(|e| e.to_string())?;
    Ok(up.check().await.map_err(|e| e.to_string())?.map(|u| u.version))
}

/// Downloads the signed update, installs it and restarts. Verified against the public key first.
#[tauri::command]
async fn install_update(handle: AppHandle) -> Result<(), String> {
    let up = handle.updater().map_err(|e| e.to_string())?;
    if let Some(u) = up.check().await.map_err(|e| e.to_string())? {
        u.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
        handle.restart();
    }
    Ok(())
}

#[tauri::command]
async fn trash_files(app: State<'_, App>, paths: Vec<String>) -> Result<usize, String> {
    let p: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    app.eng.lock().unwrap().trash_watched(&p)
}

#[tauri::command]
async fn trash(app: State<'_, App>, paths: Vec<String>) -> Result<usize, String> {
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
async fn save_settings(handle: AppHandle, app: State<'_, App>, settings: SettingsDto) -> Result<(), String> {
    {
        let mut e = app.eng.lock().unwrap();
        let s = &mut e.settings;
        s.sources = settings
            .sources
            .into_iter()
            // keep folders that are offline right now (unplugged drive, network share):
            // dropping them here would forget them for good
            .filter(|x| !x.path.trim().is_empty())
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

/// Windows build number (22000+ is Windows 11). RtlGetVersion isn't subject to
/// the compatibility shims that make GetVersionEx lie.
#[cfg(windows)]
fn windows_build() -> u32 {
    #[repr(C)]
    struct OsVersionInfoW {
        size: u32,
        major: u32,
        minor: u32,
        build: u32,
        platform: u32,
        csd: [u16; 128],
    }
    #[link(name = "ntdll")]
    extern "system" {
        fn RtlGetVersion(info: *mut OsVersionInfoW) -> i32;
    }
    let mut v = OsVersionInfoW { size: std::mem::size_of::<OsVersionInfoW>() as u32, major: 0, minor: 0, build: 0, platform: 0, csd: [0; 128] };
    if unsafe { RtlGetVersion(&mut v) } == 0 { v.build } else { 0 }
}

// ------------------------------------------------------------- main --------

fn main() {
    let eng = Engine::open(Engine::default_home()).expect("open Transfer data folder");
    let eng = Arc::new(Mutex::new(eng));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--hidden"])))
        .manage(App { eng: eng.clone(), _watch: Mutex::new(None) })
        .invoke_handler(tauri::generate_handler![
            get_state, plan, apply, pick_folder, undo, correct, route, trash, save_settings,
            open_path, reveal, move_to, search, duplicates, trash_files, check_update, install_update
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

            // Windows 11: Mica is the native backdrop (acrylic lags while dragging there)
            #[cfg(windows)]
            if windows_build() >= 22000 {
                if let Some(w) = app.get_webview_window("main") {
                    use tauri::window::{Effect, EffectsBuilder};
                    let _ = w.set_effects(EffectsBuilder::new().effect(Effect::Mica).build());
                }
            }

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
