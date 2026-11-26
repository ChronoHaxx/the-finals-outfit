#!/usr/bin/env bash
# w177 batch v4 (Git Bash, repo root; 25 Nov 2026): v3 again with the manifest provenance fix (hologramProgram.rawSha256 =
# the wrapper the build admitted: ab1af562 on 17 Nov, qualifiedRawSha256 beside it). v3 (23 Nov) had: the 17 Nov View layout
# C838D617: View samplers admitted, View lane gate, the requalified panning raw pin), on the adopted hand-patched
# 17 Nov mapping (w82-sweep/run-batch.sh exports SOURCE_USMAP = ...-w177patch-v1.usmap, f36b7c4f) with the usmap window
# guard in the source stage (APPLY-STATUS step 3e). Copy of run-v3.sh with v4 folders; batch-attached-v4.json is a
# byte copy of batch-attached.json so this run's *.out logs do not overwrite v1-v3's. Needs serve-5174 warm (load the app once headless first).
cd /e/Coding/the-finals-outfit
B=_docs/goal-100-2026-10-11/w177-panning-contract
G=scripts/generated/shader-probe; M=public/models
export SHADER_PROBE_VERTEX=1 SHADER_PROBE_LOCAL_VF=1 SHADER_PROBE_DLL=$G/probe-bin-localvf-v1/ShaderProbe.dll
for p in $G/w177-panning-v4 $M/reconstructed-w177-panning-v4 $M/reconstructed-w177-panning-preview-v4; do test ! -e $p || { echo "preserve $p"; exit 2; }; done
bash _docs/goal-100-2026-10-11/w82-sweep/run-batch.sh $B $G/w177-panning-v4 $M/reconstructed-w177-panning-v4 $M/reconstructed-w177-panning-preview-v4 batch-attached-v4.json > $B/run-v4.out 2>&1; echo "w177 v4 exit $?"
