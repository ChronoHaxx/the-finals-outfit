// Execute data-only capture/outfit configurations against one family preview.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {validateConfig, isSafeComponent, parseCamera} from './capture-family.mjs';

const [manifestFile, configDir, version='v1']=process.argv.slice(2);
assert(manifestFile&&configDir&&isSafeComponent(version),'Usage: run-family-review.mjs MANIFEST CONFIG_DIRECTORY [NEW_VERSION]');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const manifest=read(manifestFile), docs=manifest.paths.docs;
const cohort=read(`${docs}/cohort.json`), byId=new Map(cohort.items.map(i=>[i.id,i]));
const eligible=new Set(read(`${manifest.paths.preview}/preview.json`).implemented);
assert(eligible.size>0,'No eligible materials to review');
const catalog=new Map(read(manifest.paths.catalog).map(i=>[i.id,i]));
const validateSlots=slots=>{
  for(const [slot,id] of Object.entries(slots)){
    assert.equal(catalog.get(id)?.slot,slot,`Unknown item or wrong slot: ${id}`);
    if(byId.has(id))assert(eligible.has(id),`Deferred item selected: ${id}`);
  }
};
const jobs=[],receipt={at:new Date().toISOString(),manifestSha256:sha(manifestFile),configHashes:{},
  excludedCandidateIds:cohort.items.filter(i=>!eligible.has(i.id)).map(i=>i.id),jobs:[],passed:false,visualAcceptance:'pending',humanAcceptance:'pending'};
for(const name of ['variants','geometry-a','geometry-idle']){
  const input=path.join(configDir,name+'.json');receipt.configHashes[input]=sha(input);
  const raw=read(input);validateConfig(raw);validateSlots(raw.baseOutfit);
  for(const item of raw.items){
    const expected=byId.get(item.id);assert(expected,`Unknown candidate: ${item.id}`);
    assert.equal(item.slot,expected.slot);assert.deepEqual([...item.meshes].sort(),[...cohort.meshes].sort());
    assert.deepEqual([...item.materials].sort(),[...expected.materials].sort());
  }
  if(name==='variants')assert.deepEqual(raw.items.map(i=>i.id).sort(),[...byId.keys()].sort());
  const filtered={...raw,items:raw.items.filter(i=>eligible.has(i.id))};validateConfig(filtered);
  assert.equal(filtered.pose,name==='geometry-idle'?'idle':'a');
  assert.equal(filtered.angles.length,name==='variants'?2:8);
  if(name!=='variants')assert.equal(filtered.items.length,1,'Geometry view needs one deliberate representative');
  jobs.push({name,config:filtered,configPath:`${docs}/capture-preview-${name}-${version}.json`,output:`${docs}/captures-preview-${name}-${version}`});
}
const outfitInput=path.join(configDir,'outfits.json');receipt.configHashes[outfitInput]=sha(outfitInput);
const outfits=read(outfitInput);assert(outfits.steps.length>=1);
const names=new Set();let previous=null;
for(const step of outfits.steps){
  assert(isSafeComponent(step.name)&&!names.has(step.name));names.add(step.name);
  assert(parseCamera(step.camera));validateSlots(step.slots);
  for(const [id,visible] of Object.entries(step.expected))assert(catalog.has(id)&&typeof visible==='boolean');
  if(step.samePage){assert(previous);assert.equal(step.camera,previous.camera);assert.equal(step.pose??'a',previous.pose??'a');}
  previous=step;
}
jobs.push({name:'outfits',config:outfits,configPath:`${docs}/outfit-scenarios-${version}.json`,output:`${docs}/outfits-preview-${version}`});
const receiptPath=`${docs}/review-run-${version}.json`;
for(const p of [receiptPath,...jobs.flatMap(j=>[j.output,j.configPath])])assert(!fs.existsSync(p),`Preserve previous review: ${p}`);
const save=()=>fs.writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+'\n');
save();
for(const job of jobs){
  fs.writeFileSync(job.configPath,JSON.stringify(job.config,null,2)+'\n');
  const args=job.name==='outfits'?['--import','tsx','scripts/shader-probe/check-family-outfits.mjs',manifestFile,job.configPath,job.output,'preview']:
    ['scripts/shader-probe/capture-family.mjs','--config',job.configPath,'--mode','preview','--preview',manifest.paths.preview,'--output',job.output];
  const startedAt=new Date().toISOString();
  const child=spawnSync(process.execPath,args,{env:{...process.env,APP_URL:manifest.paths.appUrl},windowsHide:true,encoding:'utf8',maxBuffer:4*1024*1024});
  fs.writeFileSync(`${docs}/review-${job.name}-${version}.log`,(child.stdout??'')+'\n'+(child.stderr??''));
  const row={name:job.name,startedAt,finishedAt:new Date().toISOString(),exitCode:child.status,output:job.output};
  receipt.jobs.push(row);save();console.log(JSON.stringify({family:manifest.id,...row}));
  if(child.error||child.status!==0){console.error(child.error?.message??child.stderr?.slice(-1400));process.exit(1);}
  assert(read(`${job.output}/report.json`).passed,'A capture report did not pass');
}
receipt.passed=true;receipt.finishedAt=new Date().toISOString();save();
