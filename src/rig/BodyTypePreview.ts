// The game's body-type preview context (gated OFF by default, 21 Oct 2026).
//
// A contestant always has one DA_BodyType_* asset active; for the Medium archetype
// DA_BodyType_Masculine activates the medium_male morph target by name on every mesh that
// carries it (head, body, garments, attachments), activates the Customization.BodyType.Masculine
// customization tag, and offsets the clavicle, pet and upper-back attachment sockets
// (AttachmentSocketData.SocketOffsetsMedium). The preview renders none of that today, which is a
// shape the game never shows (the raider helmet neck poke, w39h-raider-head-hide/).
//
// Every value below is copied exactly from the recovered asset
// scripts/generated/shader-probe/definitions-v1/DA_BodyType_Masculine.properties.json (byte-identical
// copy: scripts/generated/shader-probe/catalog-refresh-20261018/properties-01/DA_BodyType_Masculine.properties.json).
// Nothing is invented and no value is recomputed. Rotations stay the authored FQuat components;
// the conversion to the preserved GLB frame happens once, in bodyTypeOffsetMatrix below.
//
// Gate: this context is applied only when it is selected — by the dev URL switch
// ?bodyType=masculine, or by the "bodyType" field a preview index sets in its assets.json
// (SourceAssembly.ts AssemblyAssets; absent from the active index, so every default render,
// resolver result and test is unchanged until activation sets it there). With the gate off no
// morph weight, context tag or socket offset is applied anywhere.

import { composeSourceMatrix, type SourceMatrix, type SourceQuaternion, type SourceVector } from "./SourceTransform";

/** One DA_BodyType socket offset exactly as the source asset authors it: an FTransform in
 *  Unreal axes — translation in centimetres, rotation a quaternion in (X, Y, Z, W) order. */
export interface BodyTypeSocketOffset {
  translation: SourceVector;
  rotation: SourceQuaternion;
  scale: SourceVector;
}

export interface BodyTypePreview {
  /** The customization tag the asset activates; added to the resolver context when gated on. */
  tag: string;
  /** The Medium archetype morph the asset activates, applied by name to every mesh that carries it. */
  mediumMorph: string;
  /** The sockets the asset offsets, keyed by their exact source names. */
  socketOffsets: Partial<Record<"clavicle_attachment" | "pet_attachment" | "upperback_attachment",
    BodyTypeSocketOffset>>;
}

// DA_BodyType_Masculine: BodyTypeId EBodyType::Masculine, ActivatesMediumMorphTargets medium_male,
// ActivatesCustomizationTag Customization.BodyType.Masculine, AttachmentSocketData.SocketOffsetsMedium.
export const BODY_TYPE_PREVIEWS = {
  masculine: {
    tag: "Customization.BodyType.Masculine",
    mediumMorph: "medium_male",
    socketOffsets: {
      clavicle_attachment: {
        translation: [0.31990716, 1.6830714, -0.035146035],
        rotation: [1.0549824e-06, 2.2451142e-07, 0.036611296, 0.99932957],
        scale: [1, 1, 1],
      },
      pet_attachment: {
        translation: [-0.07107357, 1.8490414e-06, 0.70779574],
        rotation: [-1.1373996e-06, -0.031531353, -3.8316787e-07, 0.9995028],
        scale: [1, 1, 1],
      },
      upperback_attachment: {
        translation: [5.4529394e-09, -1.2463351, 1.9533218e-07],
        rotation: [0, 2.0816682e-17, 0, 1],
        scale: [1, 1, 1],
      },
    },
  },
} as const satisfies Record<string, BodyTypePreview>;

export type BodyTypeId = keyof typeof BODY_TYPE_PREVIEWS;

/** The named preview context, or undefined when no body type is selected. Unknown names are refused. */
export function bodyTypePreview(id: string | undefined): BodyTypePreview | undefined {
  if (id === undefined) return undefined;
  const preview = (BODY_TYPE_PREVIEWS as Record<string, BodyTypePreview>)[id];
  if (!preview) throw new Error(`Unknown body type preview: ${id}`);
  return preview;
}

/** One socket offset in the converted GLB frame the preserved rests use. The reflection is the
 *  same one SourceTransform.sourceRotationQuaternion applies to an FRotator's quaternion
 *  (components (X, Z, Y) with the first three negated); translation follows sourceLocalMatrix
 *  ((X, Z, Y) metres at 0.01 per centimetre), as does the scale. */
export function bodyTypeOffsetMatrix(offset: BodyTypeSocketOffset): SourceMatrix {
  const [qx, qy, qz, qw] = offset.rotation, [tx, ty, tz] = offset.translation, [sx, sy, sz] = offset.scale;
  return composeSourceMatrix([tx * .01, tz * .01, ty * .01], [-qx, -qz, -qy, qw], [sx, sz, sy]);
}
