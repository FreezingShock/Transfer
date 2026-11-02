# Transfer: working notes

Transfer is Nathan's desktop app that keeps Desktop, Downloads and Documents
sorted automatically, entirely on-device. Rust engine + Tauri 2 shell + one-page
HTML/JS UI. Windows and macOS. Owner: Nathan (GitHub `FreezingShock`).

Read this before changing anything. Keep it current when a decision changes.

## Layout

| Path | What |
|---|---|
| `core/` | `transfer-core`: classifier, planner, mover, undo journal, local learner, watcher, browse (tiles/search/duplicates). **std only, zero dependencies, no network code.** Keep it that way. |
| `cli/` | `transfer` binary on the same engine. `plan`, `apply`, `watch`, `history`, `undo`, `correct`, `route`, `move`, `search`, `dupes`, `explain`, `state`. Fastest way to test engine changes. |
| `src-tauri/` | Desktop shell: window, tray, commands, plugins (autostart, dialog, opener, notification, all called from Rust only). Excluded from the root workspace; builds via `npx tauri build`. |
| `ui/` | `index.html` (all CSS) + `app.js` (all logic). Runs in the app, or in a plain browser on built-in demo data (`demoApi()`). |
| `demo/make_mess.py` | Builds a fake messy Desktop/Downloads/Documents with real file signatures. |
| `tools/ui-csp-check.js` | Renders the UI under the app's real CSP; fails visibly if inline styles get blocked. Run before every release. |
| `.github/workflows/build.yml` | CI: Windows + universal macOS builds, then one combined release. |

## Build and test

```sh
cargo build && cargo test                 # core + cli (tests in core/src/*.rs)
python3 demo/make_mess.py /tmp/mess
TRANSFER_HOME=/tmp/mess/.h ./target/debug/transfer plan /tmp/mess/Desktop /tmp/mess/Downloads /tmp/mess/Documents
TRANSFER_HOME=/tmp/mess/.h ./target/debug/transfer state   # exact JSON the UI receives
node tools/ui-csp-check.js                 # needs playwright
npm install && npm run dev                 # the real app (needs WebView2 / macOS WebKit)
```

UI changes: open `ui/index.html` in a browser (demo data), and also load it with a
real `transfer state` payload under the app CSP (see the check script) before shipping.

## Releasing (do exactly this)

1. Bump the version in **three** places: `src-tauri/tauri.conf.json`, `package.json`, `src-tauri/Cargo.toml`.
2. Commit and push to `main`. CI builds Windows and macOS in parallel.
3. The `release` job publishes `v<version>` **only if that tag doesn't exist yet and both builds passed**,
   with `Transfer.exe` (portable), `*_x64-setup.exe`, `*.msi`, `*_universal.dmg`.
4. Verify assets before telling Nathan it's ready:
   `gh api repos/FreezingShock/Transfer/releases/tags/vX.Y.Z --jq '.assets[].name'`.
   Never announce a release from a still-running build.

Pushes without a version bump build but don't release. Tag pushes and GitHub write API calls
are blocked from Claude's cloud sessions; that's why releases key off the version number.
Experimental UI work goes on a branch (`ui-*`) so `main` never references commands that don't exist yet.

## Hard-won rules

- **CSP / inline styles.** Tauri adds a nonce to any CSP directive it may modify; a nonce disables
  `'unsafe-inline'`, which silently kills every `style="…"` attribute (all colors vanished in v0.3.2).
  `tauri.conf.json` sets `dangerousDisableAssetCspModification: ["style-src"]`. Scripts stay strict:
  `script-src 'self'`, so **no inline `<script>`**. All JS lives in `ui/app.js`.
- **Never move:** hidden/system items (Windows HIDDEN/SYSTEM attrs, dotfiles, `desktop.ini`),
  folders and `.app` bundles, folder-pointing links (My Music/Pictures/Videos junctions), in-progress
  downloads (`.crdownload`, `.part`, …), files still changing (`settle_secs`), Transfer's own exe.
  These came from real incidents. Keep the guards in `Engine::eligible`.
