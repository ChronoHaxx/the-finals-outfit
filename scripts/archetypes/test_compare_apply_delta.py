"""Tests for compare-apply-delta.py: a rebuild on a moved index must make exactly the reviewed change."""
import copy, importlib.util, unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("delta", Path(__file__).with_name("compare-apply-delta.py"))
delta = importlib.util.module_from_spec(spec)
spec.loader.exec_module(delta)


def index():
    return {
        "formatVersion": 1,
        "meshes": {"/Game/A_M": {"url": "../m/A_M.glb", "sha256": "a"}, "/Game/B_M": {"url": "../m/B_M.glb", "sha256": "b"}},
        "materials": {"MI_A": {"url": "../mat/A.json"}},
        "itemBodyMasks": {"item-a": {"/Game/A_M": "mask-a"}},
        "archetypes": {"light": {"body": "/Game/Body_L"}},
    }


def with_light(active):
    """The reviewed change: one Light mesh and its item's _L mask key."""
    result = copy.deepcopy(active)
    result["meshes"]["/Game/A_L"] = {"url": "../arch/A_L.glb", "sha256": "al"}
    result["itemBodyMasks"]["item-a"]["/Game/A_L"] = "mask-a"
    return result


class CompareApplyDelta(unittest.TestCase):
    def setUp(self):
        self.active = index()
        self.result = with_light(self.active)
        # Another apply (w177) changed an unrelated material and a Medium mesh's sha before the rebuild.
        self.moved = copy.deepcopy(self.active)
        self.moved["materials"]["MI_A"]["url"] = "../mat/A-w177.json"
        self.moved["meshes"]["/Game/B_M"]["sha256"] = "b2"

    def test_same_change_on_a_moved_index_passes(self):
        ok, report = delta.compare(self.active, self.result, self.moved, with_light(self.moved))
        self.assertTrue(ok, report)
        self.assertEqual(report["meshesAdded"], 1)
        self.assertEqual(report["reviewed"]["added"], 3)  # the mesh's url and sha256, and the _L mask key

    def test_rebuild_that_drops_a_mesh_fails(self):
        rebuilt = with_light(self.moved)
        del rebuilt["meshes"]["/Game/A_L"]
        ok, report = delta.compare(self.active, self.result, self.moved, rebuilt)
        self.assertFalse(ok)
        self.assertEqual(report["onlyReviewed"], 2)  # the mesh entry's url and sha256

    def test_rebuild_that_adds_a_mesh_fails(self):
        rebuilt = with_light(self.moved)
        rebuilt["meshes"]["/Game/B_L"] = {"url": "../arch/B_L.glb", "sha256": "bl"}
        ok, report = delta.compare(self.active, self.result, self.moved, rebuilt)
        self.assertFalse(ok)
        self.assertEqual(report["onlyNew"], 2)

    def test_same_path_with_another_value_fails(self):
        rebuilt = with_light(self.moved)
        rebuilt["meshes"]["/Game/A_L"]["sha256"] = "other"
        ok, report = delta.compare(self.active, self.result, self.moved, rebuilt)
        self.assertFalse(ok)
        self.assertEqual(report["valueDiffers"], 1)

    def test_a_derived_value_the_other_apply_changed_fails(self):
        # The other apply changed the Medium mask the _L key copies; the rebuild carries the new value.
        self.moved["itemBodyMasks"]["item-a"]["/Game/A_M"] = "mask-a-s12"
        rebuilt = with_light(self.moved)
        rebuilt["itemBodyMasks"]["item-a"]["/Game/A_L"] = "mask-a-s12"
        ok, report = delta.compare(self.active, self.result, self.moved, rebuilt)
        self.assertFalse(ok)
        self.assertEqual(report["valueDiffers"], 1)

    def test_a_change_that_alters_the_active_index_fails(self):
        rebuilt = with_light(self.moved)
        rebuilt["meshes"]["/Game/B_M"]["sha256"] = "b"  # undoes the other apply's change
        ok, report = delta.compare(self.active, self.result, self.moved, rebuilt)
        self.assertFalse(ok)
        self.assertEqual(report["new"]["altered"], 1)

    def test_a_change_that_removes_an_entry_fails(self):
        rebuilt = with_light(self.moved)
        del rebuilt["materials"]["MI_A"]
        ok, report = delta.compare(self.active, self.result, self.moved, rebuilt)
        self.assertFalse(ok)
        self.assertEqual(report["new"]["removed"], 1)

    def test_filling_an_empty_object_is_not_a_removal(self):
        active = index()
        active["itemBodyMasks"]["item-b"] = {}
        result = copy.deepcopy(active)
        result["itemBodyMasks"]["item-b"]["/Game/B_L"] = "mask-b"
        ok, report = delta.compare(active, result, active, result)
        self.assertTrue(ok, report)


if __name__ == "__main__":
    unittest.main()
