use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct Source {
    pub path: PathBuf,
    pub enabled: bool,
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
}

impl Default for Settings {
    fn default() -> Self {
        let sources = [user_dir("Desktop"), user_dir("Downloads"), user_dir("Documents")]
            .into_iter()
            .flatten()
            .map(|path| Source { path, enabled: true })
            .collect();
        Settings {
            sources,
            confidence: 0.6,
            stale_installer_days: 30,
            settle_secs: 8,
            paused: false,
            launch_at_login: true,
        }
    }
}

impl Settings {
    /// settings.txt: `key = value`, one `source = on|/path` per folder.
    pub fn load(path: &Path) -> Settings {
        let Ok(text) = std::fs::read_to_string(path) else { return Settings::default() };
        let mut s = Settings { sources: vec![], ..Settings::default() };
        for line in text.lines() {
            let Some((k, v)) = line.split_once('=') else { continue };
            let (k, v) = (k.trim(), v.trim());
            match k {
                "source" => {
                    if let Some((flag, p)) = v.split_once('|') {
                        s.sources.push(Source { path: PathBuf::from(p), enabled: flag == "on" });
                    }
                }
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
            out += &format!("source = {}|{}\n", if src.enabled { "on" } else { "off" }, src.path.display());
        }
        out += &format!(
            "confidence = {}\nstale_installer_days = {}\nsettle_secs = {}\npaused = {}\nlaunch_at_login = {}\n",
            self.confidence, self.stale_installer_days, self.settle_secs, self.paused, self.launch_at_login
        );
        std::fs::write(path, out)
    }

    pub fn active_sources(&self) -> impl Iterator<Item = &PathBuf> {
        self.sources.iter().filter(|s| s.enabled).map(|s| &s.path)
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
