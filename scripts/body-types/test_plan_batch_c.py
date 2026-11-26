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

    def test_a_held_mesh_is_never_admitted_even_when_an_admission_list_names_it(self):
        # The tee is review-admitted, then held after a later review: no wave may release it, so every item that shows
        # it stays live, and the outfit's other meshes are held with it: the cape, its morphs changed, leaves the
        # effective set, so the cape item goes too; the pants (morphs unchanged) stay Season 12-shaped.
        held = plan.Rule(self.rule_proof, {src('SK_Tee')}, set(), self.users, BODY, self.by_item, held={src('SK_Tee')})
        self.assertEqual(held.items(), {'pants'})
        self.assertEqual(held.items({src('SK_Tee')}), {'pants'})
        # Without the hold, the admission releases every item.
        admitted = plan.Rule(self.rule_proof, {src('SK_Tee')}, set(), self.users, BODY, self.by_item)
        self.assertEqual(admitted.items(), {'pants', 'tee', 'cape', 'outfit'})


class CurrentTest(unittest.TestCase):
    def test_an_item_is_current_only_when_it_shows_no_unproven_17_nov_change(self):
        # Boots: a stale package the item rule counts as Season 12, with no 17 Nov read proving it current yet.
        by_item = {'boots': {src('Boots')}, 'outfit': {src('Boots'), src('Pants')}, 'pants': {src('Pants')}}
        s12 = {'boots', 'outfit', 'pants'}
        self.assertEqual(plan.current_items(s12, by_item, {src('Boots')}), {'pants'})
        self.assertEqual(plan.current_items(s12, by_item, set()), s12)


class MixedItemTest(unittest.TestCase):
    """The approved mixed-item exception (option (c), 26 Nov 2026) in the planner's item rule."""
    def setUp(self):
        # Tee held live (excused for 'outfit' only), Hood held live with no exception; Cape and Belt morph-only with
        # changed morphs. 'outfit' shows Tee and Cape, 'hood-set' shows Hood and Belt.
        names = ('SK_Tee', 'SK_Hood', 'SK_Cape', 'SK_Belt')
        self.proof = {'SK_Tee': row('SK_Tee', 'refused', problems=['POSITION differs']),
                      'SK_Hood': row('SK_Hood', 'refused', problems=['POSITION differs']),
                      'SK_Cape': row('SK_Cape', 'morph-only'), 'SK_Belt': row('SK_Belt', 'morph-only')}
        self.by_item = {'outfit': {src('SK_Tee'), src('SK_Cape')}, 'hood-set': {src('SK_Hood'), src('SK_Belt')},
                        'tee': {src('SK_Tee')}, 'cape': {src('SK_Cape')}, 'belt': {src('SK_Belt')}}
        self.users = {}
        for item, meshes in self.by_item.items():
            for m in meshes:
                self.users.setdefault(m, []).append((item, meshes))
        self.held = {src('SK_Tee'), src('SK_Hood')}
        self.rule = plan.Rule(self.proof, {src('SK_Tee'), src('SK_Hood')}, set(), self.users, BODY, self.by_item,
                              held=self.held, excused={('outfit', src('SK_Tee'))})

    def test_the_excused_item_releases_its_other_meshes_but_never_counts_as_season_12(self):
        effective, _ = self.rule.settle()
        self.assertIn(src('SK_Cape'), effective)
        self.assertNotIn('outfit', self.rule.items())

    def test_a_second_held_mesh_without_an_exception_still_holds_its_items(self):
        effective, _ = self.rule.settle()
        self.assertNotIn(src('SK_Belt'), effective)
        self.assertEqual(self.rule.items(), {'cape'})

    def test_the_tee_hold_still_blocks_the_tee_mesh(self):
        for added in (frozenset(), {src('SK_Tee')}, {src('SK_Tee'), src('SK_Hood')}):
            self.assertNotIn(src('SK_Tee'), self.rule.settle(added)[0])
            self.assertFalse({'tee', 'outfit'} & self.rule.items(added))


if __name__ == '__main__':
    unittest.main()
