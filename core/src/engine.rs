//! The engine ties it together: plan (dry run) → apply (journaled moves) →
//! undo / correct (which also teaches the local model).

use crate::classify::{classify, Verdict};
use crate::journal::{now, Entry, Journal};
use crate::lines::Line;
use crate::model::Model;
use crate::settings::Settings;
use crate::signals::{self, ContentKind};
use std::io;
use std::path::{Path, PathBuf};
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
}

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
        let age = meta
            .modified()
            .ok()
            .and_then(|m| SystemTime::now().duration_since(m).ok())
            .map(|d| d.as_secs())
            .unwrap_or(u64::MAX);
        age >= min_age_secs
    }

    pub fn verdict(&self, path: &Path) -> io::Result<(Verdict, ContentKind, u64)> {
        let f = signals::extract(path)?;
        Ok((classify(&f, &self.model, self.settings.confidence), f.kind, f.size))
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
        let srcs: Vec<PathBuf> = self.settings.active_sources().cloned().collect();
        srcs.iter().map(|s| self.plan(s, min_age_secs)).collect()
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
        if v.line == Line::Holding {
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

    fn learn_from(&mut self, path: &Path, line: Line) {
        if let Ok(f) = signals::extract(path) {
            self.model.learn(&f.model_tokens(), line);
            self.save_model();
        }
    }

    /// Send stale installers to the OS Trash / Recycle Bin (recoverable).
    /// Only files inside an Installers line folder are accepted.
    pub fn trash(&self, paths: &[PathBuf]) -> Result<usize, String> {
        let mut n = 0;
        for p in paths {
            let in_installers = p.parent().and_then(|d| d.file_name()).map(|d| d == Line::Installers.folder()).unwrap_or(false);
            if !in_installers || !p.is_file() {
                return Err(format!("refusing to trash {}", p.display()));
            }
            to_trash(p).map_err(|e| format!("{}: {e}", p.display()))?;
            n += 1;
        }
        Ok(n)
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

/// Native recycle bin via the OS's own tools (no third-party code).
fn to_trash(p: &Path) -> io::Result<()> {
    use std::process::Command;
    let abs = std::fs::canonicalize(p)?;
    let status = if cfg!(target_os = "macos") {
        let script = format!(
            "tell application \"Finder\" to delete POSIX file \"{}\"",
            abs.display().to_string().replace('\\', "\\\\").replace('"', "\\\"")
        );
        Command::new("osascript").args(["-e", &script]).status()?
    } else if cfg!(windows) {
        let ps = format!(
            "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('{}','OnlyErrorDialogs','SendToRecycleBin')",
            abs.display().to_string().trim_start_matches(r"\\?\").replace('\'', "''")
        );
        Command::new("powershell").args(["-NoProfile", "-Command", &ps]).status()?
    } else {
        Command::new("gio").arg("trash").arg(&abs).status()?
    };
    if status.success() { Ok(()) } else { Err(io::Error::other("trash command failed")) }
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
