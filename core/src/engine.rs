//! The engine ties it together: plan (dry run) → apply (journaled moves) →
//! undo / correct (which also teaches the local model).

use crate::classify::{classify, Verdict};
use crate::journal::{now, Entry, Journal};
use crate::lines::Line;
use crate::model::Model;
use crate::settings::Settings;
use crate::signals::{self, ContentKind};
use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

#[derive(Debug, Clone)]
pub struct Planned {
    pub from: PathBuf,
    pub to: PathBuf,
    pub line: Line,
    pub confidence: f32,
    pub reasons: Vec<String>,
    pub size: u64,
}

#[derive(Debug, Clone)]
pub struct Held {
    pub path: PathBuf,
    pub guess: Line,
    pub confidence: f32,
    pub reasons: Vec<String>,
    pub size: u64,
}

#[derive(Debug, Clone)]
pub struct Stale {
    pub path: PathBuf,
    pub age_days: u32,
    pub size: u64,
}

#[derive(Debug, Clone, Default)]
pub struct Plan {
    pub source: PathBuf,
    pub moves: Vec<Planned>,
    pub held: Vec<Held>,
    pub stale: Vec<Stale>,
    pub skipped: usize,
}

#[derive(Debug, Clone)]
pub struct Stats {
    pub per_line: Vec<(Line, u32)>,
    pub today: u32,
    pub total: u32,
    pub learned_examples: u32,
}

pub struct Engine {
    pub home: PathBuf,
    pub settings: Settings,
    pub model: Model,
    pub journal: Journal,
    /// Verdicts already worked out, so a refresh doesn't re-read every file.
    cache: Mutex<HashMap<PathBuf, Cached>>,
}

/// A verdict stays valid while the file's size and mtime, the model and the
/// threshold are unchanged.
#[derive(Clone)]
struct Cached {
    key: (u64, Option<SystemTime>, u32, u32),
    verdict: Verdict,
    kind: ContentKind,
}

const CACHE_MAX: usize = 20_000;

impl Engine {
    /// `TRANSFER_HOME` overrides the data folder (used by tests and the CLI demo).
    pub fn default_home() -> PathBuf {
        std::env::var_os("TRANSFER_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(crate::settings::data_dir)
    }

    pub fn open(home: PathBuf) -> io::Result<Engine> {
        std::fs::create_dir_all(&home)?;
        Ok(Engine {
            settings: Settings::load(&home.join("settings.txt")),
            model: Model::load(&home.join("model.tsv")),
            journal: Journal::open(&home.join("journal.tsv")),
            home,
            cache: Mutex::new(HashMap::new()),
        })
    }

    pub fn save_settings(&self) -> io::Result<()> {
        self.settings.save(&self.home.join("settings.txt"))
    }

    fn save_model(&self) {
        let _ = self.model.save(&self.home.join("model.tsv"));
    }

    // ------------------------------------------------------------ planning --

    /// Should Transfer touch this path at all?
    pub fn eligible(path: &Path, min_age_secs: u64) -> bool {
        let Some(name) = path.file_name().map(|n| n.to_string_lossy().to_string()) else {
            return false;
        };
        let lower = name.to_ascii_lowercase();
        if name.starts_with('.') || name.starts_with("~$") || name.starts_with("Icon\r") {
            return false;
        }
        if ["desktop.ini", "thumbs.db"].contains(&lower.as_str()) {
            return false;
        }
        const PARTIAL: [&str; 8] = [".crdownload", ".part", ".partial", ".download", ".tmp", ".opdownload", ".!ut", ".aria2"];
        if PARTIAL.iter().any(|p| lower.ends_with(p)) {
            return false;
        }
        let Ok(meta) = std::fs::symlink_metadata(path) else { return false };
        if meta.is_dir() {
            return false; // folders (and .app bundles) are left alone
        }
        // never move the running app itself (canonicalize only when the size matches)
        if let Some((me, me_len)) = own_exe() {
            if meta.len() == *me_len && std::fs::canonicalize(path).map(|p| &p == me).unwrap_or(false) {
                return false;
            }
        }
        // cloud-only placeholders (OneDrive Files On-Demand, iCloud "optimize storage"):
        // reading them would download them, so leave them alone
        if crate::cloud::cloud_only(&meta) {
            return false;
        }
        // Windows: hidden/system items (My Music, My Pictures, My Videos junctions,
        // desktop.ini, thumbnails) and any reparse point that targets a folder
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            const HIDDEN: u32 = 0x2;
            const SYSTEM: u32 = 0x4;
            const DIRECTORY: u32 = 0x10;
            let a = meta.file_attributes();
            if a & (HIDDEN | SYSTEM | DIRECTORY) != 0 {
                return false;
            }
        }
        // a symlink that points at a folder is a folder link, not a desktop shortcut
        if meta.file_type().is_symlink() && std::fs::metadata(path).map(|m| m.is_dir()).unwrap_or(false) && !cfg!(target_os = "macos") {
            return false;
        }
        let age = meta
            .modified()
            .ok()
            .and_then(|m| SystemTime::now().duration_since(m).ok())
            .map(|d| d.as_secs())
            .unwrap_or(u64::MAX);
        age >= min_age_secs
    }

