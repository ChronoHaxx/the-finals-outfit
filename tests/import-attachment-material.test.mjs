import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { buildAttachmentMaterialBinding } from "../scripts/lib/attachment-material.mjs";

test("attachment conversion follows source texture bindings and preserves packed PBR channels", async () => {
  const root = mkdtempSync(join(tmpdir(), "finals-attachment-"));
  try {
    const dumpRoot = join(root, "Content", "Discovery", "Characters");
    const textures = join(dumpRoot, "Fixture");
    const modelsRoot = join(root, "models");
    mkdirSync(textures, { recursive: true });
    const png = (name, pixel) => sharp(Buffer.from(pixel), { raw: { width: 1, height: 1, channels: 4 } }).png().toFile(join(textures, name));
    await png("T_Actual_CR.png", [20, 80, 160, 73]);
    await png("T_Actual_NOM.png", [128, 191, 5, 212]);
    await png("T_A_Decoy_CR.png", [255, 0, 0, 255]);
    const mi = { family: "attachment", doubleSided: false, textures: {
      CR: "/Game/Discovery/Characters/Fixture/T_Actual_CR.0",
      NOM: "/Game/Discovery/Characters/Fixture/T_Actual_NOM.0",
    } };
    const result = await buildAttachmentMaterialBinding(mi, { dumpRoot, modelsRoot });
    assert.equal(result.doubleSided, false);
    const pixels = async (role) => [...await sharp(readFileSync(join(root, result.bakedSet[role]))).raw().toBuffer()];
    assert.deepEqual(await pixels("albedo"), [20, 80, 160]);
    assert.deepEqual(await pixels("orm"), [255, 73, 212]);
    const normal = await pixels("normal");
    assert.equal(normal[1], 64, "DirectX normal green must be flipped for glTF");
    assert.ok(normal[2] > 230, "normal Z is reconstructed, not copied from packed blue");
    assert.equal(await buildAttachmentMaterialBinding({ ...mi, textures: {} }, { dumpRoot, modelsRoot }), undefined,
      "missing source texture references must not pick nearby files");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
