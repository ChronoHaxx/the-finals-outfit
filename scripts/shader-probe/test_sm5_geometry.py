"""Synthetic quad/geometry checks without extracted game assets."""
import unittest
import numpy as np
from sm5_slice import Slice
from quad_translation import derivative, forward_quad, evaluate_quad
from test_sm5_semantics import surface_program


SIGNATURE = '// TEXCOORD 10 xyzw 0 NONE float xyz\n// TEXCOORD 11 xyzw 1 NONE float xyzw\n'


class GeometrySemantics(unittest.TestCase):
    def test_coarse_derivative_uses_one_pair_for_the_whole_quad(self):
        values = np.array([1., 3., 6., 100.], np.float32)
        np.testing.assert_array_equal(derivative(values, 'x'), [2]*4)
        np.testing.assert_array_equal(derivative(values, 'y'), [5]*4)

    def test_position_anchor_and_both_derivatives_preserve_geometry(self):
        program = SIGNATURE + surface_program('''mov r1.xyz, v6.xyzx
add r2.xyz, r1.xyzx, -cb0[124].xyzx
deriv_rtx_coarse r3.xyz, r2.xyzx
deriv_rty_coarse r4.xyz, r2.xyzx
add r0.xyz, r3.xyzx, r4.xyzx''')
        geometry = [{'position':p, 'tangent':[1,0,0], 'normal':[0,0,1], 'handedness':1, 'view':[0,0,4]}
                    for p in [[2,3,4],[4,5,4],[3,7,4],[5,9,4]]]
        sliced = Slice(program, [], {}, geometry_dependent=True)
        code, _, report = sliced.emit()
        expected = np.array([[3,6,0]]*4)
        original = forward_quad(program, [], None, [0]*4, geometry, [0,0,4])
        actual = evaluate_quad(sliced, None, [0]*4, geometry)
        np.testing.assert_array_equal(original['normal'], expected)
        np.testing.assert_array_equal(actual['normal'], expected)
        self.assertIn('(-dFdy(', code)
        self.assertEqual(report['requiredUvSets'], [])

    def test_uv_requirements_follow_live_inputs(self):
        program = surface_program('mov r0.xyz, v2.xxxx')
        self.assertEqual(Slice(program, [], {}).emit()[2]['requiredUvSets'], [0])
        program = surface_program('mov r0.xyz, v2.zzzz')
        self.assertEqual(Slice(program, [], {}).emit()[2]['requiredUvSets'], [1])

    def test_missing_or_ambiguous_geometry_anchor_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'input signature'):
            Slice(surface_program('mov r0.xyz, l(0.0)'), [], {}, geometry_dependent=True)
        for count in [0, 2]:
            program = SIGNATURE + surface_program('add r0.xyz, r1.xyzx, -cb0[124].xyzx\n' * count)
            with self.assertRaisesRegex(ValueError, 'Expected one geometry position anchor'):
                Slice(program, [], {}, geometry_dependent=True)


if __name__ == '__main__':
    unittest.main()