    pub fn verdict(&self, path: &Path) -> io::Result<(Verdict, ContentKind, u64)> {
        let meta = std::fs::symlink_metadata(path)?;
        let key = (meta.len(), meta.modified().ok(), self.model.examples(), self.settings.confidence.to_bits());
        if let Some(c) = self.cache.lock().unwrap().get(path) {
            if c.key == key {
                return Ok((c.verdict.clone(), c.kind, meta.len()));
            }
        }
        let f = signals::extract(path)?;
        let v = classify(&f, &self.model, self.settings.confidence);
        let mut cache = self.cache.lock().unwrap();
        if cache.len() >= CACHE_MAX {
            cache.clear();
        }
        cache.insert(path.to_path_buf(), Cached { key, verdict: v.clone(), kind: f.kind });
        Ok((v, f.kind, f.size))
    }

    /// Forget verdicts for files that are gone (called after moves).
    fn forget(&self, path: &Path) {
        self.cache.lock().unwrap().remove(path);
    }

    pub fn plan(&self, dir: &Path, min_age_secs: u64) -> Plan {
        let mut plan = Plan { source: dir.to_path_buf(), ..Default::default() };
        let Ok(rd) = std::fs::read_dir(dir) else { return plan };
        let mut paths: Vec<PathBuf> = rd.flatten().map(|e| e.path()).collect();
        paths.sort();
        for path in paths {
            if !Self::eligible(&path, min_age_secs) {
                plan.skipped += 1;
                continue;
            }
            let Ok((v, _kind, size)) = self.verdict(&path) else {
                plan.skipped += 1;
                continue;
            };
            if v.line != Line::Holding && !self.allowed(&path, v.line) {
                plan.skipped += 1; // this folder doesn't sort that type: leave it
                continue;
            }
            if v.line == Line::Holding {
                plan.held.push(Held { path, guess: v.guess, confidence: v.confidence, reasons: v.reasons, size });
            } else {
                let to = unique_dest(dir, v.line, &path);
                plan.moves.push(Planned { from: path, to, line: v.line, confidence: v.confidence, reasons: v.reasons, size });
            }
        }
        plan.stale = self.stale_installers(dir);
        plan
    }

    pub fn plan_all(&self, min_age_secs: u64) -> Vec<Plan> {
        let srcs: Vec<PathBuf> = self.settings.sweep_sources().cloned().collect();
        srcs.iter().map(|s| self.plan(s, min_age_secs)).collect()
    }

    /// Does the folder this file sits in sort this type? Unwatched folders allow everything.
    fn allowed(&self, file: &Path, line: Line) -> bool {
        self.settings.source_of(file).map(|s| s.allows(line)).unwrap_or(true)
    }

