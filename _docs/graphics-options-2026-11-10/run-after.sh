#!/usr/bin/env bash
# Git Bash, worktree root. After-change measurements (10 Nov). "old" reproduces the shipped High on the new code
# (opaque history 1/16, no depth reset); "new" is the default; the others isolate each change.
set -u
P=_docs/graphics-options-2026-11-10/probe-decal-ghost.mjs
OLD="quality=high&rpOpaque=0.0625&rpOpaqueFast=0.0625&rpReset=0"
Q="screenlocked=quality=balanced,old=$OLD,new=quality=high,o8=quality=high&rpOpaque=0.125&rpOpaqueFast=0.333,noreset=quality=high&rpReset=0"
PROBE_LABEL=after-idle node $P "$Q"
PROBE_LABEL=after-clap PROBE_CLIP=clap node $P "screenlocked=quality=balanced,old=$OLD,new=quality=high,o8=quality=high&rpOpaque=0.125&rpOpaqueFast=0.333,noreset=quality=high&rpReset=0" 20,40,60,80,100,120,140
PROBE_LABEL=after-boxing PROBE_CLIP=shadow-boxing node $P "screenlocked=quality=balanced,old=$OLD,new=quality=high,o8=quality=high&rpOpaque=0.125&rpOpaqueFast=0.333,noreset=quality=high&rpReset=0" 20,40,60,80,100,120,140
PROBE_LABEL=hold node _docs/graphics-options-2026-11-10/probe-hold-flicker.mjs "old=$OLD,new=quality=high,o8=quality=high&rpOpaque=0.125&rpOpaqueFast=0.333"
