//! Append-only move log (journal.tsv). Every move is written here, so any
//! move can be reversed. Lives in the app's data folder on this machine.
//!
//!   M <id> <ts> <line> <confidence> <via> <from> <to> <reasons, \x1f-joined>
//!   U <id> <ts>

use crate::lines::Line;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct Entry {
    pub id: u64,
    pub ts: u64,
    pub from: PathBuf,
    pub to: PathBuf,
    pub line: Line,
    pub confidence: f32,
    pub reasons: Vec<String>,
    pub undone: bool,
    /// "auto" (watcher), "sweep" (manual run), "correction" (you re-routed it)
    pub via: String,
}

pub struct Journal {
    path: PathBuf,
    entries: Vec<Entry>,
}

fn esc(s: &str) -> String {
    s.replace('\\', "\\\\").replace('\t', "\\t").replace('\n', "\\n")
}
fn unesc(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut it = s.chars();
    while let Some(c) = it.next() {
        if c == '\\' {
            match it.next() {
                Some('t') => out.push('\t'),
                Some('n') => out.push('\n'),
                Some(o) => out.push(o),
                None => {}
            }
        } else {
            out.push(c);
        }
    }
    out
}

impl Journal {
    pub fn open(path: &Path) -> Journal {
        let mut entries: Vec<Entry> = Vec::new();
        let text = std::fs::read_to_string(path).unwrap_or_default();
        for line in text.lines() {
            let f: Vec<&str> = line.split('\t').collect();
            match f.first() {
                Some(&"M") if f.len() >= 8 => {
                    let (Ok(id), Ok(ts), Some(l)) = (f[1].parse(), f[2].parse(), Line::parse(f[3])) else { continue };
                    entries.push(Entry {
                        id,
                        ts,
                        line: l,
                        confidence: f[4].parse().unwrap_or(0.0),
                        via: f[5].to_string(),
                        from: PathBuf::from(unesc(f[6])),
                        to: PathBuf::from(unesc(f[7])),
                        reasons: f.get(8).map(|r| unesc(r).split('\x1f').map(String::from).collect()).unwrap_or_default(),
                        undone: false,
                    });
                }
                Some(&"U") if f.len() >= 2 => {
                    if let Ok(id) = f[1].parse::<u64>() {
                        if let Some(e) = entries.iter_mut().find(|e| e.id == id) {
                            e.undone = true;
                        }
                    }
                }
                _ => {} // tolerate a torn last line
            }
        }
        Journal { path: path.to_path_buf(), entries }
    }

    fn append(&self, row: String) -> std::io::Result<()> {
        let mut f = OpenOptions::new().create(true).append(true).open(&self.path)?;
        writeln!(f, "{row}")?;
        f.sync_data()
    }

    pub fn next_id(&self) -> u64 {
        self.entries.last().map(|e| e.id + 1).unwrap_or(1)
    }

    pub fn record(&mut self, e: Entry) -> std::io::Result<()> {
        self.append(format!(
            "M\t{}\t{}\t{}\t{:.3}\t{}\t{}\t{}\t{}",
            e.id,
            e.ts,
            e.line.id(),
            e.confidence,
            esc(&e.via),
            esc(&e.from.to_string_lossy()),
            esc(&e.to.to_string_lossy()),
            esc(&e.reasons.join("\x1f"))
        ))?;
        self.entries.push(e);
        Ok(())
    }

    pub fn mark_undone(&mut self, id: u64) -> std::io::Result<()> {
        self.append(format!("U\t{id}\t{}", now()))?;
        if let Some(e) = self.entries.iter_mut().find(|e| e.id == id) {
            e.undone = true;
        }
        Ok(())
    }

    pub fn get(&self, id: u64) -> Option<&Entry> {
        self.entries.iter().find(|e| e.id == id)
    }

    pub fn recent(&self, n: usize) -> Vec<Entry> {
        self.entries.iter().rev().take(n).cloned().collect()
    }

    pub fn all(&self) -> &[Entry] {
        &self.entries
    }
}

pub fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
