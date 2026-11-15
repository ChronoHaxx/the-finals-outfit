import assert from "node:assert/strict";
import test from "node:test";
import { headComponentCarries } from "../../src/rig/SourceAssembly.ts";

// (15 Nov 2026) Head-component sockets are preserved per head mesh; the 11 Nov index carries Face 01's only. An item
// socketed on the head (earrings, nose studs) may use the source path only on a head whose frame the index carries.
const FACE_01 = "/Game/Discovery/Characters/Heads/Face_01/Base/SK_Head_Face_01_Base.SK_Head_Face_01_Base";
const FACE_09 = "/Game/Discovery/Characters/Heads/Face_09/Base/SK_Head_Face_09_Base.SK_Head_Face_09_Base";
const socket = { bone: "head", parentRest: [], rest: [], restScale: [1, 1, 1] as [number, number, number] };
const assets = { attachmentFrames: { headComponents: { [FACE_01]: { sourceSha256: "x",
  sockets: { earring_01_l: socket, earring_01_r: socket, nose_attachment: socket } } } } } as never;

test("the worn head carries a socket only when the index preserves that head's own frame for it", () => {
  assert.equal(headComponentCarries(assets, FACE_01, ["earring_01_l", "earring_01_r"]), true);
  assert.equal(headComponentCarries(assets, FACE_09, ["earring_01_l"]), false); // the 15 Nov live failure
  assert.equal(headComponentCarries(assets, FACE_01, ["earring_01_l", "earring_07_l"]), false); // one missing socket
  assert.equal(headComponentCarries(assets, undefined, ["earring_01_l"]), false); // no source head worn
  assert.equal(headComponentCarries({} as never, FACE_01, ["earring_01_l"]), false); // an index without frames
});
