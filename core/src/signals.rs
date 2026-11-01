//! Signal extraction. Everything here reads the file's own bytes and
//! filesystem metadata on this machine; nothing leaves the device and no file
//! contents are stored. The extension is only ever a weak tie-breaker; the
//! content signature decides.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::time::SystemTime;

const HEAD: usize = 8192;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContentKind {
    Shortcut,
    Executable,
    MacExecutable,
    WinInstallerMsi,
    MacDiskImage,
    MacPackage,
    AppPackage, // msix/appx/apk: zip with an app manifest
    Video,
    Image,
    Audio,
    Pdf,
    OfficeDoc,
    Archive,
    Text,
    Unknown,
}

#[derive(Debug, Clone)]
pub struct Features {
    pub kind: ContentKind,
    /// Host the file was downloaded from, if the OS recorded it
    /// (macOS kMDItemWhereFroms / Windows Zone.Identifier). Read locally.
    pub origin_host: Option<String>,
    pub size: u64,
    pub age_days: f64,
    pub name_tokens: Vec<String>,
    pub ext: String,
    /// 0..1, how "source code"-like a text file is.
    pub code_score: f32,
    /// Lower-cased words from the first few KB of a text file, used only as
    /// model features in memory. Never written to disk.
    pub text_tokens: Vec<String>,
}

impl Features {
    /// The bag of tokens the local model learns from.
    pub fn model_tokens(&self) -> Vec<String> {
        let mut t = Vec::with_capacity(self.name_tokens.len() + 8);
        t.push(format!("kind:{:?}", self.kind).to_lowercase());
        if !self.ext.is_empty() {
            t.push(format!("ext:{}", self.ext));
        }
        if let Some(h) = &self.origin_host {
            t.push(format!("host:{h}"));
            if let Some(root) = registrable(h) {
                t.push(format!("site:{root}"));
            }
        }
        t.push(format!("size:{}", size_bucket(self.size)));
        t.extend(self.name_tokens.iter().map(|w| format!("w:{w}")));
        t.extend(self.text_tokens.iter().take(64).map(|w| format!("t:{w}")));
        t
    }
}

pub fn extract(path: &Path) -> std::io::Result<Features> {
    let meta = std::fs::symlink_metadata(path)?;
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    let age_days = meta
        .modified()
        .ok()
        .and_then(|m| SystemTime::now().duration_since(m).ok())
        .map(|d| d.as_secs_f64() / 86400.0)
        .unwrap_or(0.0);

    let mut f = Features {
        kind: ContentKind::Unknown,
        origin_host: origin_host(path),
        size: meta.len(),
        age_days,
        name_tokens: tokenize_name(&name),
        ext,
        code_score: 0.0,
        text_tokens: vec![],
    };

    if meta.file_type().is_symlink() {
        f.kind = ContentKind::Shortcut;
        return Ok(f);
    }

    let mut file = File::open(path)?;
    let mut head = vec![0u8; HEAD];
    let n = read_up_to(&mut file, &mut head)?;
    head.truncate(n);
    f.kind = sniff(&head, &mut file, meta.len());

    if f.kind == ContentKind::Text {
        let text = String::from_utf8_lossy(&head);
        f.code_score = code_score(&text);
        f.text_tokens = tokenize_text(&text);
    }
    Ok(f)
}

fn read_up_to(file: &mut File, buf: &mut [u8]) -> std::io::Result<usize> {
    let mut total = 0;
    while total < buf.len() {
        match file.read(&mut buf[total..])? {
            0 => break,
            k => total += k,
        }
    }
    Ok(total)
}

