"""Check takes-steps.mjs's renders with tools that share no code with the app.

    python -I _docs/video-takes-2026-11-22/analyse-takes.py <outDir>

Reads the takes as stored in IndexedDB (takes-after-*.json: records, chunks with their samples as numbers), the renders
(PNG zips with WAVs, a MOV) with Pillow, Python's wave module and ffmpeg, and checks:
- frame counts: a take of d seconds (its last sample) renders floor(60 d) + 1 frames;
- determinism: the MOV render's sound equals the PNG render's byte for byte, and its frames too but for GPU rounding
  (one level in a pixel or two of a few frames);
- the camera moved (frame 0 against a frame after the first orbit) and the lights changed at the recorded change;
- the clap lands where the samples put it: the emote's first audible sample (take time `at`, clip time `from`) plus
  the clap's onset in the emote (0.6905 s: the whole emote's WAV onset in the range run, 33,145 samples);
- a take recorded with the CPU slowed 20 times: while the camera moved the live view drew under 30 frames a second, so
  a 60 fps screen recording would have repeated frames; the render repeats none;
- the interrupted take renders all it saved.
Writes analysis.json and pictures to look at (analysis-*.png).
"""
import io
import json
import math
import subprocess
import sys
import wave
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image

out = Path(sys.argv[1])
report = json.loads((out / "report.json").read_text(encoding="utf-8"))
results = {"checks": []}
CLAP_ONSET = 33145 / 48000  # seconds into Applause Pause where its first cue crosses the onset threshold
FPS = 60


def check(name, ok, detail=""):
    results["checks"].append({"name": name, "pass": bool(ok), "detail": detail})
    print(f"{'PASS' if ok else 'FAIL'} {name}{' · ' + detail if detail else ''}")


def decode(numbers, clips):
    samples, i = [], 0
    while i + 15 <= len(numbers):
        n = int(numbers[i + 14])
        actions = []
        for k in range(n):
            j = i + 15 + 5 * k
            flags = int(numbers[j + 4])
            actions.append({"clip": clips[int(numbers[j])], "time": numbers[j + 1], "weight": numbers[j + 2], "rate": numbers[j + 3],
                            "loop": bool(flags & 1), "front": bool(flags & 2)})
        flags = int(numbers[i + 13])
        samples.append({"t": numbers[i], "position": numbers[i + 1:i + 4], "target": numbers[i + 9:i + 12], "yaw": numbers[i + 12],
                        "audible": bool(flags & 4), "actions": actions})
        i += 15 + 5 * n
    return samples


def take(dump, name):
    data = json.loads((out / dump).read_text(encoding="utf-8"))
    record = next(t for t in data["takes"] if t["name"] == name)
    chunks = sorted((c for c in data["chunks"] if c["take"] == record["id"]), key=lambda c: c["index"])
    samples = [s for c in chunks for s in decode(c["samples"], record["clips"])]
    events = [e for c in chunks for e in c["events"]]
    return record, samples, events


def read_zip(path):
    with zipfile.ZipFile(path) as z:
        names = sorted(n for n in z.namelist() if n.endswith(".png"))
        frames = [np.asarray(Image.open(io.BytesIO(z.read(n))).convert("RGBA")) for n in names]
        wav_name = next((n for n in z.namelist() if n.endswith(".wav")), None)
        sound = None
        if wav_name:
            with wave.open(io.BytesIO(z.read(wav_name))) as w:
                sound = np.frombuffer(w.readframes(w.getnframes()), "<i2").reshape(-1, w.getnchannels())
        readme = next((z.read(n).decode() for n in z.namelist() if n.endswith("README.txt")), "")
    return frames, sound, readme


def onset(sound, start=0, threshold=0.02):
    level = np.abs(sound[start:, 0].astype(np.float64)) / 32768
    hits = np.nonzero(level > threshold)[0]
    return int(hits[0]) + start if hits.size else None


def expected_frames(samples):
    return math.floor(samples[-1]["t"] * FPS + 1e-6) + 1


grey = None


def over(rgba):
    global grey
    if grey is None or grey.shape[:2] != rgba.shape[:2]:
        grey = np.full(rgba.shape[:2] + (3,), 96, np.float32)
    alpha = rgba[..., 3:4].astype(np.float32) / 255
    return (rgba[..., :3] * alpha + grey * (1 - alpha)).round().astype(np.uint8)


