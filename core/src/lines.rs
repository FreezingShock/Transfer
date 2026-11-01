//! The "lines" a file can be routed onto. Each line is a destination folder
//! created inside the source folder (Downloads/Videos, Desktop/Shortcuts, ...).
//! The transit naming matches the Nexus design system: every line has a
//! bullet letter and a signal colour.

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Line {
    Shortcuts,
    Installers,
    Videos,
    Images,
    Audio,
    Docs,
    Archives,
    Code,
    /// Not confident enough to move. Stays put and shows up in the review queue.
    Holding,
}

impl Line {
    pub const ALL: [Line; 8] = [
        Line::Shortcuts,
        Line::Installers,
        Line::Videos,
        Line::Images,
        Line::Audio,
        Line::Docs,
        Line::Archives,
        Line::Code,
    ];

    /// Folder created inside the source folder.
    pub fn folder(self) -> &'static str {
        match self {
            Line::Shortcuts => "Shortcuts",
            Line::Installers => "Installers",
            Line::Videos => "Videos",
            Line::Images => "Images",
            Line::Audio => "Audio",
            Line::Docs => "Docs",
            Line::Archives => "Archives",
            Line::Code => "Code",
            Line::Holding => "",
        }
    }

    pub fn letter(self) -> char {
        match self {
            Line::Shortcuts => 'S',
            Line::Installers => 'I',
            Line::Videos => 'V',
            Line::Images => 'P',
            Line::Audio => 'A',
            Line::Docs => 'D',
            Line::Archives => 'Z',
            Line::Code => 'C',
            Line::Holding => '?',
        }
    }

    /// Nexus/MTA palette.
    pub fn color(self) -> &'static str {
        match self {
            Line::Shortcuts => "#0039A6",
            Line::Installers => "#EE352E",
            Line::Videos => "#FF6319",
            Line::Images => "#FCCC0A",
            Line::Audio => "#B933AD",
            Line::Docs => "#00933C",
            Line::Archives => "#996633",
            Line::Code => "#6CBE45",
            Line::Holding => "#A7A9AC",
        }
    }

    pub fn from_folder(name: &str) -> Option<Line> {
        Line::ALL.into_iter().find(|l| l.folder().eq_ignore_ascii_case(name))
    }

    pub fn index(self) -> usize {
        self as usize
    }

    /// Stable lower-case id used in files and the UI.
    pub fn id(self) -> &'static str {
        match self {
            Line::Holding => "holding",
            Line::Shortcuts => "shortcuts",
            Line::Installers => "installers",
            Line::Videos => "videos",
            Line::Images => "images",
            Line::Audio => "audio",
            Line::Docs => "docs",
            Line::Archives => "archives",
            Line::Code => "code",
        }
    }

    pub fn parse(s: &str) -> Option<Line> {
        let s = s.trim().to_ascii_lowercase();
        Line::ALL.into_iter().chain([Line::Holding]).find(|l| l.id() == s)
    }
}
