// (w122, decision #16a) The thin-translucent route: UE's dual-source Dest = o0 + Dest * o1, drawn as a multiply pass
// then an additive pass per face side, back faces before front faces, all from the section's one render item.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import * as THREE from 'three';
import {loadReconstructedMaterial} from '../../src/rig/ReconstructedMaterial';
import {disposeObject3D} from '../../src/rig/dispose';
(globalThis as {window?:unknown}).window ??= {location:{href:'https://thin.test/'}};
const bytes=new Uint8Array([1,2,3,255]);
const source='uniform sampler2D u_t0;';
const sha=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex');
const manifest={formatVersion:1,itemId:'gem-test',shader:'surface.glsl',shaderSha256:sha(source),requiredUvSets:[0],
 thinTranslucentSurface:true,surfaceKind:'thin-translucent',normalSpace:'tangent',blendMode:'BLEND_TranslucentGreyTransmittance',
 shadingModel:'MSM_ThinTranslucent',geometryFrame:'source-world',twoSided:true,
 requiredGeometryFields:['faceSign','handedness','normal','position','tangent','view'],
 textures:[{id:'tex',slot:'t0',file:'texture.bin',array:false,depth:1,srgb:false,wrapS:'TA_Wrap',wrapT:'TA_Wrap',
 sha256:sha(bytes),mips:[{width:1,height:1,offset:0,bytes:4}]}]};
