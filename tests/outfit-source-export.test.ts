import { test } from "node:test";
import assert from "node:assert/strict";
import { packagePath } from "../src/lib/package-path";

test("game object paths map to FModel's Content layout and unsafe paths are refused", () => {
  assert.equal(packagePath("/Game/Discovery/Characters/Casual/Assets/BasicTshirt/T_BasicTshirt_BaseColor.0"),
    "Discovery/Content/Discovery/Characters/Casual/Assets/BasicTshirt/T_BasicTshirt_BaseColor");
  assert.equal(packagePath("/Game/Discovery/Characters/Casual/MI_Casual_BasicTshirt_Cotton.MI_Casual_BasicTshirt_Cotton"),
    "Discovery/Content/Discovery/Characters/Casual/MI_Casual_BasicTshirt_Cotton");
  assert.equal(packagePath("/Game/Discovery/Characters/Body/SK_Body_M"), "Discovery/Content/Discovery/Characters/Body/SK_Body_M");
  assert.equal(packagePath("/Engine/EngineMaterials/RandomAngles.0"), "Engine/Content/EngineMaterials/RandomAngles");
  assert.equal(packagePath("/EmbarkScript/MaterialLibrary/T_Grey_M.0"), "EmbarkScript/Content/MaterialLibrary/T_Grey_M");
  assert.equal(packagePath("/Game/../../evil.0"), null);
  assert.equal(packagePath("Discovery/Content/no-leading-slash.0"), null);
  assert.equal(packagePath("/Game/Discovery/<script>.0"), null);
});
