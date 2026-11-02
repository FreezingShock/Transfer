//! Live mode.
//!
//! The core is std-only, so it watches by listing the (non-recursive) top
//! level of each source folder every couple of seconds. Three directory
//! listings every 2s is negligible CPU and works identically on macOS and
//! Windows. The Tauri shell can swap in native events (FSEvents /
//! ReadDirectoryChangesW via the `notify` crate) without changing anything here:
//! it just calls `Engine::process(path)`.
//!
//! A file is only moved once its size and mtime have stopped changing for
//! `settle_secs`, so half-written downloads and saves are never grabbed.

use crate::engine::Engine;
use crate::journal::Entry;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

pub enum WatchEvent {
    Moved(Entry),
    Failed(String),
}

pub struct WatchHandle {
    stop: Arc<AtomicBool>,
}

impl WatchHandle {
    pub fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

impl Drop for WatchHandle {
    fn drop(&mut self) {
        self.stop();
    }
}

type Sig = (u64, Option<SystemTime>);

pub fn start(engine: Arc<Mutex<Engine>>, on_event: impl Fn(WatchEvent) + Send + 'static) -> WatchHandle {
    start_with_interval(engine, Duration::from_secs(2), on_event)
}

pub fn start_with_interval(
    engine: Arc<Mutex<Engine>>,
    every: Duration,
    on_event: impl Fn(WatchEvent) + Send + 'static,
) -> WatchHandle {
    let stop = Arc::new(AtomicBool::new(false));
    let stop2 = stop.clone();
    std::thread::Builder::new()
        .name("transfer-watch".into())
        .spawn(move || {
            // path -> (last signature, when it last changed)
            let mut seen: HashMap<PathBuf, (Sig, Instant)> = HashMap::new();
            // folders macOS (or anything else) refused us: don't knock again every tick,
            // that is what made the permission prompt come back over and over
            let mut denied: HashMap<PathBuf, Instant> = HashMap::new();
            while !stop2.load(Ordering::SeqCst) {
                let (sources, settle, paused) = {
                    let e = engine.lock().unwrap();
                    let s: Vec<PathBuf> = e.settings.active_sources().cloned().collect();
                    (s, Duration::from_secs(e.settings.settle_secs), e.settings.paused)
                };
                if !paused {
                    let mut present = std::collections::HashSet::new();
                    for dir in &sources {
                        if denied.get(dir).is_some_and(|t| t.elapsed() < Duration::from_secs(600)) {
                            continue;
                        }
                        let rd = match std::fs::read_dir(dir) {
                            Ok(rd) => {
                                denied.remove(dir);
                                rd
                            }
                            Err(e) => {
                                if e.kind() == std::io::ErrorKind::PermissionDenied {
                                    denied.insert(dir.clone(), Instant::now());
                                    on_event(WatchEvent::Failed(format!("no access to {} (allow it in System Settings > Privacy & Security > Files and Folders)", dir.display())));
                                }
                                continue;
                            }
                        };
                        for ent in rd.flatten() {
                            let path = ent.path();
                            let Ok(m) = std::fs::symlink_metadata(&path) else { continue };
                            if m.is_dir() {
                                continue;
                            }
                            let sig: Sig = (m.len(), m.modified().ok());
                            present.insert(path.clone());
                            let slot = seen.entry(path.clone()).or_insert((sig, Instant::now()));
                            if slot.0 != sig {
                                *slot = (sig, Instant::now()); // still changing
                                continue;
                            }
                            if slot.1.elapsed() < settle {
                                continue;
                            }
                            let res = engine.lock().unwrap().process(&path);
                            match res {
                                Some(Ok(e)) => {
                                    seen.remove(&path);
                                    on_event(WatchEvent::Moved(e));
                                }
                                // e.g. locked by another app: report once a minute, not every tick
                                Some(Err(msg)) => {
                                    slot.1 = Instant::now() + Duration::from_secs(60);
                                    on_event(WatchEvent::Failed(msg));
                                }
                                // held for review or ineligible: don't re-check it every tick
                                None => slot.1 = Instant::now() + Duration::from_secs(3600),
                            }
                        }
                    }
                    seen.retain(|p, _| present.contains(p));
                }
                std::thread::sleep(every);
            }
        })
        .expect("spawn watcher thread");
    WatchHandle { stop }
}