function mesh(sections=1){
 const g=new THREE.PlaneGeometry();g.computeTangents();
 if(sections===1) return new THREE.Mesh(g,new THREE.MeshStandardMaterial());
 g.clearGroups();for(let i=0;i<sections;i++) g.addGroup(0,6,i);
 return new THREE.Mesh(g,Array.from({length:sections},()=>new THREE.MeshStandardMaterial()));
}
function serve(t:any,current:()=>unknown){
 t.mock.method(globalThis,'fetch',async(input:string|URL)=>{
  const u=String(input);
  return u.endsWith('.json')?new Response(JSON.stringify(current())):u.endsWith('.glsl')?new Response(source):new Response(gzipSync(bytes));
 });
}
// The passes three would draw for one render item: the item's own material, then what the hook submits after it.
function drawn(m:THREE.Mesh,material:THREE.Material){
 const after:THREE.Material[]=[];
 const renderer={renderBufferDirect:(_c:unknown,_s:unknown,_g:unknown,pass:THREE.Material)=>{after.push(pass);}};
 m.onAfterRender(renderer as unknown as THREE.WebGLRenderer,new THREE.Scene(),new THREE.Camera(),m.geometry,material,null as any);
 return [material,...after] as THREE.MeshPhysicalMaterial[];
}
const compile=(m:THREE.Material)=>{
 const s={uniforms:{},vertexShader:THREE.ShaderLib.physical.vertexShader,fragmentShader:THREE.ShaderLib.physical.fragmentShader};
 m.onBeforeCompile(s as any,{} as THREE.WebGLRenderer);return s;
};
test('lit two-sided thin translucency draws multiply then add, back faces before front faces',async t=>{
 serve(t,()=>manifest);
 const loaded=await loadReconstructedMaterial('https://thin.test/a.json');
 const m=mesh();loaded.apply(m);
 const passes=drawn(m,m.material as THREE.Material);
 assert.deepEqual(passes.map(p=>[p.userData.thinPass,p.side]),
  [['multiply',THREE.BackSide],['add',THREE.BackSide],['multiply',THREE.FrontSide],['add',THREE.FrontSide]]);
 for(const p of passes){
  assert.equal(p.transparent,true);assert.equal(p.depthWrite,false);assert.equal(p.forceSinglePass,true);
  assert.equal(p.blending,THREE.CustomBlending);assert.equal(p.blendSrcAlpha,THREE.ZeroFactor);assert.equal(p.blendDstAlpha,THREE.OneFactor);
  assert.equal(p.userData.recoveredThinTranslucent,true);assert.equal(typeof p.userData.thinTranslucentPolicy,'string');
  assert.equal(p.userData.recoveredAdditive,undefined); // not a hologram: OutfitExport keeps it
 }
 const [mul,add]=passes;
 assert.equal(mul.blendSrc,THREE.ZeroFactor);assert.equal(mul.blendDst,THREE.SrcColorFactor);assert.equal(mul.toneMapped,false);
 assert.equal(add.blendSrc,THREE.OneFactor);assert.equal(add.blendDst,THREE.OneFactor);assert.equal(add.toneMapped,true);
 assert.equal(new Set(passes.map(p=>p.customProgramCacheKey())).size,2); // the side is a three program parameter
 const fm=compile(mul).fragmentShader,fa=compile(add).fragmentShader;
 assert.match(fm,/pow\(max\(recovered\.transmittance, vec3\(0\.0\)\), vec3\(1\.0 \/ recoveredNoV\)\)/);
 assert.match(fm,/min\(abs\(dot\(normal, geometryViewDir\)\) \+ 1e-5, 1\.0\)/);
 assert.match(fm,/clamp\(50\.0 \* recoveredF0\.g, 0\.0, 1\.0\)/);
 assert.match(fa,/outgoingLight = \(totalDiffuse \+ totalEmissiveRadiance\) \* clamp\(recovered\.opacity, 0\.0, 1\.0\) \+ totalSpecular;/);
 for(const f of [fm,fa]){
  assert.match(f,/recoveredGeometry\.view = glassWorldView\.xzy \* 100\.0/); // the source-world frame
  assert.match(f,/recoveredGeometry\.faceSign = \(gl_FrontFacing \? 1\.0 : -1\.0\) \* glassUnflip;/);
  assert.match(f,/totalEmissiveRadiance \+= recovered\.emissive;/);
  assert.match(f,/#ifdef FLIP_SIDED\s+\/\/[^\n]*\n[^\n]*\n\s*recoveredFrame\[1\] \*= -1\.0;/);
  assert.match(f,/diffuseColor\.a \*= clamp\(recovered\.opacity/); // the export bake reads the source opacity
  assert.doesNotMatch(f,/vRecoveredObjectPosition/);
 }
 // Disposing the section's material releases every pass.
 let released=0;for(const p of passes.slice(1)) p.addEventListener('dispose',()=>released++);
 disposeObject3D(m);assert.equal(released,3);
});
test('one-sided thin translucency draws front faces only; another section draws nothing extra',async t=>{
 serve(t,()=>({...manifest,twoSided:false}));
 const loaded=await loadReconstructedMaterial('https://thin.test/b.json');
 const m=mesh(2);loaded.apply(m,1);
 const materials=m.material as THREE.Material[];
 assert.deepEqual(drawn(m,materials[1]).map(p=>[p.userData.thinPass,p.side]),[['multiply',THREE.FrontSide],['add',THREE.FrontSide]]);
 assert.equal(drawn(m,materials[0]).length,1);
 const before=m.onAfterRender;loaded.apply(m,1);assert.equal(m.onAfterRender,before); // one hook per mesh
});
test('debug views keep one ordinary opaque material',async t=>{
 serve(t,()=>manifest);
 const loaded=await loadReconstructedMaterial('https://thin.test/c.json','baseColor');
 const m=mesh();loaded.apply(m);
 const material=m.material as THREE.MeshPhysicalMaterial;
 assert.equal(material.transparent,false);assert.equal(material.side,THREE.DoubleSide);assert.equal(material.userData.thinPass,undefined);
 assert.equal(material.userData.recoveredThinTranslucent,false);assert.equal(drawn(m,material).length,1);
 assert.match(compile(material).fragmentShader,/outgoingLight = recovered\.baseColor;/);
});
test('an unqualified thin-translucent contract fails closed',async t=>{
 let current:unknown=manifest;serve(t,()=>current);
 for(const change of [{blendMode:'BLEND_Translucent'},{shadingModel:'MSM_DefaultLit'},{geometryFrame:'source-world-or-orthonormal-equivalent'},
  {twoSided:undefined},{surfaceKind:'glass'},{thinTranslucentSurface:false},{worldSurface:true},{geometryDependentNormals:true},
  {glassSurface:true},{normalSpace:'world'},{requiredGeometryFields:['position','objectPosition']},{emissiveExposure:'hue-keeping'}]){
  current={...manifest,...change};
  await assert.rejects(loadReconstructedMaterial('https://thin.test/invalid.json'),/thin-translucent surface contract|glass surface contract/);
 }
});
