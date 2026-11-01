"""Builds a realistic messy Desktop/Downloads/Documents with real file
signatures (not just extensions) so the sorter can be tested end to end.
Usage: python3 demo/make_mess.py OUTDIR"""
import os, sys, struct, zipfile, io, time, gzip, tarfile

out = sys.argv[1]
D = {k: os.path.join(out, k) for k in ("Desktop", "Downloads", "Documents")}
for d in D.values(): os.makedirs(d, exist_ok=True)

def w(folder, name, data, age_days=1):
    p = os.path.join(D[folder], name)
    with open(p, "wb") as f: f.write(data)
    t = time.time() - age_days * 86400
    os.utime(p, (t, t))
    return p

pad = lambda n: os.urandom(n)
mp4 = lambda brand=b"isom": struct.pack(">I", 32) + b"ftyp" + brand + b"\0\0\2\0isomiso2avc1mp41" + pad(4000)
def cfb(clsid):  # minimal Compound File header + root dir entry with CLSID
    h = bytearray(512)
    h[0:8] = bytes.fromhex("D0CF11E0A1B11AE1")
    h[0x1E:0x20] = struct.pack("<H", 9)       # 512-byte sectors
    h[0x30:0x34] = struct.pack("<I", 0)       # first dir sector = 0
    d = bytearray(512); d[0x50:0x60] = clsid
    return bytes(h) + bytes(d) + pad(2048)
MSI = bytes([0x84,0x10,0x0C,0,0,0,0,0,0xC0,0,0,0,0,0,0,0x46])
WORD = bytes([0x06,0x09,0x02,0,0,0,0,0,0xC0,0,0,0,0,0,0,0x46])
def ozip(entries):
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        for n, c in entries: z.writestr(n, c)
    return b.getvalue()
LNK = bytes([0x4C,0,0,0,1,0x14,2,0,0,0,0,0,0xC0,0,0,0,0,0,0,0x46]) + pad(300)

# ---- Desktop: shortcuts + loose stuff
w("Desktop", "Minecraft Launcher.lnk", LNK)
w("Desktop", "Steam.lnk", LNK)
w("Desktop", "Roblox Studio.lnk", LNK)
w("Desktop", "SMC Portal.url", b"[InternetShortcut]\r\nURL=https://www.smc.edu/\r\n")
w("Desktop", "Topanga map.webloc", b'<?xml version="1.0"?><plist version="1.0"><dict><key>URL</key><string>https://maps.example.org/topanga</string></dict></plist>')
w("Desktop", "Screenshot 2026-10-30 at 4.12.55 PM.png", b"\x89PNG\r\n\x1a\n" + pad(9000))
w("Desktop", "untitled", b"\xff\xd8\xff\xe0\0\x10JFIF" + pad(6000))   # jpeg with no extension
w("Desktop", "infill_grid.py", b"import math\n\ndef lot_area(w, d):\n    return w * d\n\nclass Parcel:\n    def __init__(self, apn):\n        self.apn = apn\n")
w("Desktop", "ideas.txt", b"Senior project ideas\nShade structures for the quad\nBioswale along the parking lot edge\nTalk to Ms. Rivera about permits\n")
w("Desktop", ".DS_Store", pad(200))
w("Desktop", "desktop.ini", b"[.ShellClassInfo]\r\n")

# ---- Downloads: videos + setup things + docs
w("Downloads", "IMG_4417.MOV", mp4(b"qt  "))
w("Downloads", "xc_meet_finish.mp4", mp4())
w("Downloads", "lecture_week6", mp4())                       # no extension, still a video
w("Downloads", "edit_v3_final.mkv", bytes.fromhex("1A45DFA3") + b"\x42\x82\x88matroska" + pad(4000))
w("Downloads", "ZoomInstallerFull.exe", b"MZ\x90\0" + pad(6000))
w("Downloads", "BlenderSetup-4.2.1-x64.msi", cfb(MSI))
w("Downloads", "Obsidian-1.7.4.dmg", pad(3000) + b"koly" + pad(508))
w("Downloads", "GoogleChrome.pkg", b"xar!\0\x1c\0\1" + pad(3000))
w("Downloads", "SomeTool.msix", ozip([("AppxManifest.xml", "<Package/>"), ("AppxSignature.p7x", "x")]))
w("Downloads", "nexus-main.zip", ozip([("nexus-main/README.md", "# Nexus"), ("nexus-main/src/app.js", "let a=1;")]))
w("Downloads", "photos_from_coach.zip", ozip([("IMG_1.jpg", "x"), ("IMG_2.jpg", "y")]))
w("Downloads", "APBio_Lab7_rubric.pdf", b"%PDF-1.7\n" + pad(5000))
w("Downloads", "Cal Poly Pomona checklist.docx", ozip([("[Content_Types].xml", "<Types/>"), ("word/document.xml", "<w:document/>")]))
w("Downloads", "split_times.xlsx", ozip([("[Content_Types].xml", "<Types/>"), ("xl/workbook.xml", "<workbook/>")]))
w("Downloads", "old_essay.doc", cfb(WORD))
w("Downloads", "hyperpop_ref.mp3", b"ID3\x03\0\0\0\0\0\x21" + pad(5000))
w("Downloads", "kick_808.wav", b"RIFF\x24\x08\0\0WAVEfmt " + pad(3000))
w("Downloads", "cover.heic", struct.pack(">I", 24) + b"ftypheic\0\0\0\0mif1heic" + pad(4000))
w("Downloads", "receipt.pdf", b"\xff\xd8\xff\xe1" + pad(4000))   # mislabeled: actually a JPEG photo
w("Downloads", "dataset.bin", pad(5000))                          # unreadable: should be held
w("Downloads", "big_video.mp4.crdownload", mp4())                 # in-progress download: skipped
b = io.BytesIO()
with tarfile.open(fileobj=b, mode="w:gz") as t:
    ti = tarfile.TarInfo("ffmpeg/README"); data = b"ffmpeg"; ti.size = len(data); t.addfile(ti, io.BytesIO(data))
w("Downloads", "ffmpeg-7.1-macos-arm64.tar.gz", b.getvalue())
# an already-sorted, stale installer (60 days) for the "safe to delete" flag
os.makedirs(os.path.join(D["Downloads"], "Installers"), exist_ok=True)
w("Downloads", "Installers/DiscordSetup.exe", b"MZ" + pad(8000), age_days=60)
w("Downloads", "Installers/vlc-3.0.20-win64.exe", b"MZ" + pad(9000), age_days=45)

# ---- Documents
w("Documents", "Spanish vocab unit 4.txt", b"el ayuntamiento - city hall\nla acera - sidewalk\nel puente - bridge\n")
w("Documents", "Transfer essay draft.docx", ozip([("[Content_Types].xml", "<Types/>"), ("word/document.xml", "<w:document/>")]))
w("Documents", "track_pr_tracker.csv", b"date,event,time\n2026-09-14,3200m,10:12\n2026-10-02,5k xc,17:05\n")
w("Documents", "renovated_render.png", b"\x89PNG\r\n\x1a\n" + pad(12000))
w("Documents", "Topanga Tycoon.lnk", LNK)
print("made mess in", out)
