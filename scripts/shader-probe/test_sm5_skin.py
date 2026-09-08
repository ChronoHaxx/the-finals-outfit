"""Skin anchors and instruction boundaries using synthetic SM5 only."""
import unittest
import numpy as np
from sm5_slice import Slice
from quad_translation import evaluate_quad
from test_sm5_semantics import surface_program
from test_sm5_geometry import SIGNATURE


def skin_program(body):
    return SIGNATURE + '// PRIMITIVE_ID 0 x 8 NONE uint x\n' + surface_program('''
add r20.xyz, r1.xyzx, -cb0[124].xyzx
movc r21.xyz, r1.wwww, -cb0[73].xyzx, r2.xyzx
mad_sat r22.xyz, r21.xyzx, cb0[157].wwww, l(0.0)
''' + body)


class SkinSemantics(unittest.TestCase):
    def test_camera_and_bounds_are_distinct_source_inputs(self):
        sliced = Slice(skin_program('''
ld_structured_indexable(structured_buffer, stride=16)(mixed,mixed,mixed,mixed) r0.xyz, l(19), l(0), t0.xyzx
'''), [], {}, skin_surface=True)
        _, _, report = sliced.emit()
        geometry = [dict(position=[1,2,3], objectPosition=[4,5,6], view=[0,3,4])] * 4
        actual = evaluate_quad(sliced, None, [0]*4, geometry)
        np.testing.assert_array_equal(actual['normal'], [[4,5,6]]*4)
        np.testing.assert_allclose(actual['subsurfaceColor'], [[0,.6,.8]]*4, atol=1e-7)
        self.assertEqual(report['geometryFrame'], 'source-world')
        self.assertIn('subsurface lighting', report['excludedOutputs'])

    def test_unknown_live_primitive_record_or_radius_is_rejected(self):
        for index, mask, swizzle in [(20, 'xyz', 'xyzx'), (19, 'xyz', 'wwww')]:
            program = skin_program(f'ld_structured_indexable(structured_buffer, stride=16)(mixed,mixed,mixed,mixed) r0.{mask}, l({index}), l(0), t0.{swizzle}')
            with self.assertRaises(ValueError):
                Slice(program, [], {}, skin_surface=True).emit()

    def test_camera_anchor_must_be_unique(self):
        program = skin_program('mov r0.xyz, l(1.0)')
        anchor = 'movc r21.xyz, r1.wwww, -cb0[73].xyzx, r2.xyzx'
        for replacement in ['', anchor + '\n' + anchor]:
            with self.assertRaisesRegex(ValueError, 'Expected one skin camera anchor'):
                Slice(program.replace(anchor, replacement), [], {}, skin_surface=True)

    def test_dynamic_indexable_lookup_is_only_allowed_when_dead(self):
        instructions = '''mov x0[0].x, l(0.0)
mov r4.x, x0[r3.x + 0].x
'''
        Slice(surface_program(instructions + 'mov r0.xyz, l(1.0)'), [], {}).emit()
        with self.assertRaisesRegex(ValueError, 'indexable read'):
            Slice(surface_program(instructions + 'mov r0.xyz, r4.xxxx'), [], {}).emit()

    def test_log_is_base_two_of_absolute_value_and_exp_is_base_two(self):
        program = surface_program('''mov r1.xyz, l(-0.5, 4.0, -8.0, 0.0)
log r2.xyz, r1.xyzx
exp r0.xyz, r2.xyzx''')
        sliced = Slice(program, [], {})
        code, _, _ = sliced.emit()
        actual = evaluate_quad(sliced, None, [0]*4, [{}]*4)
        np.testing.assert_array_equal(actual['normal'], [[.5,4,8]]*4)
        self.assertIn('log2(', code)
        self.assertIn('exp2(', code)

    def test_material_sample_bias_survives_codegen(self):
        program = surface_program('sample_b_indexable(texture2d)(float,float,float,float) r0.xyz, v2.xyxx, t3.xyzw, s0, l(-1.5)')
        code, _, _ = Slice(program, [], {'t3': {'array': False}}).emit()
        self.assertIn('texture(u_t3, vec2(uv0.x, uv0.y), -1.5)', code)


if __name__ == '__main__':
    unittest.main()
