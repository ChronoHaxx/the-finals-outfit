// The rig's side of the game's contestant classes (Light, Medium, Heavy; src/lib/archetype.ts holds the outfit side).
//
// What the game does (survey 6 Nov 2026, re-checked 22 Nov 2026 in _docs/archetypes-2026-11-22/README.md):
// - Each class has its own body and skeleton. SK_Body_L/H's skeletons are the Medium one with every bone translation
//   scaled (x0.85 / x1.15) and every rotation unchanged; their bind meshes are the Medium bind mesh scaled the same way.
// - The skeleton drives every mesh the class resolves to. In Unreal a mesh follows the body through the leader pose:
//   each follower skins with its OWN reference pose's inverse against the leader's component-space bones. So a mesh
//   authored on the Light skeleton (a garment's SK_*_L) sits exactly where it was authored, while a mesh authored on
//   the Medium skeleton (the shared head, a hair with no class mesh, a head-wrapped beard) is carried by each bone's
//   move from its Medium rest: on Light it translates with the shorter skeleton and keeps its full size. That is why a
//   Light contestant has a full-size head on a smaller body.
// - Sockets live on the one mesh-merge target skeleton (SK_CharacterMeshMergeTarget_Skeleton), relative to their bone,
//   so on Light a socket keeps its relative transform and rides its (moved) bone; the body type then adds its
//   SocketOffsetLight / SocketOffsetsHeavy (BodyTypePreview.ts).
//
// This module reproduces that: the rig scales its driver skeleton's bone translations, and binds every mesh in the rest
// its own inverse binds were authored in (sourceBindBasis below). The Medium path is untouched: with no archetype the rig
// binds exactly as it always has.

import * as THREE from "three";
import type { ArchetypeId } from "../lib/archetype";
import type { AssemblyAssets, SkinPairClassBody } from "./SourceAssembly";

/** The class the rig is built for, from the index (AssemblyAssets.archetypes). Medium is the absence of one. */
export interface RigArchetype {
  id: Exclude<ArchetypeId, "medium">;
  /** The class skeleton's bone-translation scale against Medium, as the index's build proof recorded it. */
  skeletonScale: number;
  /** The class body's source mesh (SK_Body_L / SK_Body_H object path) and its URL. */
  bodySource: string;
  bodyUrl: string;
  /** The Medium source body's URL: the body every rest in the index (sockets, frames) was recorded on. */
  mediumBodyUrl: string;
}

/** The classes an index can build (assets.json `archetypes`), in picker order. */
export function indexArchetypes(assets: Pick<AssemblyAssets, "archetypes">): Exclude<ArchetypeId, "medium">[] {
  return (["light", "heavy"] as const).filter(id => assets.archetypes?.[id] !== undefined);
}

/** One class as the index records it, checked, with every URL resolved: what the rig loads the body with, and what a
 *  face's skin pair puts in place of the Medium body. Undefined when the index carries no such class. The class body
 *  must be a skeletal mesh with exactly the Medium body's slots, so a face's body materials apply to it unchanged. */
export function indexClass(assets: AssemblyAssets, id: Exclude<ArchetypeId, "medium">, url: (path: string) => string):
  { rig: RigArchetype; skinBody: SkinPairClassBody } | undefined {
  const entry = assets.archetypes?.[id];
  if (entry === undefined) return undefined;
  const { body, skeletonScale, boundsOrigin } = (entry ?? {}) as Partial<NonNullable<NonNullable<AssemblyAssets["archetypes"]>["light"]>>;
  const medium = assets.attachmentBody;
  const classMesh = typeof body === "string" ? assets.meshes[body] : undefined;
  const mediumMesh = medium ? assets.meshes[medium.source] : undefined;
  if (typeof body !== "string" || typeof skeletonScale !== "number" || !(skeletonScale > 0.5 && skeletonScale < 1.5)
      || !Array.isArray(boundsOrigin) || boundsOrigin.length !== 3 || !boundsOrigin.every(Number.isFinite)
      || !medium || !classMesh || !mediumMesh || classMesh.kind !== "skeletal"
      || JSON.stringify(classMesh.slots) !== JSON.stringify(mediumMesh.slots))
    throw new Error(`Invalid index archetype: ${id}`);
  const bodyUrl = url(classMesh.url);
  return {
    rig: { id, skeletonScale, bodySource: body, bodyUrl, mediumBodyUrl: url(medium.url) },
    skinBody: { mediumBody: medium.source, body, url: bodyUrl, boundsOrigin: boundsOrigin as [number, number, number] },
  };
}