/// Decide what a file *is* from its bytes.
pub fn sniff(head: &[u8], file: &mut File, len: u64) -> ContentKind {
    // --- shortcuts -------------------------------------------------------
    const LNK: [u8; 20] = [
        0x4C, 0, 0, 0, 0x01, 0x14, 0x02, 0, 0, 0, 0, 0, 0xC0, 0, 0, 0, 0, 0, 0, 0x46,
    ];
    if head.starts_with(&LNK) {
        return ContentKind::Shortcut; // Windows .lnk
    }
    if head.starts_with(b"book\0\0\0\0mark\0\0\0\0") {
        return ContentKind::Shortcut; // macOS Finder alias
    }
    let trimmed = trim_bom(head);
    if starts_with_ci(trimmed, b"[InternetShortcut]")
        || starts_with_ci(trimmed, b"[{000214A0")
        || starts_with_ci(trimmed, b"[Desktop Entry]")
    {
        return ContentKind::Shortcut; // .url / Linux .desktop
    }
    if (head.starts_with(b"bplist00") || contains(head, b"<plist"))
        && contains(head, b"URL")
        && contains(head, b"http")
        && len < 4096
    {
        return ContentKind::Shortcut; // .webloc
    }

    // --- installers ------------------------------------------------------
    if head.starts_with(&[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]) {
        return if cfb_is_msi(head, file) {
            ContentKind::WinInstallerMsi
        } else {
            ContentKind::OfficeDoc // legacy .doc/.xls/.ppt
        };
    }
    if head.starts_with(b"xar!") {
        return ContentKind::MacPackage;
    }
    if is_udif_dmg(file, len) {
        return ContentKind::MacDiskImage;
    }
    if head.starts_with(b"MZ") {
        return ContentKind::Executable;
    }
    if head.starts_with(&[0xCF, 0xFA, 0xED, 0xFE])
        || head.starts_with(&[0xCE, 0xFA, 0xED, 0xFE])
        || head.starts_with(&[0xCA, 0xFE, 0xBA, 0xBE]) && head.get(7).is_some_and(|b| *b < 20)
    {
        return ContentKind::MacExecutable; // Mach-O / universal binary
    }
    if head.starts_with(&[0x7F, b'E', b'L', b'F']) {
        return ContentKind::Executable; // treat ELF the same: "a program"
    }

    // --- media, documents, archives (built-in signature table) ------------
    if let Some(k) = magic(head) {
        return k;
    }

    // --- plain text --------------------------------------------------------
    if !head.is_empty() && looks_like_text(head) {
        if starts_with_ci(trimmed, b"{\\rtf") {
            return ContentKind::OfficeDoc;
        }
        if contains(&head[..head.len().min(1024)], b"<svg") {
            return ContentKind::Image;
        }
        return ContentKind::Text;
    }
    ContentKind::Unknown
}

/// Content signatures for the formats people actually pile up in
/// Downloads. Replaces a third-party sniffing crate.
fn magic(h: &[u8]) -> Option<ContentKind> {
    use ContentKind::*;
    let at = |i: usize, p: &[u8]| h.len() >= i + p.len() && &h[i..i + p.len()] == p;

    // ISO base media (mp4/mov/m4a/heic/avif): "ftyp" + brand
    if at(4, b"ftyp") && h.len() >= 12 {
        let brand = &h[8..12];
        return Some(match brand {
            b"M4A " | b"M4B " | b"M4P " | b"F4A " => Audio,
            b"heic" | b"heix" | b"hevc" | b"mif1" | b"msf1" | b"avif" | b"heim" | b"heis" => Image,
            _ => Video,
        });
    }
    if at(0, b"RIFF") && h.len() >= 12 {
        return match &h[8..12] {
            b"AVI " => Some(Video),
            b"WAVE" => Some(Audio),
            b"WEBP" => Some(Image),
            _ => None,
        };
    }
    if at(0, &[0x1A, 0x45, 0xDF, 0xA3]) {
        return Some(Video); // matroska / webm
    }
    if at(0, &[0x30, 0x26, 0xB2, 0x75, 0x8E, 0x66, 0xCF, 0x11]) || at(0, b"FLV\x01") || at(0, &[0, 0, 1, 0xBA]) {
        return Some(Video); // wmv/asf, flv, mpeg-ps
    }
    if h.len() > 188 && h[0] == 0x47 && h[188] == 0x47 {
        return Some(Video); // mpeg transport stream
    }
    // images
    if at(0, &[0xFF, 0xD8, 0xFF])
        || at(0, &[0x89, b'P', b'N', b'G'])
        || at(0, b"GIF8")
        || at(0, b"8BPS")
        || at(0, b"II*\0")
        || at(0, b"MM\0*")
        || (at(0, b"BM") && h.len() > 14 && h[6..10] == [0, 0, 0, 0])
        || at(0, &[0, 0, 1, 0]) && h.len() > 6 && h[4] > 0 && h[5] == 0
    {
        return Some(Image);
    }
    // audio
    if at(0, b"ID3") || at(0, b"fLaC") || at(0, b"OggS") || at(0, b"#!AMR")
        || (at(0, b"FORM") && (at(8, b"AIFF") || at(8, b"AIFC")))
        || (h.len() > 2 && h[0] == 0xFF && (h[1] & 0xF6) == 0xF2)
    {
        return Some(Audio);
    }
    if at(0, b"%PDF") {
        return Some(Pdf);
    }
    // zip family: app packages, office docs, plain archives
    if at(0, b"PK\x03\x04") {
        if contains(h, b"AppxManifest.xml") || contains(h, b"AndroidManifest.xml") || contains(h, b"AppxSignature") {
            return Some(AppPackage);
        }
        if contains(h, b"[Content_Types].xml")
            || contains(h, b"word/")
            || contains(h, b"mimetypeapplication/vnd.oasis")
            || contains(h, b"mimetypeapplication/epub")
            || contains(h, b"mimetypeapplication/vnd.apple")
        {
            return Some(OfficeDoc);
        }
        return Some(Archive);
    }
    if at(0, b"Rar!\x1A\x07")
        || at(0, &[0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C])
        || at(0, &[0x1F, 0x8B])
        || at(0, b"BZh")
        || at(0, &[0xFD, b'7', b'z', b'X', b'Z', 0])
        || at(0, &[0x28, 0xB5, 0x2F, 0xFD])
        || at(257, b"ustar")
    {
        return Some(Archive);
    }
    None
}

