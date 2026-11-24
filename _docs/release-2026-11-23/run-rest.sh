#!/usr/bin/env bash
# 24 Nov: upload shard 2, stage + check + upload shard 0 with the leaf hosts, then verify all three hosts.
set -u
export MSYS_NO_PATHCONV=1
cd "E:/Coding/the-finals-outfit/.claude/worktrees/loving-napier-b93181" || exit 9
WT='E:\Coding\the-finals-outfit\.claude\worktrees\loving-napier-b93181'
D="$WT\\scripts\\generated\\release-2026-11-23"
G=scripts/generated/release-2026-11-23
T=_docs/release-2026-11-23/tools
W='C:\Users\ChronoHax\AppData\Local\npm-cache\_npx\c4e09ea4da0c6ba2\node_modules\wrangler\bin\wrangler.js'
P='E:\Coding\the-finals-outfit\scripts\generated\release-2026-11-12\_assets-upload\v17-release-20261121-reconstruction-00'
log() { echo "$(date +%H:%M:%S) $*" >> $G/run-rest.log; }
host() { tr '\r' '\n' < "$1" | grep -ao 'https://[0-9a-f]\{8\}\.the-finals-outfit-assets\.pages\.dev' | head -1; }

log "upload shard 2"
node "$W" pages deploy "$D\\_assets-upload\\v18-release-20261123-reconstruction-002" --project-name the-finals-outfit-assets --branch rel-1123-shard-002 --commit-dirty=true > $G/wrangler-v3-shard-002.log 2>&1 || { log "FAIL upload 2"; exit 1; }
H1="$(host $G/wrangler-v2-shard-001.log)/"; H2="$(host $G/wrangler-v3-shard-002.log)/"
log "leaves $H1 $H2 $(tr '\r' '\n' < $G/wrangler-v3-shard-002.log | grep -ao 'Uploaded [0-9]* files.*' | tail -1)"
[ ${#H1} -gt 20 ] && [ ${#H2} -gt 20 ] || { log "FAIL host parse"; exit 2; }
node -e "
const fs=require('fs'),p='$G/';
const plan=JSON.parse(fs.readFileSync(p+'shard-plan-v1.json','utf8'));
const {createHash}=require('crypto'); const sha=createHash('sha256').update(JSON.stringify(plan)).digest('hex');
const m=n=>JSON.parse(fs.readFileSync(p+'stage-v2-shard-00'+n+'.json','utf8')).manifestSha256, at=new Date().toISOString();
fs.writeFileSync(p+'hosts-leaves-v1.json', JSON.stringify({planSha256:sha,shards:{
 'reconstruction-001':{immutable:true,baseUrl:'$H1',manifestSha256:m(1),recordedAt:at},
 'reconstruction-002':{immutable:true,baseUrl:'$H2',manifestSha256:m(2),recordedAt:at}}},null,2)+'\n');" || { log "FAIL leaves json"; exit 3; }

log "stage shard 0"
ASSET_SOURCE_DIR='E:\Coding\the-finals-outfit\public' ASSET_SHARD_OUT="$D\\_assets-upload\\v18-release-20261123-reconstruction-000" node $T/stage-asset-shard-reuse.mjs "$WT" "$D\\shard-plan-v1.json" 0 --gzip-meshes --hosts "$D\\hosts-leaves-v1.json" --reuse "${P}0" --reuse "${P}1" --reuse "${P}2" > $G/stage-v2-shard-000.json 2> $G/stage-v2-shard-000.err || { log "FAIL stage 0"; exit 4; }
ASSET_SOURCE_DIR='E:\Coding\the-finals-outfit\public' node $T/verify-staged-sample.mjs "$WT" "$D\\shard-plan-v1.json" "$D\\stage-v2-shard-000.json" 15 "$D\\staged-sample-v2-shard-000.json" > $G/staged-sample-v2-shard-000.log 2>&1 || { log "FAIL verify staged 0"; exit 5; }
log "staged 0 ok: $(node -e "const s=require('./$G/stage-v2-shard-000.json');console.log(s.linkedFromPrevious,'linked',s.encodedFresh,'fresh',s.rewrittenIndices.length,'controls')")"

log "upload shard 0"
node "$W" pages deploy "$D\\_assets-upload\\v18-release-20261123-reconstruction-000" --project-name the-finals-outfit-assets --branch rel-1123-shard-000 --commit-dirty=true > $G/wrangler-v3-shard-000.log 2>&1 || { log "FAIL upload 0"; exit 6; }
H0="$(host $G/wrangler-v3-shard-000.log)/"
log "control $H0 $(tr '\r' '\n' < $G/wrangler-v3-shard-000.log | grep -ao 'Uploaded [0-9]* files.*' | tail -1)"
[ ${#H0} -gt 20 ] || { log "FAIL host parse 0"; exit 7; }
node -e "
const fs=require('fs'),p='$G/'; const h=JSON.parse(fs.readFileSync(p+'hosts-leaves-v1.json','utf8'));
const m=JSON.parse(fs.readFileSync(p+'stage-v2-shard-000.json','utf8')).manifestSha256;
h.shards={'reconstruction-000':{immutable:true,baseUrl:'$H0',manifestSha256:m,recordedAt:new Date().toISOString()},...h.shards};
fs.writeFileSync(p+'hosts-v1.json', JSON.stringify(h,null,2)+'\n');" || { log "FAIL hosts json"; exit 8; }

log "verify hosts"
sleep 20
node scripts/validate-asset-shards.mjs "$D\\shard-plan-v1.json" "$D\\hosts-v1.json" "$D\\shard-validation-v1.json" > $G/shard-validation-v1.log 2>&1 && log "repo verifier PASS" || log "repo verifier FAIL"
node -e "const d=require('./$G/plan-diff-v1.json'); console.log([...d.added,...d.changed].join('\n'))" > $G/verify-list-v1.txt
node $T/verify-hosted-files.mjs "$WT" "$D\\shard-plan-v1.json" "$D\\hosts-v1.json" "$D\\verify-list-v1.txt" "$D\\hosted-files-v1.json" > $G/hosted-files-v1.log 2>&1 && log "hosted files PASS" || log "hosted files FAIL"
for n in 0 1 2; do b=$(node -e "console.log(require('./$G/hosts-v1.json').shards['reconstruction-00$n'].baseUrl)"); s=$(node -e "console.log(require('./$G/hosts-v1.json').shards['reconstruction-00$n'].manifestSha256)"); node $T/check-deployment.mjs "$b" "$s" > $G/check-deployment-v1-00$n.json 2>&1 && log "deployment $n headers/404 PASS" || log "deployment $n FAIL"; done
node scripts/asset-shard-config.mjs "$D\\shard-plan-v1.json" "$D\\hosts-v1.json" > $G/settings-v1.json 2> $G/settings-v1.err && log "settings ok" || log "FAIL settings"
log "done"
