// Independently compare the eight catalog mutations and every prepared native pixel
// against the source references captured before the implementation was reviewed.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import sharp from 'sharp';
const dir='scripts/generated/shader-probe/paint-contracts-astra-v1';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const old=read(`${dir}/catalog-before.json`), next=read('src/data/items.json');
const source=read(`${dir}/source-summary.json`);
const oracle=read('_docs/paint-contracts-2026-09-11/astra-numeric-oracle.json');
const ids=new Set(oracle.contracts.map(c=>c.id));
assert.equal(next.length,old.length,'Catalog length changed');
const report={at:new Date().toISOString(),changedItems:[],assets:[]};
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
for(let i=0;i<old.length;i++){
  const a=old[i],b=next[i];assert.equal(b.id,a.id,'Catalog reordered');
  if(!ids.has(a.id)){assert.deepEqual(b,a,`${a.id}: out-of-scope catalog change`);continue;}
  const {decal:ad,...ar}=a,{decal:bd,...br}=b;
  assert.deepEqual(br,ar,`${a.id}: non-decal change`);
  assert.notDeepEqual(bd,ad,`${a.id}: no prepared change`);
  report.changedItems.push(a.id);
}
for(const c of oracle.contracts){
  const s=source.find(s=>s.id===c.id&&s.target===c.target);
  assert.equal(hash(s.material),s.materialSha256,`${c.id}: source material changed`);
  const layer=next.find(i=>i.id===c.id).decal.layers.find(l=>l.target===c.target);
  const content=s.material.slice(0,s.material.indexOf(`${path.sep}Content${path.sep}`)+9);
  const resolve=ref=>path.join(content,ref.replace(/^\/Game\//,'').replace(/\.0$/,'.png'));
  for(const kind of ['colour',...(c.surface?['surface']:[])]){
    const reference=resolve(s.textureOverrides[kind==='surface'?'t7':c.kind==='tattoo'?'t10':'t6']);
    const relative=layer[kind==='surface'?'surfacePath':'colorPath'];
    assert(relative?.startsWith('models/reconstructed-paint-contracts-v1/'),`${c.id}: wrong asset namespace`);
    const prepared=`public/${relative}`;
    const a=await sharp(reference).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const b=await sharp(prepared).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    assert.equal(b.info.width,a.info.width,`${c.id}: resized width`);
    assert.equal(b.info.height,a.info.height,`${c.id}: resized height`);
    assert(a.data.equals(b.data),`${c.id} ${c.target} ${kind}: native RGBA changed, including RGB beneath alpha zero`);
    if(kind==='surface')assert.equal(hash(reference),hash(prepared),`${c.id}: packed PNG was not byte-copied`);
    report.assets.push({id:c.id,target:c.target,kind,reference,prepared,width:a.info.width,height:a.info.height,
      sourceSha256:hash(reference),preparedSha256:hash(prepared),allRgbaExact:true,packedByteCopy:kind==='surface'});
  }
}
assert.equal(report.changedItems.length,8);assert.equal(report.assets.filter(a=>a.kind==='colour').length,9);
assert.equal(report.assets.filter(a=>a.kind==='surface').length,7);
report.passed=true;
fs.writeFileSync(`${dir}/asset-checks.json`,JSON.stringify(report,null,2)+'\n');
console.log(`PASS: only eight decal blocks changed; ${report.assets.length} native assets preserve every RGBA byte.`);
