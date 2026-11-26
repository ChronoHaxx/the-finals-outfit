"""Tests for plan-batch-c.py: the shared-item cluster walk and the item rule per wave.

  python -X utf8 -I scripts/body-types/test_plan_batch_c.py
"""
import importlib.util
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('plan_batch_c', HERE / 'plan-batch-c.py')
plan = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plan)

BODY = '/Game/Body/SK_Body_M.SK_Body_M'


def src(name):
    return f'/Game/X/{name}.{name}'


def row(name, status, morphs_changed=True, problems=()):
    return {'source': src(name), 'status': status, 'morphsChanged': morphs_changed, 'problems': list(problems)}


class ComponentTest(unittest.TestCase):
    def test_walks_items_through_non_s12_meshes_only(self):
        by_item = {'jacket-a': {src('Jacket'), src('Belt')},
                   'belt-b': {src('Belt'), src('Skirt')},
                   'skirt-c': {src('Skirt'), src('Boots')},   # Boots is S12: the walk stops there
                   'boots-d': {src('Boots'), src('Gloves')},
                   'lone-e': {src('Hat')}}
        effective = {src('Boots')}
        got = plan.component({src('Jacket')}, by_item, effective, BODY)
        self.assertEqual(got, {src('Jacket'), src('Belt'), src('Skirt')})


class RuleTest(unittest.TestCase):
    def setUp(self):
        # Tee: batch C (refused, UVs changed). Cape: S12 morph-only but its package changed on 17 Nov (stale).
        # Pants: S12 morph-only with unchanged morphs, current (held by the outfit, but it stays S12-shaped). Item 'outfit' shows all three; 'tee' the tee alone; 'cape' the cape alone.
        proof = {'SK_Tee': row('SK_Tee', 'refused', problems=['POSITION differs']),
                 'SK_Cape': row('SK_Cape', 'morph-only'),
                 'SK_Pants': row('SK_Pants', 'morph-only', morphs_changed=False)}
        by_item = {'outfit': {src('SK_Tee'), src('SK_Cape'), src('SK_Pants')},
                   'tee': {src('SK_Tee')}, 'cape': {src('SK_Cape')}, 'pants': {src('SK_Pants')}}
        users = {}
        for item, meshes in by_item.items():
            for m in meshes:
                users.setdefault(m, []).append((item, meshes))
        self.rule_proof, self.users, self.by_item = proof, users, by_item
        self.rule = plan.Rule(proof, set(), {src('SK_Cape')}, users, BODY, by_item)

    def test_baseline_holds_items_with_batch_c_or_stale_meshes(self):
        self.assertEqual(self.rule.items(), {'pants'})

    def test_a_held_mesh_with_changed_morphs_leaves_the_effective_set(self):
        changed = plan.Rule({**self.rule_proof, 'SK_Pants': row('SK_Pants', 'morph-only')}, set(), {src('SK_Cape')},
                            self.users, BODY, self.by_item)
        self.assertEqual(changed.items(), set())

    def test_a_wave_releases_nothing_while_a_shared_item_shows_an_unread_mesh(self):
        # The outfit still shows the stale cape, so the tee is held and, its morphs changed, leaves the effective set.
        self.assertEqual(self.rule.items({src('SK_Tee')}), {'pants'})
        # Re-reading the cape as well releases every item.
        self.assertEqual(self.rule.items({src('SK_Tee'), src('SK_Cape')}), {'pants', 'tee', 'cape', 'outfit'})


class CurrentTest(unittest.TestCase):
    def test_an_item_is_current_only_when_it_shows_no_unproven_17_nov_change(self):
        # Boots: a stale package the item rule counts as Season 12, with no 17 Nov read proving it current yet.
        by_item = {'boots': {src('Boots')}, 'outfit': {src('Boots'), src('Pants')}, 'pants': {src('Pants')}}
        s12 = {'boots', 'outfit', 'pants'}
        self.assertEqual(plan.current_items(s12, by_item, {src('Boots')}), {'pants'})
        self.assertEqual(plan.current_items(s12, by_item, set()), s12)


if __name__ == '__main__':
    unittest.main()
