#!/usr/bin/env bash
# s12-c1 batch v1 (Git Bash, repo root; 26 Nov 2026). Prepared by the S12 tier-2 session, run by the main-folder
# session: the 52 C1 material items (six batch C meshes) through source, build, gpu and index on map v1, with the
# 52 materials bound to those meshes rebuilt
# and rebound (batch-attached.json rebindKeptMaterials).
#   bash _docs/s12-refresh-tier2-2026-11-22/c1-run/run-v1.sh [source|build|gpu|index]
# The argument restarts at that stage (default source; only a source start checks the three folders are new).
# Stages and environment are _docs/goal-100-2026-10-11/w82-sweep/run-batch.sh's; the probe build and its flags are
# w177 v3's (the last material batch on map v1). Two w177 lessons are built in (APPLY-STATUS, 25 Nov): before the gpu
# stage it waits for 5174 and loads the app once headless (warm-5174.mjs), and it retries only a page.goto timeout, at
# most 3 attempts 5 minutes apart. Writes only the three new folders below and this folder's logs; never the active
# index. Needs the root app on 5174 (serve-5174) for the gpu stage.
set -u
cd /e/Coding/the-finals-outfit
B=_docs/s12-refresh-tier2-2026-11-22/c1-run
G=scripts/generated/shader-probe; M=public/models
W=$G/s12-c1-v1; R=$M/reconstructed-s12-c1-v1; P=$M/reconstructed-s12-c1-preview-v1
PY=/c/ProgramData/anaconda3/python.exe
FROM=${1:-source}
case $FROM in source|build|gpu|index) ;; *) echo "usage: run-v1.sh [source|build|gpu|index]"; exit 2;; esac
test -f $B/batch-attached.json || { echo "no $B/batch-attached.json: run prepare-cohort.mjs first"; exit 2; }
if [ $FROM = source ]; then
  for p in $W $R $P; do test ! -e $p || { echo "preserve $p"; exit 2; }; done
fi
unset PREPATCH_SOURCE_CACHE
export SHADER_PROBE_VERTEX=1 SHADER_PROBE_LOCAL_VF=1 SHADER_PROBE_DLL=$G/probe-bin-localvf-v1/ShaderProbe.dll
export SOURCE_USMAP=$G/tools/5.7.4-1432394+discovery_12.03.x-Discovery-w177patch-v1.usmap APP_URL=http://127.0.0.1:5174
export PATH="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell:$PATH"

stage() {  # stage name, log suffix
  MSYS_NO_PATHCONV=1 $PY -X utf8 scripts/shader-probe/prepare-attached-batch.py $1 --batch $B/batch-attached.json \
    --work $W --runtime $R --preview $P > $B/batch-attached-$1$2.out 2>&1
}

gpu() {
  # curl runs without MSYS_NO_PATHCONV: with it, curl.exe gets /dev/null literally and never succeeds (w177, 25 Nov).
  local up=0 rc=1 log
  for i in $(seq 120); do curl -s -m 10 -o /dev/null $APP_URL/ && { up=1; break; }; sleep 5; done
  [ $up = 1 ] || { echo "gpu: $APP_URL did not answer for 10 minutes; start serve-5174, then: bash $B/run-v1.sh gpu"; return 3; }
  for attempt in 1 2 3; do
    timeout 1000 node $B/warm-5174.mjs > $B/warm-5174.attempt$attempt.out 2>&1
    stage gpu .attempt$attempt; rc=$?
    cp $B/batch-attached-gpu.attempt$attempt.out $B/batch-attached-gpu.out
    echo "gpu attempt $attempt exit $rc: $(tail -1 $B/batch-attached-gpu.out | cut -c1-240)"
    [ $rc -eq 0 ] && return 0
    log=$(ls -t $W/validation/webgl-runs/*.log 2>/dev/null | head -1)
    grep -q "page.goto: Timeout" "$log" 2>/dev/null || { echo "gpu: not a load timeout; see $log"; return $rc; }
    [ $attempt -lt 3 ] && sleep 300
  done
  return $rc
}

run=0
for s in source build gpu index; do
  [ $s = $FROM ] && run=1
  [ $run = 1 ] || continue
  if [ $s = gpu ]; then gpu || exit $?; continue; fi
  stage $s ''; rc=$?
  echo "$s exit $rc: $(tail -1 $B/batch-attached-$s.out | cut -c1-260)"
  [ $rc -eq 0 ] || exit $rc
done
echo "s12-c1 v1 done: see $P/preview.json (reboundMaterials) and $W/cohort-report.json"