    fn stale_installers(&self, dir: &Path) -> Vec<Stale> {
        let limit = self.settings.stale_installer_days as f64;
        let Ok(rd) = std::fs::read_dir(dir.join(Line::Installers.folder())) else { return vec![] };
        let mut out: Vec<Stale> = rd
            .flatten()
            .filter_map(|e| {
                let m = e.metadata().ok()?;
                if !m.is_file() {
                    return None;
                }
                let age = SystemTime::now().duration_since(m.modified().ok()?).ok()?.as_secs_f64() / 86400.0;
                (age > limit).then(|| Stale { path: e.path(), age_days: age as u32, size: m.len() })
            })
            .collect();
        out.sort_by(|a, b| b.size.cmp(&a.size));
        out
    }

    // ------------------------------------------------------------ applying --

    pub fn apply(&mut self, moves: &[Planned], via: &str) -> Vec<Result<Entry, String>> {
        moves
            .iter()
            .map(|m| {
                // re-resolve destination in case something appeared since planning
                let src_dir = m.from.parent().ok_or("no parent")?.to_path_buf();
                let to = unique_dest(&src_dir, m.line, &m.from);
                self.move_and_log(&m.from, &to, m.line, m.confidence, m.reasons.clone(), via)
            })
            .collect()
    }

    /// Classify one file and move it if confident. Used by the watcher.
    pub fn process(&mut self, path: &Path) -> Option<Result<Entry, String>> {
        if !Self::eligible(path, self.settings.settle_secs) {
            return None;
        }
        let (v, _, _) = self.verdict(path).ok()?;
        if v.line == Line::Holding || !self.allowed(path, v.line) {
            return None;
        }
        let to = unique_dest(path.parent()?, v.line, path);
        Some(self.move_and_log(path, &to, v.line, v.confidence, v.reasons, "auto"))
    }

    fn move_and_log(
        &mut self,
        from: &Path,
        to: &Path,
        line: Line,
        confidence: f32,
        reasons: Vec<String>,
        via: &str,
    ) -> Result<Entry, String> {
        move_file(from, to).map_err(|e| format!("{}: {e}", from.display()))?;
        self.forget(from);
        let e = Entry {
            id: self.journal.next_id(),
            ts: now(),
            from: from.to_path_buf(),
            to: to.to_path_buf(),
            line,
            confidence,
            reasons,
            undone: false,
            via: via.into(),
        };
        self.journal.record(e.clone()).map_err(|e| e.to_string())?;
        Ok(e)
    }

    pub fn undo(&mut self, id: u64) -> Result<Entry, String> {
        let e = self.journal.get(id).cloned().ok_or("no such move")?;
        if e.undone {
            return Err("already undone".into());
        }
        if !present(&e.to) {
            return Err("file has moved since; nothing to undo".into());
        }
        let back = if present(&e.from) { with_suffix(&e.from) } else { e.from.clone() };
        move_file(&e.to, &back).map_err(|x| x.to_string())?;
        self.journal.mark_undone(id).map_err(|x| x.to_string())?;
        Ok(e)
    }

    /// "That went to the wrong line": move it, and teach the model.
    pub fn correct(&mut self, id: u64, line: Line) -> Result<Entry, String> {
        if line == Line::Holding {
            return Err("pick a real line".into());
        }
        let e = self.journal.get(id).cloned().ok_or("no such move")?;
        let src_dir = e.from.parent().ok_or("no parent")?.to_path_buf();
        self.learn_from(&e.to, line);
        let to = unique_dest(&src_dir, line, &e.to);
        self.journal.mark_undone(id).map_err(|x| x.to_string())?;
        self.move_and_log(&e.to, &to, line, 1.0, vec!["you re-routed this".into()], "correction")
    }

    /// Resolve a held file from the review queue.
    pub fn route(&mut self, path: &Path, line: Line) -> Result<Entry, String> {
        self.learn_from(path, line);
        let to = unique_dest(path.parent().ok_or("no parent")?, line, path);
        self.move_and_log(path, &to, line, 1.0, vec!["you routed this".into()], "correction")
    }

