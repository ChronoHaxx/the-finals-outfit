"""Check range-steps.mjs's recordings with tools that share no code with the app.

    python -I _docs/video-range-2026-11-22/analyse-range.py <outDir>

A = the whole emote, B = its range 0.40-2.00 s, C = that range twice at half speed (PNG sequences, with WAVs);
D = B as a MOV. Pillow reads the PNGs, Python's wave module the WAVs, ffmpeg the MOV.
- Frame counts: A 261, B 97, C 385 (framePlan's: 0.4-2.0 s is 1.6 s, 96 frames plus the end pose; twice at 0.5x is
  6.4 s, 384 plus the end pose).
- Sound timing: B's sound is A's from 0.40 s on, sample for sample (the cue lands 0.40 s earlier); C's lands at twice
  that offset in each pass (half speed), 3.2 s apart.
- Determinism: D's frames equal B's PNGs and its sound equals B's WAV, byte for byte; C's first frame equals B's (both
  settle at 0.40 s from rest).
- Pictures to look at: A's frame at 0.40 s beside B's first, and C's second pass start (analysis-*.png).
"""
import io
import json
import subprocess
import sys
import wave
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image

out = Path(sys.argv[1])
report = json.loads((out / "report.json").read_text(encoding="utf-8"))
steps = report["steps"]["3"]
results = {"checks": []}


def check(name, ok, detail=""):
    results["checks"].append({"name": name, "pass": bool(ok), "detail": detail})
    print(f"{'PASS' if ok else 'FAIL'} {name}{' · ' + detail if detail else ''}")


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


A, a_sound, _ = read_zip(steps["whole"]["path"])
B, b_sound, b_readme = read_zip(steps["range"]["path"])
C, c_sound, c_readme = read_zip(steps["slowLoops"]["path"])
check("frame counts: whole 261, range 97, twice at half speed 385", (len(A), len(B), len(C)) == (261, 97, 385), f"{len(A)}, {len(B)}, {len(C)}")
check("the zips' README says what was recorded", "clip 0.400 s to 2.000 s" in b_readme and "2 times at 0.5x speed" in c_readme,
      " | ".join(l for l in (b_readme + c_readme).splitlines() if l.startswith("Recorded")))

# Sound.
rate, cut = 48000, int(round(0.4 * 48000))
a_on, b_on = onset(a_sound), onset(b_sound)
results["onsets"] = {"whole": a_on, "range": b_on}
check("the range's sound lands 0.40 s earlier than the whole emote's", a_on is not None and b_on == a_on - cut, f"whole {a_on}, range {b_on} (expected {a_on - cut if a_on else None})")
check("the range's sound is the WAV lengths' worth of frames", b_sound.shape[0] == round(97 / 60 * rate) and c_sound.shape[0] == round(385 / 60 * rate),
      f"{b_sound.shape[0]}, {c_sound.shape[0]} samples")
segment = a_sound[cut:cut + b_sound.shape[0]]
# Up to 1.55 s in (clip 1.95 s): a window cue still sounding at the range's end is stopped there, with a fade.
n = min(len(segment), len(b_sound), int(round(1.55 * rate)))
diff = int(np.abs(segment[:n].astype(int) - b_sound[:n].astype(int)).max())
# Shifted a sample either way it must be far worse: the alignment is exact, not merely close.
shifted = min(int(np.abs(segment[1:n, 0].astype(int) - b_sound[:n - 1, 0].astype(int)).max()),
              int(np.abs(segment[:n - 1, 0].astype(int) - b_sound[1:n, 0].astype(int)).max()))
results["range_vs_whole_sound_max_diff"] = {"aligned": diff, "one_sample_off": shifted}
# The cue starts between samples, and the start time is computed differently in the two renders (0.5286 s, and
# 0.5286 - 0.4 s), so Web Audio's sub-sample resampling rounds a few samples differently: a few units in 32,767
# (below -60 dB), not a timing error.
check("the range's sound is the whole emote's from 0.40 s on, aligned to the sample (rounding only)", diff <= 32 and shifted > 100 * max(1, diff),
      f"largest difference {diff} of 32767 aligned; {shifted} a sample off")
