// The game's Medium body types (gated; the masculine context is the active default since 21 Oct 2026).
//
// A contestant always has one DA_BodyType_* asset active. For the Medium archetype that asset:
// - activates its Medium morph target by name on every mesh that carries it (head, body, garments, attachments);
// - activates its Customization.BodyType.* customization tag;
// - offsets the attachment sockets it names (AttachmentSocketData.SocketOffsetsMedium).
//
// Season 12 (6 Nov 2026) lists five body types (DA_BodyType_List). Three of them support Medium:
// - Masculine (medium_male);
// - Feminine (medium_female);
// - Androgynous: new in Season 12 and Medium-only. It authors no Medium morph and no Medium socket offsets, so its
//   Medium body is the unmorphed bind shape.
// The two Muscular types support Heavy only, so they are absent here until the archetype stage.
//
// Every value below is copied exactly from the Season 12 read of the installed paks (probe `properties` mode,
// pinned 12.00 mapping e5b29e28):
// - _docs/body-types-2026-11-06/s12-bodytypes-read/extract/DA_BodyType_{Masculine,Feminine}.properties.json
// - _docs/body-types-2026-11-06/s12-androgynous-read/extract/DA_BodyType_Androgynous.properties.json
// tests/rig/body-type-preview.test.ts checks every value against those files. Nothing is invented and no value is
// recomputed. Rotations stay the authored FQuat components; the conversion to the preserved GLB frame happens once,
// in bodyTypeOffsetMatrix below.
//
// Against the pre-S12 copy (shader-probe/definitions-v1), Season 12:
// - changed Feminine's clavicle offset;
// - added hat and eyewear sockets, whose Medium offsets are identity;
// - gave the Muscular types their own tags.
// Masculine's Medium values are unchanged.
//
// Gate: a body type applies only when it is selected:
// - by the dev URL switch ?bodyType=<id>;
// - or by the "bodyType" field an index sets in its assets.json (SourceAssembly.ts AssemblyAssets). The active
//   index sets "masculine".
// With no body type selected, no morph weight, context tag or socket offset is applied anywhere.

import { composeSourceMatrix, type SourceMatrix, type SourceQuaternion, type SourceVector } from "./SourceTransform";
import type { BodyTypeId as OutfitBodyTypeId } from "../lib/body-type";

/** One DA_BodyType socket offset exactly as the source asset authors it: an FTransform in
 *  Unreal axes — translation in centimetres, rotation a quaternion in (X, Y, Z, W) order. */
export interface BodyTypeSocketOffset {
  translation: SourceVector;
  rotation: SourceQuaternion;
  scale: SourceVector;
}

export type BodyTypeSocket =
  "clavicle_attachment" | "pet_attachment" | "upperback_attachment" | "hat_attachment" | "eyewear_attachment";

export interface BodyTypePreview {
  /** The customization tag the asset activates; added to the resolver context when gated on. */
  tag: string;
  /** The Medium archetype morph the asset activates, applied by name to every mesh that carries it.
   *  Absent when the asset activates none (Androgynous): its Medium body is the bind shape. */
  mediumMorph?: string;
  /** The sockets the asset offsets, keyed by their exact source names. */
  socketOffsets: Partial<Record<BodyTypeSocket, BodyTypeSocketOffset>>;
  /** (22 Nov 2026, archetypes) The Light and Heavy classes the asset supports, each with the morph it activates
   *  (ActivatesLightMorphTargets / ActivatesHeavyMorphTargets) and its socket offsets (SocketOffsetLight /
   *  SocketOffsetsHeavy, the asset's own spellings). Absent for a class the asset's SupportedArchetypes excludes. */
  light?: BodyTypeClass;
  heavy?: BodyTypeClass;
}

/** One Light or Heavy class of a body type, exactly as its DA_BodyType asset authors it. */
export interface BodyTypeClass {
  morph: string;
  socketOffsets: Partial<Record<BodyTypeSocket, BodyTypeSocketOffset>>;
}

const IDENTITY_HEAD_SOCKET: BodyTypeSocketOffset = {
  // DA_BodyType_* SocketOffsetsMedium hat_attachment / eyewear_attachment: zero translation and the authored
  // near-identity quaternion (Y 2.7755576e-17, an FQuat round-off the asset stores).
  translation: [0, 0, 0],
  rotation: [0, 2.7755576e-17, 0, 1],
  scale: [1, 1, 1],
};

