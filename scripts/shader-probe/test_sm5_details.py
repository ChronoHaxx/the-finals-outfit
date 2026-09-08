"""Eye/cutout input regressions using synthetic programs, no extracted assets."""
import unittest
import numpy as np
from sm5_slice import Slice
from quad_translation import evaluate_quad, forward_quad
from test_sm5_geometry import SIGNATURE
from test_sm5_semantics import surface_program


def detail_program(body):
    return (SIGNATURE + '// PRIMITIVE_ID 0 x 8 NONE uint x\n'
            '// COLOR 0 xyzw 2 NONE float xyzw\n// TEXCOORD 0 xyzw 3 NONE float xyzw\n'
            + surface_program('''add r20.xyz, r1.xyzx, -cb0[124].xyzx
movc r21.xyz, r1.wwww, -cb0[73].xyzx, r2.xyzx
''' + body))


def coverage(buffer, predicate=0):
    return f'''mov r5.w, l({predicate})
mov r4.w, l(0.35)
mul r4.w, r4.w, cb{buffer}[0].x
movc r4.w, r5.w, l(0), r4.w
'''


class DetailSemantics(unittest.TestCase):
    def test_coverage_move_preserves_float_bits_and_zero_branch(self):
        geometry = [dict(position=[0,0,0], tangent=[1,0,0], normal=[0,0,1],
                         view=[0,0,3], handedness=1, objectPosition=[0,0,0])] * 4
        for predicate, expected in [(0, .7), (1, 0)]:
            program = detail_program(coverage(3, predicate) + 'mov r0.xyz, l(1.0)')
            sliced = Slice(program, [2,0,0,0], {}, surface_kind='eyelash')
            original = forward_quad(program, [2,0,0,0], None, [0]*4, geometry, [0,0,3], surface_kind='eyelash')
            actual = evaluate_quad(sliced, None, [0]*4, geometry)
            np.testing.assert_allclose(actual['opacity'], [[expected]]*4)
            np.testing.assert_array_equal(actual['opacity'], original['opacity'])

    def test_hair_uses_its_color_signature_and_material_buffer(self):
        program = detail_program(coverage(1) + 'mov r0.xyz, v2.xyzx')
        sliced = Slice(program, [2,0,0,0], {}, surface_kind='hair', material_buffer=1)
        geometry = [dict(color=[.1,.3,.7,.9])] * 4
        actual = evaluate_quad(sliced, None, [.8,.8,.8,.8], geometry)
        np.testing.assert_allclose(actual['normal'], [[.1,.3,.7]]*4)
        np.testing.assert_allclose(actual['opacity'], [[.7]]*4)
        self.assertTrue(sliced.emit()[2]['requiresVertexColor'])

    def test_cube_preserves_direction_and_requires_cube_binding(self):
        program = surface_program('sample_indexable(texturecube)(float,float,float,float) r0.xyz, l(-2.0, 3.0, 7.0, 0.0), t4.xyzw, s0')
        sliced = Slice(program, [], {'t4': {'array': False, 'cube': True}})
        code, _, _ = sliced.emit()
        actual = evaluate_quad(sliced, lambda slot, coords, dimensions: [*coords, 1], [0]*4, [{}]*4)
        np.testing.assert_array_equal(actual['normal'], [[-2,3,7]]*4)
        self.assertIn('samplerCube', code)
        with self.assertRaises(ValueError): Slice(program, [], {'t4': {'array': False}}).emit()

    def test_missing_or_ambiguous_coverage_is_rejected(self):
        for count in [0, 2]:
            program = detail_program(coverage(3)*count + 'mov r0.xyz, l(1.0)')
            with self.assertRaises(ValueError): Slice(program, [2,0,0,0], {}, surface_kind='eyelash')


if __name__ == '__main__': unittest.main()
