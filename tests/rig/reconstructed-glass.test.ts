import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import * as THREE from 'three';
import {loadReconstructedMaterial} from '../../src/rig/ReconstructedMaterial';
import {disposeObject3D} from '../../src/rig/dispose';
(globalThis as {window?:unknown}).window ??= {location:{href:'https://glass.test/'}};
const bytes=new Uint8Array([1,2,3,255]);
const source='uniform sampler2D u_t0;';
const sha=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex');
const manifest={formatVersion:1,itemId:'glass-test',shader:'surface.glsl',shaderSha256:sha(source),requiredUvSets:[0],
 glassSurface:true,surfaceKind:'glass',normalSpace:'tangent',blendMode:'BLEND_TranslucentGreyTransmittance',twoSided:true,
 textures:[{id:'tex',slot:'t0',file:'texture.bin',array:false,depth:1,srgb:false,wrapS:'TA_Wrap',wrapT:'TA_Wrap',
 sha256:sha(bytes),mips:[{width:1,height:1,offset:0,bytes:4}]}]};
function mesh(){const g=new THREE.PlaneGeometry();g.computeTangents();return new THREE.Mesh(g,new THREE.MeshStandardMaterial());}
test('glass renders source alpha only in lit mode, separates programs and disposes owned textures',async t=>{
 const calls:string[]=[];
 t.mock.method(globalThis,'fetch',async(input:string|URL)=>{
  const u=String(input);calls.push(u);
  return u.endsWith('.json')?new Response(JSON.stringify(manifest)):u.endsWith('.glsl')?new Response(source):new Response(gzipSync(bytes));
 });
 const lit=await loadReconstructedMaterial('https://glass.test/a.json');
 const debug=await loadReconstructedMaterial('https://glass.test/a.json','normal');
 const a=mesh(),b=mesh();lit.apply(a);debug.apply(b);
 const ma=a.material as THREE.MeshPhysicalMaterial,mb=b.material as THREE.MeshPhysicalMaterial;
 assert.equal(ma.transparent,true);assert.equal(ma.depthWrite,false);assert.equal(ma.alphaHash,false);
 assert.equal(mb.transparent,false);assert.equal(mb.depthWrite,true);assert.equal(mb.toneMapped,false);
 assert.equal(ma.toneMapped,true);assert.equal(ma.side,THREE.DoubleSide);
 assert.notEqual(ma.customProgramCacheKey(),mb.customProgramCacheKey());
 const compile=(m:THREE.Material)=>{
  const s={uniforms:{},vertexShader:THREE.ShaderLib.physical.vertexShader,fragmentShader:THREE.ShaderLib.physical.fragmentShader};
  m.onBeforeCompile(s as any,{} as THREE.WebGLRenderer);return s;
 };
 const sa=compile(ma),sb=compile(mb);
 assert.match(sa.fragmentShader,/diffuseColor.a \*= clamp\(recovered.opacity/);
 assert.doesNotMatch(sb.fragmentShader,/diffuseColor.a \*= clamp\(recovered.opacity/);
 assert.match(sa.fragmentShader,/recoveredGeometry.view = -recoveredGeometry.position/);
 assert.doesNotMatch(sa.fragmentShader,/vRecoveredObjectPosition/);
 const ta=ma.userData.tex as THREE.Texture,tb=mb.userData.tex as THREE.Texture;
 assert.notEqual(ta,tb);let da=0,db=0;ta.addEventListener('dispose',()=>da++);tb.addEventListener('dispose',()=>db++);
 disposeObject3D(a);assert.equal(da,1);assert.equal(db,0);disposeObject3D(b);assert.equal(db,1);
 assert.equal(calls.filter(u=>u.endsWith('.glsl')).length,1);
 assert.equal(calls.filter(u=>u.endsWith('texture.bin')).length,1);
});
test('unqualified blend, mixed surface contract and missing original tangent fail closed',async t=>{
 let current={...manifest};
 t.mock.method(globalThis,'fetch',async(input:string|URL)=>String(input).endsWith('.json')?new Response(JSON.stringify(current)):String(input).endsWith('.glsl')?new Response(source):new Response(gzipSync(bytes)));
 for(const change of [{blendMode:'BLEND_Masked'},{glassSurface:false},{normalSpace:'world'},{worldSurface:true}]){
  current={...manifest,...change};
  await assert.rejects(loadReconstructedMaterial('https://glass.test/invalid.json'),/glass surface contract/);
 }
 current={...manifest};const loaded=await loadReconstructedMaterial('https://glass.test/valid.json');const m=mesh();m.geometry.deleteAttribute('tangent');
 assert.throws(()=>loaded.apply(m),/original tangents/);
});
