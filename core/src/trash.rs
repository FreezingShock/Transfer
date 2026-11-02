//! Recoverable delete: the Windows Recycle Bin or the macOS Trash, through the
//! OS's own APIs (no third-party code, no helper processes on Windows, no
//! "control Finder" permission prompt on macOS).

use std::io;
use std::path::PathBuf;

/// Moves every path to the Recycle Bin / Trash. Stops at the first failure.
pub fn to_trash(paths: &[PathBuf]) -> io::Result<()> {
    if paths.is_empty() {
        return Ok(());
    }
    let abs: Vec<PathBuf> = paths.iter().map(std::fs::canonicalize).collect::<io::Result<_>>()?;
    imp::trash(&abs)
}

#[cfg(windows)]
mod imp {
    use std::ffi::c_void;
    use std::io;
    use std::os::windows::ffi::OsStrExt;
    use std::path::PathBuf;

    #[repr(C)]
    struct ShFileOpStructW {
        hwnd: *mut c_void,
        w_func: u32,
        p_from: *const u16,
        p_to: *const u16,
        f_flags: u16,
        f_any_operations_aborted: i32,
        h_name_mappings: *mut c_void,
        lpsz_progress_title: *const u16,
    }

    #[link(name = "shell32")]
    extern "system" {
        fn SHFileOperationW(op: *mut ShFileOpStructW) -> i32;
    }

    const FO_DELETE: u32 = 3;
    const FOF_SILENT: u16 = 0x4;
    const FOF_NOCONFIRMATION: u16 = 0x10;
    const FOF_ALLOWUNDO: u16 = 0x40;
    const FOF_NOERRORUI: u16 = 0x400;
    /// If a file can't go to the Recycle Bin (e.g. a drive without one), ask
    /// instead of deleting it for good.
    const FOF_WANTNUKEWARNING: u16 = 0x4000;

    /// `\\?\C:\x` → `C:\x`, `\\?\UNC\srv\x` → `\\srv\x` (the shell API rejects the long-path prefix).
    fn plain(p: &std::path::Path) -> Vec<u16> {
        let w: Vec<u16> = p.as_os_str().encode_wide().collect();
        let pre: Vec<u16> = r"\\?\".encode_utf16().collect();
        let unc: Vec<u16> = r"\\?\UNC\".encode_utf16().collect();
        if w.starts_with(&unc) {
            let mut out: Vec<u16> = r"\\".encode_utf16().collect();
            out.extend_from_slice(&w[unc.len()..]);
            out
        } else if w.starts_with(&pre) {
            w[pre.len()..].to_vec()
        } else {
            w
        }
    }

    pub fn trash(paths: &[PathBuf]) -> io::Result<()> {
        // one call for every file: a double-NUL-terminated list
        let mut from: Vec<u16> = Vec::new();
        for p in paths {
            from.extend(plain(p));
            from.push(0);
        }
        from.push(0);
        let mut op = ShFileOpStructW {
            hwnd: std::ptr::null_mut(),
            w_func: FO_DELETE,
            p_from: from.as_ptr(),
            p_to: std::ptr::null(),
            f_flags: FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI | FOF_WANTNUKEWARNING,
            f_any_operations_aborted: 0,
            h_name_mappings: std::ptr::null_mut(),
            lpsz_progress_title: std::ptr::null(),
        };
        let rc = unsafe { SHFileOperationW(&mut op) };
        if rc != 0 {
            return Err(io::Error::other(format!("Recycle Bin refused the files (code {rc:#x})")));
        }
        if op.f_any_operations_aborted != 0 {
            return Err(io::Error::other("cancelled"));
        }
        Ok(())
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use std::ffi::{c_char, c_void, CString};
    use std::io;
    use std::os::unix::ffi::OsStrExt;
    use std::path::PathBuf;

    type Id = *mut c_void;
    type Sel = *mut c_void;

    #[link(name = "Foundation", kind = "framework")]
    extern "C" {}

    #[link(name = "objc")]
    extern "C" {
        fn objc_getClass(name: *const c_char) -> Id;
        fn sel_registerName(name: *const c_char) -> Sel;
        fn objc_msgSend();
        fn objc_autoreleasePoolPush() -> *mut c_void;
        fn objc_autoreleasePoolPop(pool: *mut c_void);
    }

    unsafe fn class(name: &str) -> Id {
        let c = CString::new(name).unwrap();
        objc_getClass(c.as_ptr())
    }

    unsafe fn sel(name: &str) -> Sel {
        let c = CString::new(name).unwrap();
        sel_registerName(c.as_ptr())
    }

    /// `[[NSFileManager defaultManager] trashItemAtURL:[NSURL fileURLWithPath:p] resultingItemURL:nil error:nil]`
    unsafe fn trash_one(path: &CString) -> bool {
        type MsgStr = unsafe extern "C" fn(Id, Sel, *const c_char) -> Id;
        type MsgId = unsafe extern "C" fn(Id, Sel, Id) -> Id;
        type Msg0 = unsafe extern "C" fn(Id, Sel) -> Id;
        type MsgTrash = unsafe extern "C" fn(Id, Sel, Id, *mut Id, *mut Id) -> i8;
        let send = objc_msgSend as unsafe extern "C" fn();
        let msg_str: MsgStr = std::mem::transmute(send);
        let msg_id: MsgId = std::mem::transmute(send);
        let msg0: Msg0 = std::mem::transmute(send);
        let msg_trash: MsgTrash = std::mem::transmute(send);

        let pool = objc_autoreleasePoolPush();
        let s = msg_str(class("NSString"), sel("stringWithUTF8String:"), path.as_ptr());
        let ok = if s.is_null() {
            false
        } else {
            let url = msg_id(class("NSURL"), sel("fileURLWithPath:"), s);
            let fm = msg0(class("NSFileManager"), sel("defaultManager"));
            !url.is_null()
                && !fm.is_null()
                && msg_trash(fm, sel("trashItemAtURL:resultingItemURL:error:"), url, std::ptr::null_mut(), std::ptr::null_mut()) != 0
        };
        objc_autoreleasePoolPop(pool);
        ok
    }

    /// Fallback if Foundation refuses: ask Finder (may prompt for permission once).
    fn finder(p: &std::path::Path) -> io::Result<()> {
        let script = format!(
            "tell application \"Finder\" to delete POSIX file \"{}\"",
            p.display().to_string().replace('\\', "\\\\").replace('"', "\\\"")
        );
        let ok = std::process::Command::new("osascript").args(["-e", &script]).status()?.success();
        if ok { Ok(()) } else { Err(io::Error::other(format!("couldn't move {} to the Trash", p.display()))) }
    }

    pub fn trash(paths: &[PathBuf]) -> io::Result<()> {
        for p in paths {
            let c = CString::new(p.as_os_str().as_bytes()).map_err(io::Error::other)?;
            if !unsafe { trash_one(&c) } {
                finder(p)?;
            }
        }
        Ok(())
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
mod imp {
    use std::io;
    use std::path::PathBuf;

    pub fn trash(paths: &[PathBuf]) -> io::Result<()> {
        for p in paths {
            let ok = std::process::Command::new("gio").arg("trash").arg(p).status()?.success();
            if !ok {
                return Err(io::Error::other(format!("couldn't move {} to the trash", p.display())));
            }
        }
        Ok(())
    }
}
