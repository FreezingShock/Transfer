# Transfer

Keeps your Desktop, Downloads and Documents sorted automatically. Runs entirely on your computer: no account, no cloud, no network code.

Each kind of file rides a "line" into a folder made inside the folder it came from:

| | Line | Folder | Decided by |
|---|---|---|---|
| S | Shortcuts | `Shortcuts/` | `.lnk` / `.url` / Finder alias / `.webloc` / symlink, read from the bytes |
| I | Installers | `Installers/` | MSI database CLSID, DMG `koly` trailer, `xar!` pkg, MSIX/APK manifest, program binaries + "setup/version" names |
| V | Videos | `Videos/` | MP4/MOV `ftyp`, Matroska/WebM, AVI, WMV, FLV, MPEG-TS |
| P | Images | `Images/` | JPEG, PNG, GIF, HEIC/AVIF, WebP, TIFF, PSD, BMP, SVG |
| A | Audio | `Audio/` | MP3, WAV, FLAC, OGG, AIFF, M4A |
| D | Docs | `Docs/` | PDF, Office/OOXML, legacy .doc, OpenDocument, RTF, EPUB, prose text |
| Z | Archives | `Archives/` | ZIP, RAR, 7z, gzip, bzip2, xz, zstd, tar |
| C | Code | `Code/` | Text scored as code, source-download archives |
| ? | Review | stays put | Anything under the confidence threshold |

The extension is only a last-resort hint. A JPEG named `receipt.pdf` goes to Images; a video called `lecture_week6` with no extension goes to Videos.

## Layout

```
core/       transfer-core: classifier, planner, mover, undo journal, local learner, watcher. std only, zero dependencies.
cli/        `transfer` command, same engine. Good for testing.
src-tauri/  desktop shell (Tauri 2): window, tray, launch at login, commands.
ui/         the app's single-page UI (Nexus style). Also runs standalone in a browser with demo data.
demo/       make_mess.py builds a fake messy Desktop/Downloads/Documents with real file signatures.
```

## Try the engine (no app needed)

```sh
cargo build --release
python3 demo/make_mess.py /tmp/mess
export TRANSFER_HOME=/tmp/mess/.transfer      # keeps the demo's journal separate
./target/release/transfer plan  /tmp/mess/Desktop /tmp/mess/Downloads /tmp/mess/Documents   # dry run
./target/release/transfer apply /tmp/mess/Desktop /tmp/mess/Downloads /tmp/mess/Documents
./target/release/transfer history
./target/release/transfer undo 3
./target/release/transfer correct 12 archives   # re-route + teach the model
./target/release/transfer watch /tmp/mess/Downloads
./target/release/transfer explain /tmp/mess/Downloads/Videos/lecture_week6
```

Without `TRANSFER_HOME` and folder arguments it uses your real Desktop/Downloads/Documents. Run `plan` first.

## Run the desktop app

Needs Rust (rustup.rs) and Node 18+. On Windows, also the "Desktop development with C++" workload from Visual Studio Build Tools (WebView2 ships with Windows 11). On macOS, Xcode command line tools.

```sh
npm install
npm run dev        # opens the window, starts the watcher and tray icon
npm run build      # .dmg/.app on macOS, .msi/.exe on Windows (build on each OS)
```

Optional: copy `fonts.css` from your Nexus page into `ui/` for the Nexus serif. Without it the UI falls back to Charter/Georgia. The app never loads web fonts.

## Privacy, by construction

- `transfer-core` has no dependencies and no networking code. Nothing outside the Rust standard library reads your files.
- To classify, it reads the first 8 KB of a file (plus the last 512 bytes for disk images) into memory, decides, and drops it.
- Download origin comes from what your OS already recorded (macOS `kMDItemWhereFroms`, Windows `Zone.Identifier`). It's read locally and kept only in the move log.
- It writes exactly three files in your app data folder (`~/Library/Application Support/Transfer` or `%APPDATA%\Transfer`):
  - `settings.txt`: your settings
  - `journal.tsv`: every move (from, to, when, why) so any move can be undone
  - `model.tsv`: what it learned from your corrections, as hashed token counts. No names or words.
- The Tauri window has no fs/shell/http plugins. The UI can only call the eight commands in `src-tauri/src/main.rs`. CSP blocks all remote loads.

## Safety rules

- Only loose files at the top level of a watched folder. Folders, `.app` bundles and anything you've put in a subfolder are never touched.
- In-progress downloads (`.crdownload`, `.part`, `.download`, …), hidden and system files are skipped.
- A new file must sit unchanged for `settle_secs` (default 8 s) before it moves.
- Name clashes become `name (2).ext`. Nothing is ever overwritten.
- Trash only accepts files inside an `Installers/` folder and uses the OS Trash/Recycle Bin.