/** Scales every bone translation under `bones` by `scale` (the class skeleton is the Medium one scaled this way). */
export function scaleSkeletonTranslations(bones: Iterable<THREE.Bone>, scale: number): void {
  for (const bone of bones) bone.position.multiplyScalar(scale);
}

/** How far a skin's own bind is from one body rest: the median, over the joints the driver also has, of the distance
 *  (metres) between where the skin's inverse bind puts the joint and where the rest does. Positions, not whole
 *  matrices: the legacy driver's bones carry Blender's reoriented axes, so its rotations never match a source skin's
 *  even where the joints coincide (22 Nov 2026: positions agree to 1e-5 m on the Medium body, rotations not at all).
 *  The median ignores the few helper joints (the thigh and knee _vpj_ joints) that garments bind differently from the
 *  body; a class's rest moves every core joint by centimetres to decimetres from another's, so the median separates
 *  them unambiguously (22 Nov 2026: 282 staged L/M/H meshes and 135 live Medium meshes each sit within 0.5 mm of their
 *  own rest, and at least 2.8 cm from either other class's). */
export function bindDistance(skeleton: THREE.Skeleton, bindMatrix: THREE.Matrix4,
  rests: ReadonlyMap<string, THREE.Matrix4>): number {
  const distances: number[] = [];
  const own = new THREE.Vector3(), rest = new THREE.Vector3(), m = new THREE.Matrix4();
  skeleton.bones.forEach((bone, index) => {
    const restInverse = rests.get(bone.name), inverse = skeleton.boneInverses[index];
    if (!restInverse || !inverse) return;
    own.setFromMatrixPosition(m.copy(inverse).invert().premultiply(bindMatrix));
    rest.setFromMatrixPosition(m.copy(restInverse).invert());
    distances.push(own.distanceTo(rest));
  });
  if (!distances.length) return Infinity;
  distances.sort((a, b) => a - b);
  const middle = distances.length >> 1;
  return distances.length % 2 ? distances[middle] : (distances[middle - 1] + distances[middle]) / 2;
}

// A skin within this (metres, median joint) of a rest was authored in it: ten times the worst measured own-rest distance
// (0.45 mm) and a sixth of the nearest other class's (2.8 cm).
const BIND_TOLERANCE = 5e-3;

export type BindBasis = "class" | "medium";

/** Which rest a mesh's skin was authored in, on a class driver: its own class's ("class", a SK_*_L on Light) or the
 *  Medium one ("medium": the shared head, a hair with no class mesh). Anything else is refused: binding it would move
 *  it by an amount no game rule gives. */
export function sourceBindBasis(skeleton: THREE.Skeleton, bindMatrix: THREE.Matrix4,
  classRests: ReadonlyMap<string, THREE.Matrix4>, mediumRests: ReadonlyMap<string, THREE.Matrix4>, label: string): BindBasis {
  const own = bindDistance(skeleton, bindMatrix, classRests), medium = bindDistance(skeleton, bindMatrix, mediumRests);
  if (own <= BIND_TOLERANCE && own <= medium) return "class";
  if (medium <= BIND_TOLERANCE) return "medium";
  throw new Error(`Source mesh is bound to no body rest of this class: ${label} (${own.toFixed(4)} / ${medium.toFixed(4)})`);
}
