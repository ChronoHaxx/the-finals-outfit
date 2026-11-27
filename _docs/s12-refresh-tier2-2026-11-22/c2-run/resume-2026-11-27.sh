#!/usr/bin/env bash
# C2 resume (27 Nov 2026, main-folder session): run-v1.sh from the build stage (build -> gpu -> index). serve-5174 is
# started only once the build stage has passed (the gpu stage waits up to 10 minutes for it) and its whole process
# tree is killed as soon as the run ends, so the PC carries one heavy job and no idle server.
set -u
cd /e/Coding/the-finals-outfit
C=_docs/s12-refresh-tier2-2026-11-22/c2-run; OUT=$C/run-v1-resume.out
( bash $C/run-v1.sh build > $OUT 2>&1; echo "c2 v1 resume exit $?" >> $OUT ) &
RUN=$!
while kill -0 $RUN 2>/dev/null; do grep -q "^build exit" $OUT && break; sleep 5; done
S=
if grep -q "^build exit 0" $OUT; then
  node _docs/claude-autonomous-2026-09-25/serve-5174.mjs > $C/serve-5174-resume.log 2>&1 &
  S=$!; echo "serve-5174 started $(date -u +%H:%M:%S)" >> $C/resume-2026-11-27.log
fi
wait $RUN
if [ -n "$S" ]; then
  W=$(cat /proc/$S/winpid 2>/dev/null); [ -n "$W" ] && taskkill //PID $W //T //F >> $C/resume-2026-11-27.log 2>&1
  kill $S 2>/dev/null; echo "serve-5174 stopped $(date -u +%H:%M:%S)" >> $C/resume-2026-11-27.log
fi
tail -6 $OUT