/// Compound File Binary: read the root directory entry's CLSID.
/// MSI databases use {000C1084-0000-0000-C000-000000000046}; Word/Excel use others.
fn cfb_is_msi(head: &[u8], file: &mut File) -> bool {
    const MSI: [u8; 16] = [
        0x84, 0x10, 0x0C, 0x00, 0x00, 0x00, 0x00, 0x00, 0xC0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46,
    ];
    if head.len() < 0x40 {
        return false;
    }
    let shift = u16::from_le_bytes([head[0x1E], head[0x1F]]) as u32;
    if !(9..=12).contains(&shift) {
        return false;
    }
    let sector = 1u64 << shift;
    let dir_sect = u32::from_le_bytes([head[0x30], head[0x31], head[0x32], head[0x33]]) as u64;
    let off = (dir_sect + 1) * sector + 0x50;
    let mut clsid = [0u8; 16];
    if file.seek(SeekFrom::Start(off)).is_err() || file.read_exact(&mut clsid).is_err() {
        return false;
    }
    clsid == MSI
}

/// Apple UDIF disk images end with a 512-byte "koly" trailer.
fn is_udif_dmg(file: &mut File, len: u64) -> bool {
    if len < 512 {
        return false;
    }
    let mut tag = [0u8; 4];
    file.seek(SeekFrom::Start(len - 512)).is_ok() && file.read_exact(&mut tag).is_ok() && &tag == b"koly"
}

fn looks_like_text(b: &[u8]) -> bool {
    if b.contains(&0) {
        return false;
    }
    // allow a truncated multi-byte char at the end of the sample
    let s = match std::str::from_utf8(b) {
        Ok(s) => s,
        Err(e) if e.valid_up_to() + 4 >= b.len() => std::str::from_utf8(&b[..e.valid_up_to()]).unwrap_or(""),
        Err(_) => return false,
    };
    let ctrl = s.chars().filter(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t')).count();
    ctrl * 50 < s.len().max(1)
}

fn code_score(text: &str) -> f32 {
    const MARKERS: [&str; 22] = [
        "{", "}", ";", "=>", "->", "::", "def ", "fn ", "function", "import ", "#include", "const ",
        "let ", "return", "class ", "pub ", "#!/", "</", "public ", "elif", "async ", "print(",
    ];
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).take(120).collect();
    if lines.is_empty() {
        return 0.0;
    }
    let hits = lines.iter().filter(|l| MARKERS.iter().any(|m| l.contains(m))).count();
    let indented = lines.iter().filter(|l| l.starts_with("    ") || l.starts_with('\t')).count();
    ((hits as f32 * 0.8 + indented as f32 * 0.4) / lines.len() as f32).min(1.0)
}

pub fn tokenize_name(name: &str) -> Vec<String> {
    let stem = match name.rfind('.') {
        Some(i) if i > 0 => &name[..i],
        _ => name,
    };
    let mut out = Vec::new();
    let lower = stem.to_lowercase();
    if is_versionish(&lower) {
        out.push("<version>".into());
    }
    // split camelCase and separators
    let mut cur = String::new();
    let mut prev_lower = false;
    for ch in stem.chars() {
        let boundary = !ch.is_alphanumeric() || (ch.is_uppercase() && prev_lower);
        if boundary && !cur.is_empty() {
            push_tok(&mut out, &cur);
            cur.clear();
        }
        if ch.is_alphanumeric() {
            cur.push(ch);
        }
        prev_lower = ch.is_lowercase();
    }
    if !cur.is_empty() {
        push_tok(&mut out, &cur);
    }
    out
}