export const BODY_TYPE_PREVIEWS = {
  // DA_BodyType_Masculine: BodyTypeId EBodyType::Masculine, ActivatesMediumMorphTargets [medium_male],
  // ActivatesCustomizationTag Customization.BodyType.Masculine, AttachmentSocketData.SocketOffsetsMedium.
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
      hat_attachment: IDENTITY_HEAD_SOCKET,
      eyewear_attachment: IDENTITY_HEAD_SOCKET,
    },
    // ActivatesLightMorphTargets [light_male], AttachmentSocketData.SocketOffsetLight.
    light: {
      morph: "light_male",
      socketOffsets: {
        clavicle_attachment: { translation: [0.26684353, 0.9551667, -0.121406026], rotation: [-0.013957218, 5.7978563e-05, -3.4826364e-05, 0.9999026], scale: [1, 1, 1] },
        pet_attachment: { translation: [-2.2703445, 0.5910535, -1.166999], rotation: [-1.149848e-06, -0.06572317, -3.4401324e-07, 0.9978379], scale: [1, 1, 1] },
        upperback_attachment: { translation: [1.4164559e-08, 1.3030745, -2.8201683], rotation: [0, 2.0816682e-17, 0, 1], scale: [1, 1, 1] },
        hat_attachment: { translation: [5.3290705e-15, 2.7144378e-07, -2.6470013], rotation: [0, 2.7755576e-17, 0, 1], scale: [1, 1, 1] },
        eyewear_attachment: { translation: [4.440892e-16, -2.3896239, -0.89493066], rotation: [0, 2.7755576e-17, 0, 1], scale: [1, 1, 1] },
      },
    },
    // ActivatesHeavyMorphTargets [heavy_male], AttachmentSocketData.SocketOffsetsHeavy.
    heavy: {
      morph: "heavy_male",
      socketOffsets: {
        clavicle_attachment: { translation: [1.1952089, 3.7154605, -0.77633905], rotation: [0.047942154, 1.7378999e-07, -1.1967923e-07, 0.9988501], scale: [1, 1, 1] },
        pet_attachment: { translation: [1.939927, -0.4368576, 4.3298883], rotation: [-1.1444738e-06, -0.05051445, -3.6149015e-07, 0.9987233], scale: [1, 1, 1] },
        upperback_attachment: { translation: [-8.540969e-09, -6.201804, 2.0844722], rotation: [0, 2.0816682e-17, 0, 1], scale: [1, 1, 1] },
        hat_attachment: { translation: [0, -2.0063233e-07, 1.956479], rotation: [0, 2.7755576e-17, 0, 1], scale: [1, 1, 1] },
        eyewear_attachment: { translation: [0, 1.7662435, 0.6614704], rotation: [0, 2.7755576e-17, 0, 1], scale: [1, 1, 1] },
      },
    },
  },
  // DA_BodyType_Feminine: BodyTypeId EBodyType::Feminine (the enum default, so the asset does not serialize it),
  // ActivatesMediumMorphTargets [medium_female], ActivatesCustomizationTag Customization.BodyType.Feminine,
  // AttachmentSocketData.SocketOffsetsMedium.
  feminine: {
    tag: "Customization.BodyType.Feminine",
    mediumMorph: "medium_female",
    socketOffsets: {
      clavicle_attachment: {
        translation: [-0.07305206, 0.30822864, 0.16642481],
        rotation: [0.06270377, 0.0044291476, -0.09631521, 0.993364],
        scale: [1, 1, 1],
      },
      pet_attachment: {
        translation: [0.012283378, -8.54279e-08, -0.12111688],
        rotation: [-1.1529222e-06, -0.0747749, -3.3356528e-07, 0.9972004],
        scale: [1, 1, 1],
      },
      upperback_attachment: {
        translation: [1.4413182e-09, -0.3361784, 1.9533202e-07],
        rotation: [0, 2.0816682e-17, 0, 1],
        scale: [1, 1, 1],
      },
      hat_attachment: IDENTITY_HEAD_SOCKET,
      eyewear_attachment: IDENTITY_HEAD_SOCKET,
    },
    // ActivatesLightMorphTargets [light_female], AttachmentSocketData.SocketOffsetLight.
    light: {
      morph: "light_female",
      socketOffsets: {
        clavicle_attachment: { translation: [1.1825608e-08, 0.14260186, 0.005566344], rotation: [0.019505935, 6.2128855e-08, -4.022793e-08, 0.99980974], scale: [1, 1, 1] },
        pet_attachment: { translation: [-2.2461119, 0.591052, -1.8093995], rotation: [-1.1568976e-06, -0.08690938, -3.1950478e-07, 0.99621624], scale: [1, 1, 1] },
        upperback_attachment: { translation: [-1.9366944e-09, 1.6985413, -2.8201683], rotation: [0, 2.0816682e-17, 0, 1], scale: [1, 1, 1] },
        hat_attachment: { translation: [5.3290705e-15, 2.7144378e-07, -2.6470013], rotation: [0, 2.7755576e-17, 0, 1], scale: [1, 1, 1] },
        eyewear_attachment: { translation: [4.440892e-16, -2.3896239, -0.89493066], rotation: [0, 2.7755576e-17, 0, 1], scale: [1, 1, 1] },
      },
    },
    // ActivatesHeavyMorphTargets [heavy_female], AttachmentSocketData.SocketOffsetsHeavy.
    heavy: {
      morph: "heavy_female",
      socketOffsets: {
        clavicle_attachment: { translation: [0.5379715, 3.1792862, -0.025981905], rotation: [0.066022865, 3.9376548e-07, -2.8181026e-07, 0.9978181], scale: [1, 1, 1] },
        pet_attachment: { translation: [1.5506563, -0.43686172, 2.361607], rotation: [-1.1444738e-06, -0.05051445, -3.6149015e-07, 0.9987233], scale: [1, 1, 1] },
        upperback_attachment: { translation: [-2.087905e-09, -4.923991, 2.0844724], rotation: [0, 2.0816682e-17, 0, 1], scale: [1, 1, 1] },
        hat_attachment: { translation: [0, -2.0063233e-07, 1.956479], rotation: [0, 2.7755576e-17, 0, 1], scale: [1, 1, 1] },
        eyewear_attachment: { translation: [0, 1.7662435, 0.6614704], rotation: [0, 2.7755576e-17, 0, 1], scale: [1, 1, 1] },
      },
    },
  },
  // DA_BodyType_Androgynous (new in Season 12): BodyTypeId EBodyType::Androgynous, SupportedArchetypes [Medium],
  // ActivatesCustomizationTag Customization.BodyType.Androgynous. It authors no ActivatesMediumMorphTargets and no
  // SocketOffsetsMedium, so it applies no morph and moves no socket for Medium. It does author Light and Heavy morphs
  // and offsets (light_female, heavy_female), but SupportedArchetypes [Medium] means the game never applies them, so
  // they are not carried here.
  androgynous: {
    tag: "Customization.BodyType.Androgynous",
    socketOffsets: {},
  },
} as const satisfies Record<OutfitBodyTypeId, BodyTypePreview>;

