# Reads the files user-steps.mjs saved (22 Nov 2026): probes and decodes the videos with ffprobe/ffmpeg, checks the zip
# and the WAV, and writes crops and frame sheets to look at full size. Writes analysis.json next to report.json.
#   python -I _docs/capture-2026-11-21/analyse-steps.py <outDir>        (any shell; ffmpeg and ffprobe on PATH)
import json, os, subprocess, sys, tempfile, wave, zipfile
import numpy as np
from PIL import Image

out = sys.argv[1]
report = json.load(open(os.path.join(out, "report.json"), encoding="utf-8"))
results = []
RATE = 48000


def check(step, name, ok, detail=""):
    results.append({"step": step, "name": name, "pass": bool(ok), "detail": detail})
    print(("PASS" if ok else "FAIL"), f"{step}. {name}", "·", detail)


def probe(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-show_streams", "-show_format", "-of", "json", path],
                       capture_output=True, text=True)
    return json.loads(r.stdout)


def stream(info, kind):
    return next((s for s in info["streams"] if s["codec_type"] == kind), None)


def audio(path):
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", str(RATE), "-f", "f32le", "-"],
                       capture_output=True)
    return np.frombuffer(r.stdout, dtype=np.float32)


def first_onset(x, threshold_db=-40):
    idx = np.nonzero(np.abs(x) > 10 ** (threshold_db / 20))[0]
    return None if len(idx) == 0 else int(idx[0])


def lag(a, b, window=4800):
    """Samples b is behind a (cross-correlation over +-window samples, on the first 3 s)."""
    n = min(len(a), len(b), 3 * RATE)
    a, b = a[:n].astype(np.float64), b[:n].astype(np.float64)
    best, at = -1e30, 0
    for d in range(-window, window + 1, 1):
        v = np.dot(a[max(0, -d):n - max(0, d)], b[max(0, d):n - max(0, -d)])
        if v > best:
            best, at = v, d
    return at


def frame(path, n, dest, extra=()):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *extra, "-i", path, "-vf", f"select=eq(n\\,{n})", "-vframes", "1",
                    "-pix_fmt", "rgba", dest], check=True)
    return Image.open(dest)


def plan(duration, loop=False):
    return round(duration * 60) if loop else int(duration * 60 + 1e-3) + 1


def sheet(images, dest, scale=0.5):
    images = [im.convert("RGBA").resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS) for im in images]
    w, h = sum(im.width for im in images) + 8 * (len(images) - 1), max(im.height for im in images)
    canvas = Image.new("RGBA", (w, h), (40, 40, 40, 255))
    x = 0
    for im in images:
        canvas.alpha_composite(im, (x, 0))
        x += im.width + 8
    canvas.save(dest)


emote = report.get("emote") or {}
frames_expected = plan(emote["duration"]) if emote else None
cue_starts = sorted(q["start"] for q in emote.get("cues", []))
steps = report["steps"]

# ---- 1. Screenshots: same-size grab vs the 1x PNG, crops of head and feet; the 2x PNG across its tile seams.
if "1" in steps:
    s = steps["1"]
    grab = Image.open(os.path.join(out, "1-screen-grab.png")).convert("RGB")
    one = Image.open(s["shots"]["1"]["path"]).convert("RGB")
    two = Image.open(s["shots"]["2"]["path"]).convert("RGB")
    clear = Image.open(s["transparent"]["path"])
    a = np.asarray(clear.convert("RGBA"))[:, :, 3]
    ys, xs = np.nonzero(a > 0)
    check(1, "the 1x PNG is the grab's size; 2x is twice that", one.size == grab.size and two.size == (2 * grab.width, 2 * grab.height),
          f"grab {grab.size} · 1x {one.size} · 2x {two.size}")
    check(1, "the transparent PNG is see-through around the character", clear.mode == "RGBA" and a[0, 0] == 0 and (a == 255).sum() > 10000,
          f"{clear.mode} {clear.size} · corner alpha {a[0, 0]} · opaque {(a == 255).sum()} · soft {((a > 0) & (a < 255)).sum()}")
    # Character box in 1x pixels (the transparent PNG is at 2x).
    x0, x1, y0, y1 = xs.min() // 2, xs.max() // 2, ys.min() // 2, ys.max() // 2
    h = y1 - y0
    for name, (top, bottom) in {"head": (y0, y0 + int(0.16 * h)), "feet": (y1 - int(0.12 * h), y1)}.items():
        box = (max(0, x0 - 10), max(0, top - 6), min(grab.width, x1 + 10), min(grab.height, bottom + 6))
        if name == "head":
            cx = (x0 + x1) // 2
            box = (max(0, cx - 70), box[1], min(grab.width, cx + 70), box[3])
        g, o = grab.crop(box), one.crop(box)
        t = two.crop(tuple(2 * v for v in box))
        k = 3
        g = g.resize((g.width * k, g.height * k), Image.NEAREST)
        o = o.resize((o.width * k, o.height * k), Image.NEAREST)
        t = t.resize((int(t.width * 1.5), int(t.height * 1.5)), Image.NEAREST)
        sheet([g, o, t], os.path.join(out, f"1-compare-{name}.png"), scale=1)
    # The 2x render is drawn in tiles: a 1:1 crop where the seams would cross, at the image's middle.
    cx, cy = two.width // 2, two.height // 2
    two.crop((cx - 300, cy - 300, cx + 300, cy + 300)).save(os.path.join(out, "1-2x-middle-1to1.png"))

