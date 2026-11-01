use crate::lines::Line;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// Sort new files a few seconds after they land.
    Auto,
    /// Never move on its own; only when you confirm a Sweep.
    Ask,
    /// Ignored.
    Off,
}

impl Mode {
    pub fn id(self) -> &'static str {
        match self {
            Mode::Auto => "auto",
            Mode::Ask => "ask",
            Mode::Off => "off",
        }
    }
    pub fn parse(s: &str) -> Mode {
        match s.trim() {
            "auto" | "on" => Mode::Auto,
            "ask" => Mode::Ask,
            _ => Mode::Off,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Source {
    pub path: PathBuf,
    pub mode: Mode,
    /// Lines this folder sorts into; a file of any other type stays put.
    pub lines: Vec<Line>,
    /// Added by the user (removable), as opposed to Desktop/Downloads/Documents.
    pub custom: bool,
    /// Accent colour picked in the UI (#rrggbb), empty = default.
    pub color: String,
}

impl Source {
    pub fn new(path: PathBuf, mode: Mode) -> Source {
        Source { path, mode, lines: Line::ALL.to_vec(), custom: false, color: String::new() }
    }
    pub fn allows(&self, l: Line) -> bool {
        self.lines.contains(&l)
    }
}

#[derive(Debug, Clone)]
pub struct Settings {
    pub sources: Vec<Source>,
    /// Below this, a file is held for review instead of moved.
    pub confidence: f32,
    /// Installers older than this are flagged "safe to delete".
    pub stale_installer_days: u32,
    /// A new file must be untouched this long before it's moved
    /// (so half-finished downloads and saves are never grabbed).
    pub settle_secs: u64,
    pub paused: bool,
    pub launch_at_login: bool,
    /// "system" | "light" | "dark"
    pub theme: String,
}

impl Default for Settings {
    fn default() -> Self {
        let sources = [user_dir("Desktop"), user_dir("Downloads"), user_dir("Documents")]
            .into_iter()
            .flatten()
            .map(|path| {
                // Documents holds things people placed on purpose: ask first by default
                let mode = if path.ends_with("Documents") { Mode::Ask } else { Mode::Auto };
                Source::new(path, mode)
            })
            .collect();
        Settings {
            sources,
            confidence: 0.6,
            stale_installer_days: 30,
            settle_secs: 8,
            paused: false,
            launch_at_login: true,
            theme: "system".into(),
        }
    }
}

impl Settings {
    /// settings.txt: `key = value`; one line per folder:
    /// `source = <auto|ask|off>|<line ids, comma-separated>|<custom|>|<#color>|<path>`
    /// (the older `source = on|/path` form still loads).
    pub fn load(path: &Path) -> Settings {
        let Ok(text) = std::fs::read_to_string(path) else { return Settings::default() };
        let mut s = Settings { sources: vec![], ..Settings::default() };
        for line in text.lines() {
            let Some((k, v)) = line.split_once('=') else { continue };
            let (k, v) = (k.trim(), v.trim());
            match k {
                "source" => {
                    let f: Vec<&str> = v.splitn(5, '|').collect();
                    match f.len() {
                        2 => s.sources.push(Source::new(PathBuf::from(f[1]), Mode::parse(f[0]))),
                        5 => {
                            let mut src = Source::new(PathBuf::from(f[4]), Mode::parse(f[0]));
                            src.lines = f[1].split(',').filter_map(Line::parse).filter(|l| *l != Line::Holding).collect();
                            src.custom = f[2] == "custom";
                            src.color = f[3].to_string();
                            s.sources.push(src);
                        }
                        _ => {}
                    }
                }
                "theme" => s.theme = v.to_string(),
                "confidence" => s.confidence = v.parse().unwrap_or(s.confidence),
                "stale_installer_days" => s.stale_installer_days = v.parse().unwrap_or(s.stale_installer_days),
                "settle_secs" => s.settle_secs = v.parse().unwrap_or(s.settle_secs),
                "paused" => s.paused = v == "true",
                "launch_at_login" => s.launch_at_login = v == "true",
                _ => {}
            }
        }
        if s.sources.is_empty() {
            s.sources = Settings::default().sources;
        }
        s
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        let mut out = String::from("# Transfer settings (local only)\n");
        for src in &self.sources {
            out += &format!(
                "source = {}|{}|{}|{}|{}\n",
                src.mode.id(),
                src.lines.iter().map(|l| l.id()).collect::<Vec<_>>().join(","),
                if src.custom { "custom" } else { "" },
                src.color,
                src.path.display()
            );
        }
        out += &format!(
            "confidence = {}\nstale_installer_days = {}\nsettle_secs = {}\npaused = {}\nlaunch_at_login = {}\ntheme = {}\n",
            self.confidence, self.stale_installer_days, self.settle_secs, self.paused, self.launch_at_login, self.theme
        );
        std::fs::write(path, out)
    }

    /// Folders the live watcher sorts (mode Auto).
    pub fn active_sources(&self) -> impl Iterator<Item = &PathBuf> {
        self.sources.iter().filter(|s| s.mode == Mode::Auto).map(|s| &s.path)
    }

    /// Folders a Sweep covers (Auto and Ask).
    pub fn sweep_sources(&self) -> impl Iterator<Item = &PathBuf> {
        self.sources.iter().filter(|s| s.mode != Mode::Off).map(|s| &s.path)
    }

    /// The watched folder a file sits directly in, if any.
    pub fn source_of(&self, file: &Path) -> Option<&Source> {
        let parent = file.parent()?;
        self.sources.iter().find(|s| s.path == parent)
    }
}

pub fn home() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}

/// ~/Desktop, ~/Downloads, ~/Documents (same names on macOS and Windows
/// unless the user has relocated them; the app lets you re-pick).
fn user_dir(name: &str) -> Option<PathBuf> {
    let p = home()?.join(name);
    p.is_dir().then_some(p)
}

/// Per-user app data folder.
pub fn data_dir() -> PathBuf {
    if cfg!(target_os = "macos") {
        if let Some(h) = home() {
            return h.join("Library/Application Support/Transfer");
        }
    } else if cfg!(windows) {
        if let Some(a) = std::env::var_os("APPDATA") {
            return PathBuf::from(a).join("Transfer");
        }
    } else if let Some(x) = std::env::var_os("XDG_DATA_HOME") {
        return PathBuf::from(x).join("transfer");
    } else if let Some(h) = home() {
        return h.join(".local/share/transfer");
    }
    std::env::temp_dir().join("Transfer")
}