fn push_tok(out: &mut Vec<String>, raw: &str) {
    let t = raw.to_lowercase();
    if t.chars().all(|c| c.is_ascii_digit()) {
        if t.len() == 4 && (t.starts_with("19") || t.starts_with("20")) {
            out.push("<year>".into());
        } else if !out.iter().any(|x| x == "<num>") {
            out.push("<num>".into());
        }
    } else if t.len() > 1 && t.len() < 24 {
        out.push(t);
    }
}

fn is_versionish(s: &str) -> bool {
    // v1.2, 3.10.4, 1_2_3, build-2024.11
    let b = s.as_bytes();
    for i in 0..b.len().saturating_sub(2) {
        if b[i].is_ascii_digit() && (b[i + 1] == b'.' || b[i + 1] == b'_') && b[i + 2].is_ascii_digit() {
            return true;
        }
    }
    false
}

fn tokenize_text(text: &str) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    text.split(|c: char| !c.is_alphanumeric())
        .map(|w| w.to_lowercase())
        .filter(|w| w.len() > 3 && w.len() < 20 && !w.chars().all(|c| c.is_ascii_digit()))
        .filter(|w| seen.insert(w.clone()))
        .take(200)
        .collect()
}

fn size_bucket(n: u64) -> &'static str {
    match n {
        0..=10_000 => "tiny",
        10_001..=1_000_000 => "small",
        1_000_001..=50_000_000 => "medium",
        50_000_001..=1_000_000_000 => "large",
        _ => "huge",
    }
}

fn registrable(host: &str) -> Option<String> {
    let parts: Vec<&str> = host.split('.').collect();
    (parts.len() >= 2).then(|| parts[parts.len() - 2..].join("."))
}

fn trim_bom(b: &[u8]) -> &[u8] {
    b.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(b)
}

fn starts_with_ci(h: &[u8], p: &[u8]) -> bool {
    h.len() >= p.len() && h[..p.len()].eq_ignore_ascii_case(p)
}

fn contains(h: &[u8], needle: &[u8]) -> bool {
    h.windows(needle.len()).any(|w| w == needle)
}

// ---------------------------------------------------------------- origin ---

/// Where was this downloaded from? The OS records it; we read it locally.
pub fn origin_host(path: &Path) -> Option<String> {
    let url = origin_url(path)?;
    let rest = url.split("://").nth(1)?;
    let host = rest.split(['/', ':', '?']).next()?.to_ascii_lowercase();
    (!host.is_empty()).then_some(host.trim_start_matches("www.").to_string())
}

#[cfg(target_os = "macos")]
fn origin_url(path: &Path) -> Option<String> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    extern "C" {
        // libSystem; always linked on macOS
        fn getxattr(path: *const i8, name: *const i8, value: *mut u8, size: usize, position: u32, options: i32) -> isize;
    }
    let p = CString::new(path.as_os_str().as_bytes()).ok()?;
    let name = CString::new("com.apple.metadata:kMDItemWhereFroms").ok()?;
    let mut buf = vec![0u8; 4096];
    let n = unsafe { getxattr(p.as_ptr(), name.as_ptr(), buf.as_mut_ptr(), buf.len(), 0, 0) };
    if n <= 0 {
        return None;
    }
    buf.truncate(n as usize);
    first_url(&buf)
}

#[cfg(windows)]
fn origin_url(path: &Path) -> Option<String> {
    let mut ads = path.as_os_str().to_owned();
    ads.push(":Zone.Identifier");
    let text = std::fs::read_to_string(ads).ok()?;
    text.lines()
        .find_map(|l| l.strip_prefix("HostUrl=").or_else(|| l.strip_prefix("ReferrerUrl=")))
        .map(|s| s.trim().to_string())
}

#[cfg(not(any(target_os = "macos", windows)))]
fn origin_url(_path: &Path) -> Option<String> {
    None
}

#[allow(dead_code)]
fn first_url(raw: &[u8]) -> Option<String> {
    let s = String::from_utf8_lossy(raw);
    let i = s.find("http")?;
    let url: String = s[i..].chars().take_while(|c| c.is_ascii_graphic()).collect();
    Some(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn name_tokens() {
        assert_eq!(
            tokenize_name("ZoomInstallerFull_v6.2.3.exe"),
            vec!["<version>", "zoom", "installer", "full", "v6", "<num>"]
        );
        assert!(tokenize_name("IMG_2024_0412.HEIC").contains(&"<year>".to_string()));
    }

    #[test]
    fn code_vs_prose() {
        assert!(code_score("fn main() {\n    println!(\"hi\");\n}\n") > 0.5);
        assert!(code_score("Dear Ms. Lee,\nThank you for the meeting today.\n") < 0.2);
    }
}
