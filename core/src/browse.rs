//! Looking at what's already sorted: per-folder tiles, name search, and exact
//! duplicate detection. Read-only; everything stays on this machine.

use crate::lines::Line;
use crate::settings::Settings;
use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Debug, Clone)]
pub struct Tile {
    pub line: Line,
    pub path: PathBuf,
    pub count: usize,
    pub bytes: u64,
    pub exists: bool,
}

#[derive(Debug, Clone)]
pub struct FileInfo {
    pub path: PathBuf,
    pub size: u64,
    pub modified: u64,
    /// The sorted folder it sits in, if any.
    pub line: Option<Line>,
}

fn visible(name: &str) -> bool {
    !(name.starts_with('.') || name.starts_with("~$") || name.eq_ignore_ascii_case("desktop.ini") || name.eq_ignore_ascii_case("thumbs.db"))
}

/// Plain files directly inside `dir` (no recursion into sub-sub-folders).
fn files_in(dir: &Path) -> Vec<(PathBuf, std::fs::Metadata)> {
    let Ok(rd) = std::fs::read_dir(dir) else { return vec![] };
    rd.flatten()
        .filter(|e| visible(&e.file_name().to_string_lossy()))
        .filter_map(|e| {
            let m = std::fs::symlink_metadata(e.path()).ok()?;
            (!m.is_dir()).then(|| (e.path(), m))
        })
        .collect()
}

/// One tile per sorted folder inside a watched folder: Downloads/Videos, ...
/// Counts everything there, including files you put in yourself.
pub fn tiles(src: &Path) -> Vec<Tile> {
    Line::ALL
        .iter()
        .map(|&line| {
            let path = src.join(line.folder());
            let files = files_in(&path);
            Tile {
                line,
                exists: path.is_dir(),
                count: files.len(),
                bytes: files.iter().map(|(_, m)| m.len()).sum(),
                path,
            }
        })
        .collect()
}

fn info(path: PathBuf, m: &std::fs::Metadata, line: Option<Line>) -> FileInfo {
    let modified = m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
    FileInfo { path, size: m.len(), modified, line }
}

/// Every file Transfer can see: the top of each watched folder plus its sorted folders.
pub fn all_files(settings: &Settings) -> Vec<FileInfo> {
    all_files_meta(settings).into_iter().map(|(f, _)| f).collect()
}

fn all_files_meta(settings: &Settings) -> Vec<(FileInfo, bool)> {
    let mut out = Vec::new();
    for s in &settings.sources {
        for (p, m) in files_in(&s.path) {
            out.push((info(p, &m, None), crate::cloud::cloud_only(&m)));
        }
        for line in Line::ALL {
            for (p, m) in files_in(&s.path.join(line.folder())) {
                out.push((info(p, &m, Some(line)), crate::cloud::cloud_only(&m)));
            }
        }
    }
    out
}

/// Case-insensitive name search; every word must appear. Newest first.
pub fn search(settings: &Settings, query: &str, limit: usize) -> Vec<FileInfo> {
    let words: Vec<String> = query.to_lowercase().split_whitespace().map(String::from).collect();
    if words.is_empty() {
        return vec![];
    }
    let mut hits: Vec<FileInfo> = all_files(settings)
        .into_iter()
        .filter(|f| {
            let n = f.path.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
            words.iter().all(|w| n.contains(w.as_str()))
        })
        .collect();
    hits.sort_by(|a, b| b.modified.cmp(&a.modified));
    hits.truncate(limit);
    hits
}

fn fnv_file(path: &Path, max: Option<u64>) -> Option<u64> {
    let mut f = File::open(path).ok()?;
    let mut h: u64 = 0xcbf29ce484222325;
    let mut buf = vec![0u8; 64 * 1024];
    let mut read: u64 = 0;
    loop {
        let n = f.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        for b in &buf[..n] {
            h ^= *b as u64;
            h = h.wrapping_mul(0x100000001b3);
        }
        read += n as u64;
        if max.is_some_and(|m| read >= m) {
            break;
        }
    }
    Some(h)
}

