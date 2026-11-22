"""Tone-map a linear render from blender_relight_tunnel.py like Unreal does (15 Nov 2026, scene backdrops).

  python -I -X utf8 tonemap_plate.py IN.npy OUT.png --exposure EV [--bloom 0.4] [--bloom-radius 0.02] [--fit REFERENCE.png]

Unreal's default tone curve is ACES (the film-like curve that also turns saturated blues violet, which is why the
game's team-blue screens read indigo); Blender's AgX desaturates bright colour towards white instead. So the render
leaves Blender as linear light and gets: exposure, a soft bloom (Unreal's bloom: bright light spreads over its
surroundings), Narkowicz's fit of the ACES curve, and the sRGB encoding.

--fit REFERENCE.png reports the exposure that matches the reference's mean brightness (same framing assumed) and
uses it.
"""
import argparse

import numpy as np
from PIL import Image


def aces(x):
    a, b, c, d, e = 2.51, 0.03, 2.43, 0.59, 0.14
    return np.clip((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0)


def srgb(x):
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(np.maximum(x, 0), 1 / 2.4) - 0.055)


def box(x, r, axis):
    """A box blur of radius r along an axis (cumulative sums; edges clamped)."""
    pad = [(0, 0)] * x.ndim
    pad[axis] = (r + 1, r)
    c = np.cumsum(np.pad(x, pad, mode="edge"), axis=axis)
    hi = np.take(c, np.arange(2 * r + 1, c.shape[axis]), axis=axis)
    lo = np.take(c, np.arange(0, c.shape[axis] - 2 * r - 1), axis=axis)
    return (hi - lo) / (2 * r + 1)


def blur(x, r):
    for _ in range(3):  # three box passes are close to a Gaussian
        x = box(box(x, r, 0), r, 1)
    return x


def bloom(linear, amount, radius):
    if amount <= 0:
        return linear
    h = linear.shape[0]
    bright = np.maximum(linear - 1.0, 0.0)  # only light above the display's white spreads
    out = np.zeros_like(linear)
    for scale in (1, 2, 4):  # three widths, as a bloom chain does
        out += blur(bright, max(1, int(radius * h * scale / 1.7))) / scale
    return linear + amount * out


def render(linear, ev, amount, radius):
    return srgb(aces(bloom(linear * (2.0 ** ev), amount, radius)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("inp")
    ap.add_argument("out")
    ap.add_argument("--exposure", type=float, default=0.0)
    ap.add_argument("--bloom", type=float, default=0.4)
    ap.add_argument("--bloom-radius", type=float, default=0.012)
    ap.add_argument("--fit")
    a = ap.parse_args()
    linear = np.load(a.inp).astype(np.float32)
    ev = a.exposure
    if a.fit:
        ref = np.asarray(Image.open(a.fit).convert("RGB").resize((linear.shape[1], linear.shape[0]))).astype(np.float32) / 255
        target = ref.mean()
        lo, hi = -8.0, 8.0
        for _ in range(30):  # brightness rises with exposure: bisect on the mean
            mid = (lo + hi) / 2
            if render(linear, mid, a.bloom, a.bloom_radius).mean() < target:
                lo = mid
            else:
                hi = mid
        ev = (lo + hi) / 2
        print(f"fitted exposure {ev:+.2f} EV (reference mean {target:.3f})")
    image = render(linear, ev, a.bloom, a.bloom_radius)
    Image.fromarray((np.clip(image, 0, 1) * 255 + 0.5).astype(np.uint8)).save(a.out)
    print(a.out, f"exposure {ev:+.2f} EV")


if __name__ == "__main__":
    main()
