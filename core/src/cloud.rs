//! Cloud-only placeholders: files that look local but whose bytes live in
//! OneDrive (Files On-Demand) or iCloud ("Optimize Mac Storage"). Opening one
//! to read its first 8 KB, or hashing it for duplicates, would make the OS
//! download it, so Transfer leaves them alone.

use std::fs::Metadata;

#[cfg(windows)]
pub fn cloud_only(m: &Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const OFFLINE: u32 = 0x1000;
    const RECALL_ON_OPEN: u32 = 0x4_0000;
    const RECALL_ON_DATA_ACCESS: u32 = 0x40_0000;
    m.file_attributes() & (OFFLINE | RECALL_ON_OPEN | RECALL_ON_DATA_ACCESS) != 0
}

#[cfg(target_os = "macos")]
pub fn cloud_only(m: &Metadata) -> bool {
    use std::os::macos::fs::MetadataExt;
    const SF_DATALESS: u32 = 0x4000_0000;
    m.st_flags() & SF_DATALESS != 0
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn cloud_only(_m: &Metadata) -> bool {
    false
}
