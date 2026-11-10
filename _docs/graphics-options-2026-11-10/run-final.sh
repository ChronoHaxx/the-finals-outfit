#!/usr/bin/env bash
# Git Bash, worktree root. Final measurements on the shipped defaults (10 Nov): print probes, held-pose flicker, the
# hair ground-truth rig (old vs new High at 1x), and the frame cost of each anti-aliasing mode.
set -u
D=_docs/graphics-options-2026-11-10
OLD="quality=high&rpOpaque=0.0625&rpOpaqueFast=0.0625&rpReset=0"
Q="screenlocked=quality=balanced,old=$OLD,new=quality=high,msaa=aa=msaa,off=aa=off"
PROBE_LABEL=final-idle node $D/probe-decal-ghost.mjs "$Q"
PROBE_LABEL=final-clap PROBE_CLIP=clap node $D/probe-decal-ghost.mjs "$Q" 20,40,60,80,100,120,140
PROBE_LABEL=final-hold node $D/probe-hold-flicker.mjs "old=$OLD,new=quality=high"
TEMPORAL_BASE=http://127.0.0.1:5182 TRUTH_OUT=scripts/generated/decal-ghost/truth-hair node scripts/anim-export/probe-truth.mjs outfit-idle "old=high&rpOpaque=0.0625&rpOpaqueFast=0.0625&rpReset=0,new=high"
TEMPORAL_BASE=http://127.0.0.1:5182 TRUTH_OUT=scripts/generated/decal-ghost/truth-hair node scripts/anim-export/probe-truth.mjs disco "old=high&rpOpaque=0.0625&rpOpaqueFast=0.0625&rpReset=0,new=high"