export type BodyTypeId = keyof typeof BODY_TYPE_PREVIEWS;

export const BODY_TYPE_IDS = Object.keys(BODY_TYPE_PREVIEWS) as BodyTypeId[];

export function isBodyTypeId(id: unknown): id is BodyTypeId {
  return typeof id === "string" && Object.hasOwn(BODY_TYPE_PREVIEWS, id);
}

/** The named preview context, or undefined when no body type is selected. Unknown names are refused. */
export function bodyTypePreview(id: string | undefined): BodyTypePreview | undefined {
  if (id === undefined) return undefined;
  if (!isBodyTypeId(id)) throw new Error(`Unknown body type preview: ${id}`);
  return BODY_TYPE_PREVIEWS[id];
}

/** One socket offset in the converted GLB frame the preserved rests use. The reflection is the
 *  same one SourceTransform.sourceRotationQuaternion applies to an FRotator's quaternion
 *  (components (X, Z, Y) with the first three negated); translation follows sourceLocalMatrix
 *  ((X, Z, Y) metres at 0.01 per centimetre), as does the scale. */
export function bodyTypeOffsetMatrix(offset: BodyTypeSocketOffset): SourceMatrix {
  const [qx, qy, qz, qw] = offset.rotation, [tx, ty, tz] = offset.translation, [sx, sy, sz] = offset.scale;
  return composeSourceMatrix([tx * .01, tz * .01, ty * .01], [-qx, -qz, -qy, qw], [sx, sz, sy]);
}
