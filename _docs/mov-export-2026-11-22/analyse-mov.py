"""Check the MOVs mov-steps.mjs saved, with tools that share nothing with the app's code.

    python -I _docs/mov-export-2026-11-22/analyse-mov.py <outDir>

- ffprobe: the streams (qtrle 'rle ' argb 60 fps, PCM 16-bit 48 kHz stereo), frame and sample counts.
- ffmpeg decodes every frame to RGBA; Pillow decodes every PNG of the PNG-sequence export of the same emote. The
  export renders deterministically, so the two must be identical, byte for byte, alpha included.
- ffmpeg decodes the MOV's sound; Python's wave module reads the zip's WAV. Identical samples, both from frame 0,
  means the sound is exact and in sync.
- Pictures to look at: frames over magenta and over a checkerboard, full size (analysis-*.png).
Writes analysis.json beside the downloads and prints PASS/FAIL lines.
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
results = {"checks": []}


def check(name, ok, detail=""):
    results["checks"].append({"name": name, "pass": bool(ok), "detail": detail})
    print(f"{'PASS' if ok else 'FAIL'} {name}{' · ' + detail if detail else ''}")


def probe(path):
    run = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                          "stream=codec_name,codec_tag_string,pix_fmt,width,height,nb_frames,r_frame_rate,duration,"
                          "sample_rate,channels,bits_per_coded_sample:format=format_name,duration,size",
                          "-of", "json", str(path)], capture_output=True, text=True, check=True)
    return json.loads(run.stdout)


def top_level_boxes(path):
    data, at, names = Path(path).read_bytes(), 0, []
    while at + 8 <= len(data):
        size, kind = int.from_bytes(data[at:at + 4], "big"), data[at + 4:at + 8].decode("latin1")
        if size == 1:
            size = int.from_bytes(data[at + 8:at + 16], "big")
        names.append(kind)
        at += size
    return names, data[8:12].decode("latin1")


def decode_frames(path, width, height):
    run = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-map", "0:v", "-f", "rawvideo", "-pix_fmt", "rgba", "-"],
                         capture_output=True, check=False)
    frames = np.frombuffer(run.stdout, np.uint8).reshape(-1, height, width, 4)
    return frames, run.stderr.decode("utf8", "replace").strip()


def decode_sound(path):
    run = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-map", "0:a", "-f", "s16le", "-"], capture_output=True, check=False)
    return np.frombuffer(run.stdout, "<i2"), run.stderr.decode("utf8", "replace").strip()


def composite(rgba, background):
    alpha = rgba[..., 3:4].astype(np.float32) / 255
    return (rgba[..., :3].astype(np.float32) * alpha + background * (1 - alpha)).round().astype(np.uint8)


def checker(height, width, cell=16):
    yy, xx = np.mgrid[0:height, 0:width]
    tile = ((yy // cell + xx // cell) % 2).astype(np.float32)
    return np.repeat((tile * 80 + 120)[..., None], 3, axis=2)


steps = report["steps"]

# ---- Step 2: the 720p MOV against the PNG sequence of the same emote.
if "2" in steps:
    mov_path, zip_path = Path(steps["2"]["mov"]["path"]), Path(steps["2"]["png"]["path"])
    info = probe(mov_path)
    video = next(s for s in info["streams"] if s["codec_name"] == "qtrle")
    audio = next((s for s in info["streams"] if s.get("sample_rate")), None)
    boxes, brand = top_level_boxes(mov_path)
    results["mov720"] = {"probe": info, "boxes": boxes, "brand": brand}
    with zipfile.ZipFile(zip_path) as z:
        names = sorted(n for n in z.namelist() if n.endswith(".png"))
        pngs = [np.asarray(Image.open(io.BytesIO(z.read(n))).convert("RGBA")) for n in names]
        wav_name = next((n for n in z.namelist() if n.endswith(".wav")), None)
        wav = None
        if wav_name:
            with wave.open(io.BytesIO(z.read(wav_name))) as w:
                wav = {"rate": w.getframerate(), "channels": w.getnchannels(), "frames": w.getnframes(),
                       "data": np.frombuffer(w.readframes(w.getnframes()), "<i2")}
    height, width = pngs[0].shape[:2]
    check("brand and layout: 'qt  ', movie box first", brand == "qt  " and boxes == ["ftyp", "moov", "mdat"], f"{brand!r} {boxes}")
    check("video stream: qtrle 'rle ' argb, 60 fps, the PNGs' size",
          (video["codec_name"], video["codec_tag_string"], video["pix_fmt"], video["r_frame_rate"], video["width"], video["height"])
          == ("qtrle", "rle ", "argb", "60/1", width, height),
          f"{video['codec_tag_string']} {video['pix_fmt']} {video['r_frame_rate']} {video['width']}x{video['height']}")
    check("frame count = the PNG sequence's", int(video["nb_frames"]) == len(pngs), f"{video['nb_frames']} vs {len(pngs)} PNGs")
    frames, errors = decode_frames(mov_path, width, height)
    check("ffmpeg decodes every frame without an error", len(frames) == len(pngs) and not errors, f"{len(frames)} frames · {errors[:200] or 'no errors'}")
    differing, worst = [], 0
    for i, (a, b) in enumerate(zip(frames, pngs)):
        if not np.array_equal(a, b):
            differing.append(i)
            worst = max(worst, int(np.abs(a.astype(int) - b.astype(int)).max()))
    check("every decoded frame equals its PNG, byte for byte (alpha included)", not differing and len(frames) == len(pngs),
          f"{len(differing)} of {len(pngs)} frames differ, largest difference {worst}")
    middle = frames[len(frames) // 2]
    alpha = middle[..., 3]
    histogram = {"clear": int((alpha == 0).sum()), "solid": int((alpha == 255).sum()), "soft": int(((alpha > 0) & (alpha < 255)).sum()), "pixels": int(alpha.size)}
    results["alpha_middle"] = histogram
    check("the alpha survives: a clear background, a solid character, soft edges", histogram["clear"] > 0.3 * alpha.size and histogram["solid"] > 1000
          and histogram["soft"] > 100 and int(alpha[0, 0]) == 0, json.dumps(histogram))
    for tag, index in (("first", 0), ("middle", len(frames) // 2), ("last", len(frames) - 1)):
        Image.fromarray(composite(frames[index], np.array([255, 0, 255], np.float32))).save(out / f"analysis-720-{tag}-magenta.png")
    Image.fromarray(composite(middle, checker(height, width))).save(out / "analysis-720-middle-checker.png")
    if audio and wav:
        sound, sound_errors = decode_sound(mov_path)
        check("sound stream: PCM 16-bit 48 kHz, the WAV's channels", (audio["codec_name"], audio["sample_rate"], audio["channels"])
              == ("pcm_s16le", "48000", wav["channels"]), f"{audio['codec_name']} {audio['sample_rate']} Hz × {audio['channels']}")
        same = sound.shape == wav["data"].shape and np.array_equal(sound, wav["data"])
        detail = f"{sound.size // wav['channels']} vs {wav['frames']} frames"
        if not same and sound.size and wav["data"].size:
            n = min(sound.size, wav["data"].size)
            detail += f", largest difference {int(np.abs(sound[:n].astype(int) - wav['data'][:n].astype(int)).max())}"
        check("the MOV's sound equals the WAV, sample for sample, from frame 0 (in sync)", same and not sound_errors, detail)
        video_s, audio_s = len(frames) / 60, wav["frames"] / wav["rate"]
        check("picture and sound are the same length", abs(video_s - audio_s) < 0.5 / 60, f"{video_s:.4f} s vs {audio_s:.4f} s")
        results["sound"] = {"frames": int(wav["frames"]), "peak": int(np.abs(wav["data"]).max())}
    else:
        check("sound present in both", False, f"mov audio {bool(audio)} · wav {bool(wav)}")
    size = mov_path.stat().st_size
    results["size720"] = {"bytes": size, "seconds": len(frames) / 60, "mb_per_s": size / 1e6 / (len(frames) / 60),
                          "zip_bytes": zip_path.stat().st_size}

# ---- Step 3: the 1080p MOV: decodes, its size per second (the figure the panel quotes).
if "3" in steps:
    mov_path = Path(steps["3"]["mov"]["path"])
    info = probe(mov_path)
    video = next(s for s in info["streams"] if s["codec_name"] == "qtrle")
    frames, errors = decode_frames(mov_path, video["width"], video["height"])
    check("1080p: qtrle argb, every frame decodes", video["pix_fmt"] == "argb" and len(frames) == int(video["nb_frames"]) and not errors,
          f"{video['width']}x{video['height']} {len(frames)} frames · {errors[:200] or 'no errors'}")
    Image.fromarray(composite(frames[len(frames) // 2], checker(video["height"], video["width"]))).save(out / "analysis-1080-middle-checker.png")
    size = mov_path.stat().st_size
    seconds = len(frames) / 60
    results["size1080"] = {"bytes": size, "seconds": seconds, "mb_per_s": size / 1e6 / seconds, "width": video["width"], "height": video["height"]}
    print(f"1080p: {size / 1e6:.1f} MB for {seconds:.3f} s = {size / 1e6 / seconds:.1f} MB/s")

(out / "analysis.json").write_text(json.dumps(results, indent=2, default=str), encoding="utf-8")
passed = sum(c["pass"] for c in results["checks"])
print(f"{passed} of {len(results['checks'])} checks pass")