# ---- Take 1: the PNG render and the MOV render.
steps = report["steps"]
record1, samples1, events1 = take("takes-after-1.json", "Take 1")
A, a_sound, a_readme = read_zip(steps["2"]["png"]["path"])
check("Take 1 renders a frame every 1/60 s of what was recorded", len(A) == expected_frames(samples1),
      f"{len(A)} frames for {samples1[-1]['t']:.3f} s recorded in {len(samples1)} samples ({len(samples1) / samples1[-1]['t']:.1f} a second live)")
check("its README calls it a take", "a take" in a_readme, a_readme.splitlines()[0] if a_readme else "")

mov = Path(steps["2"]["mov"]["path"])
height, width = A[0].shape[:2]
run = subprocess.run(["ffmpeg", "-v", "error", "-i", str(mov), "-map", "0:v", "-f", "rawvideo", "-pix_fmt", "rgba", "-"], capture_output=True)
m_frames = np.frombuffer(run.stdout, np.uint8).reshape(-1, height, width, 4)
# Two renders of one take on the GPU agree to the byte except for rounding: on 23 Nov three PNG renders of one take
# disagreed pairwise on 80-94 of 3,137 frames, each time one pixel by one level, in no order (no render was the odd one
# out), so the app's inputs are the same and the GPU's float rounding is not. Anything more than that is a real
# difference (a frame from the wrong time, a missed lighting change, a sway that started elsewhere).
pairs = list(zip(m_frames, A))
spots = [int((f != a).any(axis=2).sum()) for f, a in pairs]
worst = max((int(np.abs(f.astype(int) - a.astype(int)).max()) for f, a in pairs), default=0)
differing = sum(1 for s in spots if s)
same = len(m_frames) == len(A) and worst <= 1 and max(spots, default=0) <= 2
check("rendered twice (MOV, then PNG), the take gives the same frames (byte for byte, but for GPU rounding: one level, a pixel or two)",
      same and not run.stderr, f"{len(m_frames)} frames; {differing} differ, by at most {worst} level in at most {max(spots, default=0)} pixels · "
      f"{run.stderr.decode()[:120] or 'no errors'}")
pcm = np.frombuffer(subprocess.run(["ffmpeg", "-v", "error", "-i", str(mov), "-map", "0:a", "-f", "s16le", "-"], capture_output=True).stdout, "<i2").reshape(-1, 2)
check("and the same sound", a_sound is not None and pcm.shape == a_sound.shape and np.array_equal(pcm, a_sound), f"{pcm.shape} vs {None if a_sound is None else a_sound.shape}")

# The camera moved: the silhouette at frame 0 against 1.2 s in (the first orbit).
mask = lambda f: f[..., 3] > 127
k = min(len(A) - 1, 72)
iou = float((mask(A[0]) & mask(A[k])).sum() / max(1, (mask(A[0]) | mask(A[k])).sum()))
check("the camera's orbit is in the video (the silhouette changes)", iou < 0.9, f"IoU of frame 0 and frame {k}: {iou:.3f}")

# The lights changed where the take changed them.
results["look_events"] = [e["t"] for e in events1]
lum = np.array([float((f[..., :3].astype(np.float64) * (f[..., 3:4] / 255)).mean()) for f in A])
if len(events1) >= 2:
    L = math.ceil(events1[1]["t"] * FPS - 1e-9)
    jump = abs(lum[L] - lum[L - 1]) if 0 < L < len(lum) else 0
    typical = float(np.median(np.abs(np.diff(lum))))
    check("the lighting change lands on its frame", jump > 8 * max(typical, 1e-3), f"frame {L} ({events1[1]['t']:.3f} s): brightness jumps {jump:.2f}, a frame usually {typical:.3f}")
    Image.fromarray(np.concatenate([over(A[L - 1]), over(A[L])], axis=1)).save(out / "analysis-look-change.png")
else:
    check("the lighting change lands on its frame", False, f"{len(events1)} look events")

