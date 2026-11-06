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
  },
  // DA_BodyType_Androgynous (new in Season 12): BodyTypeId EBodyType::Androgynous, SupportedArchetypes [Medium],
  // ActivatesCustomizationTag Customization.BodyType.Androgynous. It authors no ActivatesMediumMorphTargets and no
  // SocketOffsetsMedium, so it applies no morph and moves no socket for Medium.
  androgynous: {
    tag: "Customization.BodyType.Androgynous",
    socketOffsets: {},
  },
} as const satisfies Record<string, BodyTypePreview>;

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