pass_samples = int(round(3.2 * rate))
c_on1, c_on2 = onset(c_sound), onset(c_sound, pass_samples)
expect1 = (a_on - cut) * 2 if a_on is not None else None
results["slow_onsets"] = [c_on1, c_on2, expect1]
check("at half speed the sound lands at twice the offset, again 3.2 s later in the second pass",
      expect1 is not None and abs(c_on1 - expect1) <= 2 and abs(c_on2 - (expect1 + pass_samples)) <= 2, f"{c_on1}, {c_on2} (expected {expect1}, {expect1 + pass_samples if expect1 else None})")

# Pictures.
check("twice at half speed starts on the same frame as the range (both settle at 0.40 s)", np.array_equal(C[0], B[0]), "")
def closest(img, candidates):
    return min(candidates, key=lambda j: float(np.abs(img.astype(int) - B[j].astype(int)).mean()))


# The second half-speed pass starts at frame 192 (1.6 s of clip at 0.5x is 192 frames): it must show the range's start,
# not its end (a float32 frame time once made it show the end, 22 Nov 2026).
seam = {i: closest(C[i], [0, 1, 95, 96]) for i in (190, 191, 192, 193, 194)}
results["seam_closest_range_frames"] = seam
check("the second pass starts on the range's first frame", seam[192] == 0 and seam[190] == 95 and seam[194] == 1, json.dumps(seam))
mad = float(np.abs(A[24].astype(int) - B[0].astype(int)).mean())
results["whole_at_0.4_vs_range_first_mad"] = mad
grey = np.full(A[0].shape[:2] + (3,), 96, np.float32)


def over(rgba):
    alpha = rgba[..., 3:4].astype(np.float32) / 255
    return (rgba[..., :3] * alpha + grey * (1 - alpha)).round().astype(np.uint8)


Image.fromarray(np.concatenate([over(A[24]), over(B[0]), over(C[192])], axis=1)).save(out / "analysis-whole24-range0-slow192.png")
Image.fromarray(np.concatenate([over(B[48]), over(C[96]), over(B[96])], axis=1)).save(out / "analysis-range48-slow96-rangeEnd.png")
print(f"whole frame 24 vs range frame 0: mean abs difference {mad:.3f} (sway settles from rest in the range)")

# The MOV of the range: the same frames and sound as B.
mov = Path(steps["mov"]["path"])
height, width = B[0].shape[:2]
run = subprocess.run(["ffmpeg", "-v", "error", "-i", str(mov), "-map", "0:v", "-f", "rawvideo", "-pix_fmt", "rgba", "-"], capture_output=True)
frames = np.frombuffer(run.stdout, np.uint8).reshape(-1, height, width, 4)
same = len(frames) == len(B) and all(np.array_equal(f, b) for f, b in zip(frames, B))
check("the MOV of the range decodes to the range's PNGs, byte for byte", same and not run.stderr, f"{len(frames)} frames · {run.stderr.decode()[:120] or 'no errors'}")
pcm = np.frombuffer(subprocess.run(["ffmpeg", "-v", "error", "-i", str(mov), "-map", "0:a", "-f", "s16le", "-"], capture_output=True).stdout, "<i2").reshape(-1, 2)
check("the MOV's sound equals the range's WAV", pcm.shape == b_sound.shape and np.array_equal(pcm, b_sound), f"{pcm.shape} vs {b_sound.shape}")

(out / "analysis.json").write_text(json.dumps(results, indent=2, default=str), encoding="utf-8")
print(f"{sum(c['pass'] for c in results['checks'])} of {len(results['checks'])} checks pass")