fn same_bytes(a: &Path, b: &Path) -> bool {
    let (Ok(mut fa), Ok(mut fb)) = (File::open(a), File::open(b)) else { return false };
    let (mut ba, mut bb) = (vec![0u8; 64 * 1024], vec![0u8; 64 * 1024]);
    loop {
        let (Ok(na), Ok(nb)) = (fa.read(&mut ba), fb.read(&mut bb)) else { return false };
        if na != nb || ba[..na] != bb[..nb] {
            return false;
        }
        if na == 0 {
            return true;
        }
    }
}

/// Groups of byte-for-byte identical files (1 KB and up), biggest waste first.
/// Narrowed by size, then a hash of the first 64 KB, then a full hash, then
/// confirmed with a byte comparison, so a group is never a guess.
pub fn duplicates(settings: &Settings) -> Vec<Vec<FileInfo>> {
    let mut by_size: HashMap<u64, Vec<FileInfo>> = HashMap::new();
    // cloud-only files are skipped: hashing them would download them
    for (f, cloud) in all_files_meta(settings) {
        if !cloud && f.size >= 1024 && !matches!(f.line, Some(Line::Shortcuts)) {
            by_size.entry(f.size).or_default().push(f);
        }
    }
    let mut groups = Vec::new();
    for (_, same) in by_size.into_iter().filter(|(_, v)| v.len() > 1) {
        let mut by_head: HashMap<u64, Vec<FileInfo>> = HashMap::new();
        for f in same {
            if let Some(h) = fnv_file(&f.path, Some(64 * 1024)) {
                by_head.entry(h).or_default().push(f);
            }
        }
        for (_, cand) in by_head.into_iter().filter(|(_, v)| v.len() > 1) {
            let mut by_full: HashMap<u64, Vec<FileInfo>> = HashMap::new();
            for f in cand {
                if let Some(h) = fnv_file(&f.path, None) {
                    by_full.entry(h).or_default().push(f);
                }
            }
            for (_, mut g) in by_full.into_iter().filter(|(_, v)| v.len() > 1) {
                let first = g[0].path.clone();
                g.retain(|f| f.path == first || same_bytes(&first, &f.path));
                if g.len() > 1 {
                    g.sort_by(|a, b| b.modified.cmp(&a.modified)); // newest first
                    groups.push(g);
                }
            }
        }
    }
    groups.sort_by(|a, b| (b[0].size * (b.len() as u64 - 1)).cmp(&(a[0].size * (a.len() as u64 - 1))));
    groups
}

/// The watched folder a path belongs to: the folder itself or one of its sorted folders.
pub fn owner<'a>(settings: &'a Settings, path: &Path) -> Option<&'a crate::settings::Source> {
    let parent = path.parent()?;
    settings.sources.iter().find(|s| {
        parent == s.path || (parent.parent() == Some(s.path.as_path()) && parent.file_name().and_then(|n| n.to_str()).and_then(Line::from_folder).is_some())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::{Mode, Source};

    #[test]
    fn tiles_search_and_dupes() {
        let root = std::env::temp_dir().join(format!("transfer-browse-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let dl = root.join("Downloads");
        std::fs::create_dir_all(dl.join("Videos")).unwrap();
        let big = vec![7u8; 5000];
        std::fs::write(dl.join("Videos/clip one.mp4"), &big).unwrap();
        std::fs::write(dl.join("clip one (copy).mp4"), &big).unwrap();
        let mut other = big.clone();
        other[4999] = 8;
        std::fs::write(dl.join("Videos/clip two.mp4"), &other).unwrap(); // same size, different bytes
        let mut s = Settings::default();
        s.sources = vec![Source::new(dl.clone(), Mode::Auto)];

        let t = tiles(&dl);
        let v = t.iter().find(|t| t.line == Line::Videos).unwrap();
        assert_eq!((v.count, v.exists), (2, true));
        assert!(!t.iter().find(|t| t.line == Line::Audio).unwrap().exists);

        assert_eq!(search(&s, "CLIP one", 10).len(), 2);
        assert_eq!(search(&s, "two", 10).len(), 1);

        let d = duplicates(&s);
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].len(), 2);

        assert!(owner(&s, &dl.join("Videos/clip two.mp4")).is_some());
        assert!(owner(&s, &root.join("elsewhere.txt")).is_none());
        let _ = std::fs::remove_dir_all(&root);
    }
}