    /// Move any file Transfer can see (loose, or already in a sorted folder)
    /// into another sorted folder of the same watched folder. Used by drag-to-sort
    /// and "Move to…". Teaches the model.
    pub fn move_to(&mut self, path: &Path, line: Line) -> Result<Entry, String> {
        if line == Line::Holding {
            return Err("pick a real folder".into());
        }
        let src = crate::browse::owner(&self.settings, path).ok_or("that file isn't in a watched folder")?.path.clone();
        if path.parent() == Some(src.join(line.folder()).as_path()) {
            return Err(format!("already in {}", line.folder()));
        }
        if !path.is_file() && std::fs::symlink_metadata(path).is_err() {
            return Err("file not found".into());
        }
        self.learn_from(path, line);
        let to = unique_dest(&src, line, path);
        self.move_and_log(path, &to, line, 1.0, vec!["you moved this".into()], "correction")
    }

    fn learn_from(&mut self, path: &Path, line: Line) {
        if let Ok(f) = signals::extract(path) {
            self.model.learn(&f.model_tokens(), line);
            self.save_model();
        }
    }

    /// Send stale installers to the OS Trash / Recycle Bin (recoverable).
    /// Only files inside the Installers folder of a watched folder are accepted.
    pub fn trash(&self, paths: &[PathBuf]) -> Result<usize, String> {
        for p in paths {
            let in_installers = p.parent().and_then(|d| d.file_name()).map(|d| d == Line::Installers.folder()).unwrap_or(false);
            if !in_installers || crate::browse::owner(&self.settings, p).is_none() || !p.is_file() {
                return Err(format!("refusing to trash {}", p.display()));
            }
        }
        crate::trash::to_trash(paths).map_err(|e| e.to_string())?;
        Ok(paths.len())
    }

    /// Recycle-bin any files that belong to a watched folder (used by the
    /// duplicate finder, where you pick exactly which copies go).
    pub fn trash_watched(&self, paths: &[PathBuf]) -> Result<usize, String> {
        for p in paths {
            if crate::browse::owner(&self.settings, p).is_none() || !p.is_file() {
                return Err(format!("refusing to trash {}", p.display()));
            }
        }
        crate::trash::to_trash(paths).map_err(|e| e.to_string())?;
        Ok(paths.len())
    }

    pub fn stats(&self) -> Stats {
        let day_start = now() - now() % 86400;
        let live = self.journal.all().iter().filter(|e| !e.undone);
        let mut per = [0u32; 9];
        let (mut today, mut total) = (0, 0);
        for e in live {
            per[e.line.index()] += 1;
            total += 1;
            if e.ts >= day_start {
                today += 1;
            }
        }
        Stats {
            per_line: Line::ALL.iter().map(|l| (*l, per[l.index()])).collect(),
            today,
            total,
            learned_examples: self.model.examples(),
        }
    }
}

// -------------------------------------------------------------- fs helpers --

/// The running executable (canonical path, size), looked up once.
fn own_exe() -> Option<&'static (PathBuf, u64)> {
    static ME: OnceLock<Option<(PathBuf, u64)>> = OnceLock::new();
    ME.get_or_init(|| {
        let p = std::fs::canonicalize(std::env::current_exe().ok()?).ok()?;
        let len = std::fs::metadata(&p).ok()?.len();
        Some((p, len))
    })
    .as_ref()
}

/// exists() follows symlinks; a shortcut to a missing app still "exists" here.
fn present(p: &Path) -> bool {
    std::fs::symlink_metadata(p).is_ok()
}

fn unique_dest(src_dir: &Path, line: Line, file: &Path) -> PathBuf {
    let name = file.file_name().unwrap_or_default();
    let dest = src_dir.join(line.folder()).join(name);
    if present(&dest) { with_suffix(&dest) } else { dest }
}

