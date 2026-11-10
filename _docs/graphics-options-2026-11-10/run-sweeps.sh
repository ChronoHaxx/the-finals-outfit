#!/usr/bin/env bash
# Git Bash, worktree root. Before-change measurements (10 Nov): history-length sweep on the idle, and arm-over-print emotes.
set -u
P=_docs/graphics-options-2026-11-10/probe-decal-ghost.mjs
PROBE_LABEL=sweep-idle node $P "balanced=quality=balanced,high=quality=high,high-b8=quality=high&rpBlend=0.125,high-b4=quality=high&rpBlend=0.25,high-b1=quality=high&rpBlend=1,high-bilinear=quality=high&rpCubic=0"
PROBE_LABEL=clap PROBE_CLIP=clap node $P "balanced=quality=balanced,high=quality=high" 20,40,60,80,100,120,140
PROBE_LABEL=boxing PROBE_CLIP=shadow-boxing node $P "balanced=quality=balanced,high=quality=high" 20,40,60,80,100,120,140