# The clap: where the samples put it.
first = next((s for s in samples1 if s["audible"] and any(a["front"] and a["rate"] > 0 for a in s["actions"])), None)
if first and a_sound is not None:
    a = next(a for a in first["actions"] if a["front"])
    expected = first["t"] + (CLAP_ONSET - a["time"]) / a["rate"]
    got = onset(a_sound)
    got_s = None if got is None else got / 48000
    results["clap"] = {"at": first["t"], "from": a["time"], "expected": expected, "onset": got_s}
    check("the clap sounds where the samples put it (to the millisecond)", got_s is not None and abs(got_s - expected) < 0.002,
          f"emote audible from take {first['t']:.4f} s at clip {a['time']:.4f} s: clap expected {expected:.4f} s, heard {got_s}")
else:
    check("the clap sounds where the samples put it (to the millisecond)", False, "no audible emote sample, or no WAV")

Image.fromarray(np.concatenate([over(A[0]), over(A[k]), over(A[len(A) // 2]), over(A[-1])], axis=1)).save(out / "analysis-take1-frames.png")

# ---- Take 2: recorded with the CPU slowed 20 times.
record2, samples2, _ = take("takes-after-3.json", "Take 2")
B, _, _ = read_zip(steps["3"]["slow"]["path"])
times = np.array([s["t"] for s in samples2])
positions = np.array([s["position"] for s in samples2])
frame_times = np.arange(len(B)) / FPS
# The camera at each output frame, as the samples have it (linear between them, as the render places it).
camera = np.stack([np.interp(frame_times, times, positions[:, k]) for k in range(3)], axis=1)
moving = np.linalg.norm(np.diff(camera, axis=0), axis=1) > 1e-5  # frame pairs across which the camera moved
# The live frame rate while the camera moved (the CPU slowed), from the samples' own times.
orbit_span = (times >= frame_times[:-1][moving].min() - 1e-9) & (times <= frame_times[1:][moving].max() + 1e-9) if moving.any() else times < 0
live_rate = (orbit_span.sum() - 1) / max(1e-9, times[orbit_span].max() - times[orbit_span].min()) if orbit_span.sum() > 1 else 0
# What a screen recording at 60 fps would have shown: each frame the latest live frame drawn by then.
shown = np.searchsorted(times, frame_times, side="right") - 1
repeats = int(((np.diff(shown) == 0) & moving).sum())
render_repeats = int(sum(np.array_equal(B[i], B[i + 1]) for i in np.nonzero(moving)[0]))
xor = np.array([int((mask(B[i]) ^ mask(B[i + 1])).sum()) for i in range(len(B) - 1)])
steady = xor[moving & (xor > 0)]
spread = float(np.percentile(steady, 90) / max(1, np.percentile(steady, 10))) if steady.size else float("inf")
results["slow"] = {"live_rate_while_orbiting": live_rate, "moving_pairs": int(moving.sum()), "screen_recording_repeats": repeats,
                   "render_repeats": render_repeats, "frames": len(B), "silhouette_change_p90_over_p10": spread}
check("the slowed take: the live view drew few frames, the render repeats none while the camera moves",
      live_rate < 30 and moving.sum() > 60 and render_repeats == 0 and len(B) == expected_frames(samples2),
      f"live {live_rate:.1f} frames a second while orbiting; of {int(moving.sum())} frame steps with the camera moving, a 60 fps screen recording "
      f"would repeat {repeats}, the render {render_repeats}")
Image.fromarray(np.concatenate([over(B[i]) for i in np.linspace(0, len(B) - 1, 4).astype(int)], axis=1)).save(out / "analysis-slow-frames.png")
np.savetxt(out / "analysis-slow-silhouette-change.txt", xor, fmt="%d")

# ---- Take 3: interrupted by a crashed tab, rendered from what was saved.
if "4" in steps:
    record3, samples3, _ = take("takes-after-4.json", "Take 3")
    C, _, _ = read_zip(steps["4"]["crashRender"]["path"])
    check("the interrupted take renders every frame it saved", len(C) == expected_frames(samples3) and record3["status"] == "recording",
          f"{len(C)} frames for {samples3[-1]['t']:.3f} s saved (record status {record3['status']})")
else:
    check("the interrupted take renders every frame it saved", False, "step 4 did not run")

(out / "analysis.json").write_text(json.dumps(results, indent=2, default=str), encoding="utf-8")
print(f"{sum(c['pass'] for c in results['checks'])} of {len(results['checks'])} checks pass")
