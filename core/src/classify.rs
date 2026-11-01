//! Turns signals into a routing decision: content rules give a prior, the
//! local model (trained only on your corrections) shifts it, and anything
//! under the confidence threshold is held for review instead of moved.

use crate::lines::Line;
use crate::model::Model;
use crate::signals::{ContentKind, Features};

#[derive(Debug, Clone)]
pub struct Verdict {
    pub line: Line,
    /// Best real line even when held (shown as the suggestion in review).
    pub guess: Line,
    pub confidence: f32,
    /// Short human reasons, shown in the UI ("content: video stream").
    pub reasons: Vec<String>,
}

const INSTALLER_WORDS: [&str; 14] = [
    "setup", "install", "installer", "x64", "x86", "win64", "win32", "amd64", "arm64", "universal",
    "msi", "update", "launcher", "portable",
];
const SOURCE_WORDS: [&str; 6] = ["src", "source", "master", "main", "repo", "sdk"];
const CODE_EXT: [&str; 22] = [
    "py", "rs", "js", "ts", "tsx", "jsx", "java", "c", "h", "cpp", "cs", "go", "rb", "php", "swift", "kt",
    "lua", "sh", "ps1", "html", "css", "ipynb",
];

pub fn classify(f: &Features, model: &Model, threshold: f32) -> Verdict {
    let mut s = [0f32; 9];
    let mut why: Vec<String> = Vec::new();
    let has = |w: &str| f.name_tokens.iter().any(|t| t == w);
    let installerish = INSTALLER_WORDS.iter().any(|w| has(w)) || has("<version>");

    use ContentKind::*;
    match f.kind {
        Shortcut => {
            s[Line::Shortcuts.index()] = 1.0;
            why.push("content: link/alias record".into());
        }
        WinInstallerMsi | MacDiskImage | MacPackage | AppPackage => {
            s[Line::Installers.index()] = 0.97;
            why.push(format!("content: {}", label(f.kind)));
        }
        Executable => {
            s[Line::Installers.index()] = 0.72 + if installerish { 0.22 } else { 0.0 };
            s[Line::Code.index()] = 0.15;
            why.push("content: program binary".into());
            if installerish {
                why.push("name looks like a setup/version build".into());
            }
        }
        MacExecutable => {
            s[Line::Installers.index()] = 0.62;
            s[Line::Code.index()] = 0.3;
            why.push("content: macOS program".into());
        }
        Video => {
            s[Line::Videos.index()] = 0.96;
            why.push("content: video stream".into());
        }
        Image => {
            s[Line::Images.index()] = 0.95;
            why.push("content: image data".into());
        }
        Audio => {
            s[Line::Audio.index()] = 0.95;
            why.push("content: audio stream".into());
        }
        Pdf => {
            s[Line::Docs.index()] = 0.9;
            why.push("content: PDF".into());
        }
        OfficeDoc => {
            s[Line::Docs.index()] = 0.95;
            why.push("content: office document".into());
        }
        Archive => {
            s[Line::Archives.index()] = 0.7;
            why.push("content: compressed archive".into());
            if installerish {
                s[Line::Installers.index()] = 0.66;
                s[Line::Archives.index()] = 0.5;
                why.push("name looks like a release build".into());
            }
            if SOURCE_WORDS.iter().any(|w| has(w)) || f.origin_host.as_deref() == Some("codeload.github.com") {
                s[Line::Code.index()] = 0.72;
                why.push("looks like a source download".into());
            }
        }
        Text => {
            if f.code_score > 0.45 || CODE_EXT.contains(&f.ext.as_str()) {
                s[Line::Code.index()] = 0.7 + f.code_score * 0.25;
                why.push(format!("content: source code ({}% code-like)", (f.code_score * 100.0) as u32));
            } else {
                s[Line::Docs.index()] = 0.82;
                why.push("content: plain text / notes".into());
            }
        }
        Unknown => {
            // last resort: the extension, weakly
            if let Some(l) = ext_hint(&f.ext) {
                s[l.index()] = 0.5;
                why.push(format!("unreadable content, .{} hint only", f.ext));
            }
        }
    }

    if let Some(host) = &f.origin_host {
        why.push(format!("downloaded from {host}"));
        let h = host.as_str();
        if h.contains("github") && matches!(f.kind, Archive | Executable) && installerish {
            s[Line::Installers.index()] += 0.08;
        }
    }

    // blend in what you've taught it
    if let Some(p) = model.predict(&f.model_tokens()) {
        let w = model.weight();
        let (best, best_p) = argmax(&p);
        for i in 0..9 {
            s[i] = s[i] * (1.0 - w) + p[i] * w;
        }
        if best_p > 0.6 && w > 0.05 {
            why.push(format!("matches your past sorting → {}", best.folder()));
        }
    }

    let (line, conf) = argmax(&s);
    if conf < threshold {
        why.push(format!("only {}% sure, holding for review", (conf * 100.0) as u32));
        return Verdict { line: Line::Holding, guess: line, confidence: conf, reasons: why };
    }
    Verdict { line, guess: line, confidence: conf.min(0.99), reasons: why }
}

fn argmax(s: &[f32; 9]) -> (Line, f32) {
    let mut best = (Line::Holding, 0.0f32);
    for l in Line::ALL {
        if s[l.index()] > best.1 {
            best = (l, s[l.index()]);
        }
    }
    best
}

fn label(k: ContentKind) -> &'static str {
    match k {
        ContentKind::WinInstallerMsi => "Windows installer database",
        ContentKind::MacDiskImage => "macOS disk image",
        ContentKind::MacPackage => "macOS installer package",
        ContentKind::AppPackage => "app package",
        _ => "file",
    }
}

fn ext_hint(ext: &str) -> Option<Line> {
    Some(match ext {
        "lnk" | "url" | "webloc" | "desktop" => Line::Shortcuts,
        "exe" | "msi" | "dmg" | "pkg" | "msix" | "appx" | "apk" | "deb" | "rpm" => Line::Installers,
        "mp4" | "mov" | "mkv" | "avi" | "webm" | "m4v" => Line::Videos,
        "jpg" | "jpeg" | "png" | "gif" | "heic" | "webp" | "svg" | "psd" => Line::Images,
        "mp3" | "wav" | "flac" | "m4a" | "aac" | "ogg" => Line::Audio,
        "pdf" | "doc" | "docx" | "txt" | "md" | "pages" | "key" | "numbers" | "xlsx" | "pptx" | "csv" => Line::Docs,
        "zip" | "rar" | "7z" | "gz" | "tar" => Line::Archives,
        e if CODE_EXT.contains(&e) => Line::Code,
        _ => return None,
    })
}