/// "clip.mp4" → "clip (2).mp4", "clip (3).mp4", ...
fn with_suffix(p: &Path) -> PathBuf {
    let stem = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let ext = p.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    (2..)
        .map(|i| p.with_file_name(format!("{stem} ({i}){ext}")))
        .find(|c| !present(c))
        .unwrap()
}

fn move_file(from: &Path, to: &Path) -> io::Result<()> {
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent)?;
    }
    match std::fs::rename(from, to) {
        Ok(()) => Ok(()),
        Err(_) if from.is_file() => {
            // different volume: copy, verify size, then remove
            let n = std::fs::copy(from, to)?;
            if n != std::fs::metadata(from)?.len() {
                let _ = std::fs::remove_file(to);
                return Err(io::Error::other("copy was incomplete"));
            }
            std::fs::remove_file(from)
        }
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::{Mode, Source};

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("transfer-engine-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn engine(root: &Path, dl: &Path) -> Engine {
        let mut e = Engine::open(root.join(".h")).unwrap();
        e.settings.sources = vec![Source::new(dl.to_path_buf(), Mode::Ask)];
        e
    }

    #[test]
    fn verdicts_are_cached_until_the_file_changes() {
        let root = temp("cache");
        let dl = root.join("Downloads");
        std::fs::create_dir_all(&dl).unwrap();
        let f = dl.join("notes");
        std::fs::write(&f, b"%PDF-1.7\nhello").unwrap();
        let e = engine(&root, &dl);
        assert_eq!(e.verdict(&f).unwrap().0.line, Line::Docs);
        assert_eq!(e.cache.lock().unwrap().len(), 1);
        // same size and mtime: the cached verdict is reused
        assert_eq!(e.verdict(&f).unwrap().0.line, Line::Docs);
        // new content (different size): re-read
        std::fs::write(&f, b"\x89PNG\r\n\x1a\n and then some more bytes").unwrap();
        assert_eq!(e.verdict(&f).unwrap().0.line, Line::Images);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn moves_forget_cached_verdicts() {
        let root = temp("forget");
        let dl = root.join("Downloads");
        std::fs::create_dir_all(&dl).unwrap();
        std::fs::write(dl.join("a.pdf"), b"%PDF-1.7\nx").unwrap();
        let mut e = engine(&root, &dl);
        let plan = e.plan(&dl, 0);
        assert_eq!(plan.moves.len(), 1);
        let done = e.apply(&plan.moves, "sweep");
        assert!(done[0].is_ok());
        assert!(dl.join("Docs/a.pdf").exists());
        assert!(e.cache.lock().unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn trash_only_takes_installers_inside_watched_folders() {
        let root = temp("trash");
        let dl = root.join("Downloads");
        let elsewhere = root.join("Elsewhere/Installers");
        std::fs::create_dir_all(dl.join("Installers")).unwrap();
        std::fs::create_dir_all(&elsewhere).unwrap();
        std::fs::write(elsewhere.join("x.exe"), b"MZ").unwrap();
        std::fs::write(dl.join("loose.exe"), b"MZ").unwrap();
        let e = engine(&root, &dl);
        assert!(e.trash(&[elsewhere.join("x.exe")]).is_err(), "Installers folder outside a watched folder");
        assert!(e.trash(&[dl.join("loose.exe")]).is_err(), "not in Installers");
        assert!(elsewhere.join("x.exe").exists() && dl.join("loose.exe").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn settings_keep_offline_folders_and_save_atomically() {
        let root = temp("settings");
        let file = root.join("settings.txt");
        let mut s = Settings::default();
        s.sources = vec![Source::new(PathBuf::from("/nowhere/unplugged/Stuff"), Mode::Auto)];
        s.save(&file).unwrap();
        assert!(!root.join("settings.tmp").exists());
        let back = Settings::load(&file);
        assert_eq!(back.sources.len(), 1);
        assert_eq!(back.sources[0].path, PathBuf::from("/nowhere/unplugged/Stuff"));
        let _ = std::fs::remove_dir_all(&root);
    }
}