# ---- 2. MP4: frames, rate, sound present, in sync (first cue onset vs its time), frames to look at.
mp4_audio = None
if "2" in steps:
    p = steps["2"]["path"]
    info = probe(p)
    v, au = stream(info, "video"), stream(info, "audio")
    n = int(v["nb_read_frames"])
    check(2, "H.264, 60 fps, the whole emote", v["codec_name"] == "h264" and v["r_frame_rate"] == "60/1" and n == frames_expected,
          f"{v['codec_name']} {v.get('profile')} {v['width']}x{v['height']} {v['r_frame_rate']} · {n} frames (expected {frames_expected}) · {os.path.getsize(p) / 1e6:.1f} MB")
    mp4_audio = audio(p)
    dur_v, dur_a = n / 60, len(mp4_audio) / RATE
    onset = first_onset(mp4_audio)
    delta = None if onset is None or not cue_starts else onset / RATE - cue_starts[0]
    check(2, "sound present, as long as the video", au is not None and abs(dur_a - dur_v) < 0.05,
          f"{au and au['codec_name']} {au and au['sample_rate']} Hz · audio {dur_a:.3f} s · video {dur_v:.3f} s")
    check(2, "first sound lands on its cue", delta is not None and -0.002 <= delta <= 0.1,
          f"cue at {cue_starts[0] if cue_starts else None:.3f} s · sound starts {onset / RATE if onset else None:.4f} s · {delta and round(delta * 1000, 1)} ms after (the wave's own lead)")
    ims = [frame(p, k, os.path.join(out, f"2-frame-{k}.png")) for k in (0, n // 2, n - 1)]
    sheet(ims, os.path.join(out, "2-mp4-frames.png"), 0.4)

# ---- 3. WebM: alpha signalled and decoded (libvpx), Opus sound, a frame over magenta to look at the edges.
if "3" in steps:
    p = steps["3"]["path"]
    info = probe(p)
    v, au = stream(info, "video"), stream(info, "audio")
    alpha_mode = (v.get("tags") or {}).get("alpha_mode") or (v.get("tags") or {}).get("ALPHA_MODE")
    mid = frames_expected // 2 if frames_expected else 0
    im = frame(p, mid, os.path.join(out, "3-webm-mid.png"), extra=("-c:v", "libvpx-vp9"))
    a = np.asarray(im)[:, :, 3]
    check(3, "VP9 with alpha, Opus sound, all frames", v["codec_name"] == "vp9" and str(alpha_mode) == "1" and au is not None and au["codec_name"] == "opus"
          and int(v["nb_read_frames"]) == frames_expected,
          f"alpha_mode {alpha_mode} · {v['width']}x{v['height']} · {v['nb_read_frames']} frames · {au and au['codec_name']} · {os.path.getsize(p) / 1e6:.1f} MB")
    check(3, "ffmpeg decodes the transparency", a[0, 0] <= 2 and (a == 0).mean() > 0.3 and (a == 255).sum() > 1000,
          f"corner {a[0, 0]} · clear {(a == 0).sum()} · faint 1-7 {((a > 0) & (a < 8)).sum()} · opaque {(a == 255).sum()} · soft {((a > 0) & (a < 255)).sum()}")
    over = Image.new("RGBA", im.size, (255, 0, 255, 255))
    over.alpha_composite(im)
    over.save(os.path.join(out, "3-webm-over-magenta.png"))
    rows, cols = np.nonzero(a > 0)
    over.crop((cols.min() - 10, rows.min() - 10, cols.max() + 10, rows.min() + 220)).save(os.path.join(out, "3-webm-head-over-magenta.png"))

# ---- 4. PNG sequence: zip integrity, numbered frames, WAV as long as the frames, README; an "editor import".
if "4" in steps:
    p = steps["4"]["path"]
    with zipfile.ZipFile(p) as z:
        bad = z.testzip()
        names = z.namelist()
        pngs = sorted(n for n in names if n.endswith(".png"))
        wavs = [n for n in names if n.endswith(".wav")]
        readme = [n for n in names if n.endswith("README.txt")]
        numbered = all(n.rsplit("frame_", 1)[-1] == f"{i:05d}.png" for i, n in enumerate(pngs))
        tmp = tempfile.mkdtemp(dir=out)
        z.extractall(tmp)
    check(4, "zip is intact: numbered PNGs, a WAV, a README", bad is None and len(pngs) == frames_expected and numbered and wavs and readme,
          f"testzip {bad} · {len(pngs)} PNGs (expected {frames_expected}), numbered {numbered} · {wavs} · {readme} · {os.path.getsize(p) / 1e6:.1f} MB")
    first = Image.open(os.path.join(tmp, pngs[len(pngs) // 2]))
    fa = np.asarray(first.convert("RGBA"))[:, :, 3]
    check(4, "frames are transparent PNGs", first.mode == "RGBA" and fa[0, 0] == 0 and (fa == 255).sum() > 1000, f"{first.mode} {first.size}")
    with wave.open(os.path.join(tmp, wavs[0])) as w:
        wav_rate, wav_n, wav_ch = w.getframerate(), w.getnframes(), w.getnchannels()
        pcm = np.frombuffer(w.readframes(wav_n), dtype=np.int16).reshape(-1, wav_ch).mean(axis=1) / 32768
    check(4, "the WAV is exactly as long as the frames", wav_n == round(len(pngs) / 60 * wav_rate),
          f"{wav_ch} ch {wav_rate} Hz {wav_n} samples · frames {len(pngs)}/60 s = {round(len(pngs) / 60 * wav_rate)} samples")
    # The editor import, done by ffmpeg: the frames as a 60 fps image sequence with the WAV laid at frame 0.
    seq = os.path.join(out, "4-editor-import.mp4")
    folder = os.path.dirname(os.path.join(tmp, pngs[0]))
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", "60", "-i", os.path.join(folder, "frame_%05d.png"), "-i", os.path.join(tmp, wavs[0]),
                    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", seq], check=True)
    si = probe(seq)
    sv, sa = stream(si, "video"), stream(si, "audio")
    check(4, "imported at 60 fps, picture and sound line up in length", abs(float(sv["duration"]) - float(sa["duration"])) < 1 / 30,
          f"video {float(sv['duration']):.3f} s · audio {float(sa['duration']):.3f} s")
    if mp4_audio is not None:
        wav48 = audio(os.path.join(tmp, wavs[0]))
        d = lag(mp4_audio, wav48)
        check(4, "the WAV's sound sits where the MP4's does", abs(d) <= 96, f"{d} samples ({d / RATE * 1000:.2f} ms)")

# ---- 6. The recording made at 2x speed: normal-speed frames.
if "6" in steps and steps["6"].get("recordAt2x"):
    p = steps["6"]["recordAt2x"]["path"]
    v = stream(probe(p), "video")
    check(6, "a recording at 2x is at normal speed (all frames)", int(v["nb_read_frames"]) == frames_expected,
          f"{v['width']}x{v['height']} · {v['nb_read_frames']} frames (expected {frames_expected})")

# ---- 7. Phone MP4.
if "7" in steps and (steps["7"].get("result") or {}).get("path"):
    p = steps["7"]["result"]["path"]
    info = probe(p)
    v = stream(info, "video")
    check(7, "phone MP4 plays: 720p, 60 fps", int(v["height"]) <= 720 and v["r_frame_rate"] == "60/1",
          f"{v['width']}x{v['height']} {v['r_frame_rate']} · {v['nb_read_frames']} frames · {os.path.getsize(p) / 1e6:.1f} MB")
    n = int(v["nb_read_frames"])
    sheet([frame(p, k, os.path.join(out, f"7-frame-{k}.png")) for k in (0, n // 2)], os.path.join(out, "7-phone-frames.png"), 0.5)

json.dump(results, open(os.path.join(out, "analysis.json"), "w", encoding="utf-8"), indent=2)
print(f"{sum(r['pass'] for r in results)} of {len(results)} pass")
