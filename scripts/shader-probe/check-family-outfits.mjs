// Shared outfit transitions, source fitting weights and request checks. Scenarios are data.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';
import {collectFittingSnapshot,checkFittingEvidence,fittingMorphNames,FittingBaselines} from './family-fitting-evidence.mjs';
import {validateManifest as validateMultipartManifest} from './freeze-multipart-family.mjs';
import {expectedComponents,checkComponentBindings,checkComponentMeshes} from './multipart-review-contract.mjs';
import {preflightScenarios,FRAMING_BASIS} from './outfit-scenario-contract.mjs';
const [manifestFile, scenariosFile, output, mode='preview']=process.argv.slice(2);
assert(manifestFile&&scenariosFile&&output,'Usage: check-family-outfits.mjs MANIFEST SCENARIOS NEW_OUTPUT [preview|active]');
assert(['preview','active'].includes(mode));assert(!fs.existsSync(output),'Preserve existing evidence');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const manifest=read(manifestFile), scenarios=read(scenariosFile);
// Every step is checked before a browser is launched or evidence is written. A same-page swap keeps
// the opened camera and pose, so a frame change without samePage:false fails here, not in a screenshot.
const plan=preflightScenarios(scenarios);
assert(plan.ok,`Invalid scenarios ${scenariosFile}:\n- ${plan.errors.join('\n- ')}`);
// schemaVersion 2 multipart families are checked per component; schemaVersion 1 keeps its one-mesh checks.
assert([1,2].includes(manifest.schemaVersion),`Unsupported manifest schemaVersion: ${JSON.stringify(manifest.schemaVersion)}`);
const multipart=manifest.schemaVersion===2;if(multipart)validateMultipartManifest(manifest);
process.env.APP_URL=manifest.paths.appUrl;
const {outfitUrl,waitIdle,rigState,watch,classify,servePreviewIndex,swap,shoot}=await import('./coverage-preview-harness.mjs');
const {validateItemState,findRigItem}=await import('./capture-family.mjs');
const {resolveSourceOutfit}=await import(pathToFileURL(path.resolve(manifest.paths.resolver)).href);
const cohort=read(`${manifest.paths.docs}/cohort.json`), byId=new Map(cohort.items.map(i=>[i.id,i]));
const componentsById=new Map(multipart?cohort.items.map(i=>[i.id,expectedComponents(manifest,cohort,i)]):[]);
const indexDir=mode==='preview'?manifest.paths.preview:manifest.paths.active;
const advertised=new Set(read(`${indexDir}/supported-items.json`).items);
const digest=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
fs.mkdirSync(output,{recursive:true});
const report={at:new Date().toISOString(),appUrl:manifest.paths.appUrl,mode,manifestSha256:digest(manifestFile),
  scenariosSha256:digest(scenariosFile),framingBasis:FRAMING_BASIS,
  indexHashes:Object.fromEntries(['assets.json','skin-pairs.json','supported-items.json'].map(f=>[f,digest(`${indexDir}/${f}`)])),
  checks:[],passed:false,visualAcceptance:'pending',humanAcceptance:'pending'};
const save=()=>fs.writeFileSync(`${output}/report.json`,JSON.stringify(report,null,2)+'\n');
// One resolver, the product's own, over the exact indexed definitions of an item set.
const CONTEXT=['Customization.Archetype.Medium'];
const definition=id=>{const file=`${manifest.paths.sourceIndex}/items/${id}.json`;
  assert(fs.existsSync(file),`Missing source definition: ${id}`);return read(file);};
