#!/usr/bin/env bash
# 27 Nov release v19: stage leaves 1-2 (hard-link reuse of v18), check, upload; stage + check + upload shard 0 with the
# leaf hosts; then verify all three hosts. Upload folders are written to the MAIN checkout's ignored scripts/generated.
set -u
export MSYS_NO_PATHCONV=1
cd "E:/Coding/the-finals-outfit/.claude/worktrees/loving-napier-b93181" || exit 9
WT='E:\Coding\the-finals-outfit\.claude\worktrees\loving-napier-b93181'
D="$WT\\scripts\\generated\\release-2026-11-27"
G=scripts/generated/release-2026-11-27
T=_docs/release-2026-11-23/tools
U='E:\Coding\the-finals-outfit\scripts\generated\release-2026-11-27\_assets-upload'
W='C:\Users\ChronoHax\AppData\Local\npm-cache\_npx\c4e09ea4da0c6ba2\node_modules\wrangler\bin\wrangler.js'
P='E:\Coding\the-finals-outfit\scripts\generated\release-2026-11-23\_assets-upload\v18-release-20261123-reconstruction-00'
SRC='E:\Coding\the-finals-outfit\public'
log() { echo "$(date +%H:%M:%S) $*" >> $G/run-release.log; }
host() { tr '\r' '\n' < "$1" | grep -ao 'https://[0-9a-f]\{8\}\.the-finals-outfit-assets\.pages\.dev' | head -1; }
stage() { # shard [hosts]
  local extra=""; [ -n "${2:-}" ] && extra="--hosts $2"
  ASSET_SOURCE_DIR="$SRC" ASSET_SHARD_OUT="$U\\v19-release-20261127-reconstruction-00$1" node $T/stage-asset-shard-reuse.mjs "$WT" "$D\\shard-plan-v1.json" $1 --gzip-meshes $extra --reuse "${P}0" --reuse "${P}1" --reuse "${P}2" > $G/stage-v1-shard-00$1.json 2> $G/stage-v1-shard-00$1.err || { log "FAIL stage $1"; exit 4; }
  ASSET_SOURCE_DIR="$SRC" node $T/verify-staged-sample.mjs "$WT" "$D\\shard-plan-v1.json" "$D\\stage-v1-shard-00$1.json" 25 "$D\\staged-sample-v1-shard-00$1.json" > $G/staged-sample-v1-shard-00$1.log 2>&1 || { log "FAIL verify staged $1"; exit 5; }
  log "staged $1 ok: $(node -e "const s=require('./$G/stage-v1-shard-00$1.json');console.log(s.linkedFromPrevious,'linked',s.encodedFresh,'fresh',s.rewrittenIndices.length,'controls')")"
}
upload() { # shard
  node "$W" pages deploy "$U\\v19-release-20261127-reconstruction-00$1" --project-name the-finals-outfit-assets --branch rel-1127-shard-00$1 --commit-dirty=true > $G/wrangler-v1-shard-00$1.log 2>&1 || { log "FAIL upload $1"; exit 6; }
  log "uploaded $1 $(host $G/wrangler-v1-shard-00$1.log) $(tr '\r' '\n' < $G/wrangler-v1-shard-00$1.log | grep -ao 'Uploaded [0-9]* files.*' | tail -1)"
}
for n in 1 2; do stage $n; upload $n; done
H1="$(host $G/wrangler-v1-shard-001.log)/"; H2="$(host $G/wrangler-v1-shard-002.log)/"
[ ${#H1} -gt 20 ] && [ ${#H2} -gt 20 ] || { log "FAIL host parse"; exit 2; }
node -e "
const fs=require('fs'),p='$G/',{createHash}=require('crypto');
const plan=JSON.parse(fs.readFileSync(p+'shard-plan-v1.json','utf8'));
const m=n=>JSON.parse(fs.readFileSync(p+'stage-v1-shard-00'+n+'.json','utf8')).manifestSha256, at=new Date().toISOString();
fs.writeFileSync(p+'hosts-leaves-v1.json', JSON.stringify({planSha256:createHash('sha256').update(JSON.stringify(plan)).digest('hex'),shards:{
 'reconstruction-001':{immutable:true,baseUrl:'$H1',manifestSha256:m(1),recordedAt:at},
 'reconstruction-002':{immutable:true,baseUrl:'$H2',manifestSha256:m(2),recordedAt:at}}},null,2)+'\n');" || { log "FAIL leaves json"; exit 3; }
stage 0 "$D\\hosts-leaves-v1.json"; upload 0
H0="$(host $G/wrangler-v1-shard-000.log)/"; [ ${#H0} -gt 20 ] || { log "FAIL host parse 0"; exit 7; }
node -e "
const fs=require('fs'),p='$G/'; const h=JSON.parse(fs.readFileSync(p+'hosts-leaves-v1.json','utf8'));
const m=JSON.parse(fs.readFileSync(p+'stage-v1-shard-000.json','utf8')).manifestSha256;
h.shards={'reconstruction-000':{immutable:true,baseUrl:'$H0',manifestSha256:m,recordedAt:new Date().toISOString()},...h.shards};
fs.writeFileSync(p+'hosts-v1.json', JSON.stringify(h,null,2)+'\n');" || { log "FAIL hosts json"; exit 8; }
log "verify hosts"; sleep 20
node scripts/validate-asset-shards.mjs "$D\\shard-plan-v1.json" "$D\\hosts-v1.json" "$D\\shard-validation-v1.json" > $G/shard-validation-v1.log 2>&1 && log "repo verifier PASS" || log "repo verifier FAIL"
node -e "const d=require('./$G/plan-diff-v1.json'); console.log([...d.added,...d.changed].join('\n'))" > $G/verify-list-v1.txt
node $T/verify-hosted-files.mjs "$WT" "$D\\shard-plan-v1.json" "$D\\hosts-v1.json" "$D\\verify-list-v1.txt" "$D\\hosted-files-v1.json" > $G/hosted-files-v1.log 2>&1 && log "hosted files PASS" || log "hosted files FAIL"
for n in 0 1 2; do b=$(node -e "console.log(require('./$G/hosts-v1.json').shards['reconstruction-00$n'].baseUrl)"); s=$(node -e "console.log(require('./$G/hosts-v1.json').shards['reconstruction-00$n'].manifestSha256)"); node $T/check-deployment.mjs "$b" "$s" > $G/check-deployment-v1-00$n.json 2>&1 && log "deployment $n PASS" || log "deployment $n FAIL"; done
node scripts/asset-shard-config.mjs "$D\\shard-plan-v1.json" "$D\\hosts-v1.json" > $G/settings-v1.json 2> $G/settings-v1.err && log "settings ok" || log "FAIL settings"
log "done"
