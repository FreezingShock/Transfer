# Release smoke test

Run on a real machine before telling anyone a release is ready. Ten minutes per OS.
Use `python3 demo/make_mess.py ~/TransferTest` and add `~/TransferTest/Downloads` as a folder
(Ask first) so nothing real moves until the last section.

## Both platforms

- [ ] App opens from the tray / menu bar; left click toggles the window; close hides to tray.
- [ ] Colors and icons show (if everything is grey, the CSP regressed: see CLAUDE.md).
- [ ] Sweep on the test folder: dry-run list looks right, Move works, every row has Undo, Undo puts the file back.
- [ ] Drop 20 files into the test folder at once (Auto): one refresh and one "Sorted 20 new files" toast, window never freezes.
- [ ] Unplug a drive (or rename a watched folder), change a setting, plug it back: the folder is still listed (shows Offline meanwhile).
- [ ] Find duplicates → remove one copy → it's in the Recycle Bin / Trash and restorable.
- [ ] Old installers → Clear → in the Recycle Bin / Trash.
- [ ] Notifications appear only while the window is hidden.
- [ ] Settings survive a restart; Open at login survives a reboot.

## Windows

- [ ] Fresh install with OneDrive backing up Desktop/Documents: the folders listed are the OneDrive ones
      (`%USERPROFILE%\OneDrive\Desktop`), not empty `%USERPROFILE%\Desktop`.
- [ ] An older install whose settings point at `%USERPROFILE%\Desktop` is moved to the real Desktop on first launch.
- [ ] A OneDrive "online-only" file (cloud icon) in a watched folder is not moved and does not start downloading.
- [ ] Trash: no console window flashes; files show up in the Recycle Bin.
- [ ] Windows 11: Mica backdrop, window drags smoothly. Windows 10: acrylic.
- [ ] Portable `Transfer.exe` and the installer both start; installer build shows notifications.

## Mac

- [ ] First launch: right-click → Open works (not notarized). Desktop/Documents/Downloads permission prompts appear once each.
- [ ] Trash: no "Transfer wants to control Finder" prompt; files are in the Trash with Put Back available.
- [ ] With iCloud "Optimize Mac Storage", an evicted file (cloud icon) is not moved and not downloaded.
- [ ] Vibrancy shows behind the window; window controls are top-left.
- [ ] Notifications show; launch at login works (LaunchAgent).
- [ ] Downloaded `.dmg` / `.pkg` go to Installers; Finder aliases go to Shortcuts.