const resolve=ids=>resolveSourceOutfit(ids.map(definition),CONTEXT);
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1100,height:850}}), requests=watch(page);
const visible=(state,id)=>[...state.assemblies,...state.other].some(a=>a.id===id&&a.groupVisible&&a.visibleMeshes>0);
const baselines=new FittingBaselines();
try{
 if(mode==='preview')await servePreviewIndex(page,indexDir);
 for(const [index,step] of scenarios.steps.entries()){
  const framing=plan.frames[index], samePage=framing.effective.navigation==='swap';
  if(samePage)await swap(page,step.slots);
  else{
   const url=new URL(outfitUrl(step.slots,{cam:step.camera,pose:framing.effective.pose,extra:'&temporal=0'}));
   url.pathname='/thesecret-dev-mode-ganyu-only/';
   await page.goto(url.href,{waitUntil:'domcontentloaded'});
   baselines.reset(); // a new page keeps none of the previous page's observed weights
  }
  await waitIdle(page);const state=await rigState(page);
  for(const [id,shown] of Object.entries(step.expected))assert.equal(visible(state,id),shown,`${step.name}:${id}`);
  // Explicitly hidden candidates are verified above; only rendered candidates have source meshes and morphs to inspect.
  const selected=Object.values(step.slots).filter(id=>byId.has(id)&&step.expected[id]!==false);
  for(const id of selected){
   const check=validateItemState(state,{...byId.get(id),meshes:cohort.meshes},mode);
   assert(check.ok,check.errors.join('; '));
   // The aggregate sets above cannot see a swapped per-part material; each component is bound on its own.
   if(multipart){const errors=checkComponentBindings(findRigItem(state,id),componentsById.get(id),`${step.name}:${id}`);
    assert(!errors.length,errors.join('; '));}
  }
  const requestedIds=Object.values(step.slots).filter(id=>!!id);
  const requested=resolve(requestedIds);
  // The rendered assembly decides the fitting, not the request: CharacterViewer drops a shirt's
  // geometry and tags under a complete coat that occupies BodyUpper. Footwear tags also reach the
  // body and companion garments, so the evidence covers every mesh in the rig, not the candidates.
  const snapshot=await page.evaluate(collectFittingSnapshot);
  assert(snapshot.assembly,`${step.name}:missing final source assembly`);
  const effective=resolve(snapshot.assembly.itemIds);
  const expectedNames=fittingMorphNames(snapshot.assembly.fittingTags);
  const shapes=snapshot.meshes.filter(m=>selected.includes(m.itemId))
   .map(m=>({id:m.itemId,dictionary:m.dictionary??{},weights:m.weights??[],matched:m.matched??[],
    ...(multipart?{sourcePartIndex:m.sourcePartIndex,sourceMesh:m.sourceMesh,sourceMaterials:m.sourceMaterials}:{})}));
  if(multipart)for(const id of selected){
   const errors=checkComponentMeshes(snapshot.meshes.filter(m=>m.itemId===id),componentsById.get(id),expectedNames,`${step.name}:${id}`);
   assert(!errors.length,errors.join('; '));
  }
  else for(const id of selected){
   const own=shapes.filter(m=>m.id===id);assert(own.length,`${step.name}:missing morph state`);
   for(const shape of own){
    assert.deepEqual(Object.keys(shape.dictionary).sort(),[...manifest.mesh.morphNames].sort());
    for(const name of manifest.mesh.morphNames)
     assert.equal(shape.weights[shape.dictionary[name]],expectedNames.has(name)?1:0,`${step.name}:${id}:${name}`);
   }
  }
  const evidence=checkFittingEvidence({label:step.name,snapshot,effectiveFittingTags:effective.fittingTags,
   requested:{itemIds:requestedIds,fittingTags:requested.fittingTags,slotConflicts:requested.slotConflicts,
    coatId:step.slots.outerwear??null,shirtId:step.slots.upperBody??null,completeCoat:advertised.has(step.slots.outerwear)}});
  const restoration=baselines.observe(step.name,snapshot,expectedNames);
  const failures=[...evidence.errors,...restoration.errors];
  if(failures.length){
   report.failedFitting={name:step.name,snapshot,requestedItemIds:requestedIds,effectiveFittingTags:effective.fittingTags,
    findings:evidence,restoration,errors:failures};save();
  }
  assert(!failures.length,failures.join('; '));
  const image=`${step.name}.png`;await shoot(page,`${output}/${image}`);
  report.checks.push({name:step.name,framing,expected:step.expected,state,sourceFittingTags:effective.fittingTags,shapes,image,sha256:digest(`${output}/${image}`),
   fitting:{requested:{itemIds:requestedIds,fittingTags:requested.fittingTags},
    effective:{itemIds:snapshot.assembly.itemIds,fittingTags:snapshot.assembly.fittingTags,resolvedFittingTags:effective.fittingTags,
     hiddenItemIds:snapshot.assembly.hiddenItemIds,unresolvedItems:snapshot.assembly.unresolvedItems,
     suppressed:evidence.suppressed,added:evidence.added},
    meshes:evidence.meshes,
    restoration:{samePage,asserted:restoration.restored,notes:[...evidence.notes,...restoration.notes]}}});save();
 }
 report.requests=classify(requests);assert.equal(report.requests.errors.length,0);assert.equal(report.requests.failedRequests.length,0);
 report.passed=true;
}catch(error){report.error=error.message;process.exitCode=1;}
finally{save();await browser.close();}
console.log(JSON.stringify({family:manifest.id,mode,passed:report.passed,checks:report.checks.length,error:report.error}));