- **Content beats extension.** Classification reads the first 8 KB (and the last 512 bytes for DMG).
  Extension is a last-resort hint only. Below the confidence threshold (default 60%) files are held
  for Review, never moved.
- **Every move is journaled** (`journal.tsv`) and undoable. Nothing is overwritten (`name (2).ext`).
  Trash only via OS Recycle Bin/Trash, and only for files inside watched folders.
- **Privacy:** only `settings.txt`, `journal.tsv`, `model.tsv` (hashed token counts, no words) in the
  app data folder. No network. Opening/revealing files is limited to paths inside watched folders.
- `exists()` follows symlinks; use `symlink_metadata` checks (`present()`) for shortcuts.

## Product decisions (Nathan's choices)

- Sorted folders are created **inside** each watched folder (`Downloads/Videos`, …).
  Lines: Shortcuts, Installers, Videos, Images, Audio, Docs, Archives, Code (+ Review/holding).
- Per watched folder: **mode** Auto (live) / Ask first (Sweep only) / Off, and **which lines it sorts into**.
  Fresh installs: Desktop and Downloads Auto, Documents Ask first. Any folder can be added (folder picker).
- Desktop shortcuts are grouped into `Shortcuts/`. Installers older than N days (default 30) are
  flagged and can be sent to the Recycle Bin.
- Click a file = open it; right-click = Open / Show in folder / Copy path / Undo / Move to.
  Drag a file onto a folder tile = move it there (teaches the model). Tiles count everything in
  the folder, and clicking a tile opens it in Explorer/Finder.
- Search covers watched folders and their sorted folders (names only). Duplicates: exact bytes,
  newest kept by default, never a whole set, user picks.
- Notifications only while the window is hidden.

## Design (Liquid Glass)

- Small window (440×700), transparent with OS acrylic (Windows) / vibrancy (macOS) under a theme tint.
  Light / Dark / System (follows the OS; toggle in Settings).
- Window controls: macOS-style dots, **top-left on Mac, top-right on Windows** (close outermost).
- Folder accents: Desktop `#0a84ff`, Downloads `#bf5af2`, Documents `#30c4a8`, added folders cycle.
  File-type icons softly tinted (separate light/dark glyph colors in `LINES`).
- Motion modeled on Apple Liquid Glass: damped springs, no wobble (`--snappy` damping .85 /
  stiffness 900; `--smooth` critically damped). The selection "lens" uses two springs (leading edge
  stiffer than trailing) so it stretches and thins (area-preserving), then settles. Controls swell
  ~8 px with a pointer-following highlight on press (never shrink). Toasts/menus use `gel()`.
  Respect `prefers-reduced-motion`. Nathan rejected bouncy/jelly motion: keep it liquid, not springy.
- The folder bar hides on Settings. Sweep button only on Home (removed, not hidden, so the tab bar spans).
- Before this design there was a "Nexus" transit-map style; Nathan moved away from it. Don't reintroduce it.

## Open items

- **v0.5:** first-run walkthrough (pick folders → pick modes → dry run before anything moves) and a
  glass tray popover (recent moves, Live toggle, Sweep, Open).
- **Unconfirmed misfile:** on Nathan's PC, `.hdr`, `.bin`, `.blend` and `.woff2` files landed in Code.
  The engine holds these for Review in tests; ask whether he routed them himself. If not, investigate
  `classify.rs` and the learner's influence.
- **Not yet tested on a real Mac:** folder permissions, Finder trash (AppleScript), notifications, vibrancy.
- **Windows notifications** may not show for the portable exe (no registered app id); the installer fixes that.
- Watcher polls every 2 s; switch the shell to native file events if many folders are added.
- Code signing (Windows certificate; Apple Developer ID + notarization) and auto-updates before sharing publicly.
- Topic sorting for Documents (School / Work / Receipts) with an on-device text model: later phase.

## Working with Nathan

He's on both Windows and Mac. He wants direct, honest status: say what's tested vs not, and don't
claim a release is ready until assets are verified. Ask about scope and taste before big UI changes
(he likes a quick multiple-choice round), show a prototype for redesigns, then build.
He'll send screenshots of what he sees; compare against what the code should render.
