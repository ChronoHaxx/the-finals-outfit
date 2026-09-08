"""Small instruction regressions independent of extracted game data."""
import unittest

import numpy as np

from sm5_slice import Slice
from test_translation import evaluate_nodes, forward


def surface_program(body, normal='r0.xyzx'):
    return f'''ps_5_0
{body}
mul r8.xyz, {normal}, cb0[159].wwww
mov r7.xyzw, l(0.5, 1.0, 0.4, 0.0)
mul r9.x, r7.x, l(0.080000)
mad o2.z, r7.zzzz, l(1.000000), l(0.000000)
mad_sat r9.y, r7.yyyy, cb0[160].wwww, l(0.000000)
mov o3.xyz, r7.xyzx
mov o2.x, l(0.000000)
'''


class InstructionSemantics(unittest.TestCase):
    def test_sincos_reads_before_either_destination_write(self):
        program = '''mov r0.x, l(1.570796)
sincos r0.x, r1.x, r0.x
mov o3.x, r0.x
mov o3.y, r1.x
mov o3.z, l(0.000000)
mov o2.x, l(0.000000)
'''
        result = forward(program, [], None, [0, 0, 0, 0])
        np.testing.assert_allclose(result['baseColor'], [1, 0, 0], atol=1e-6)

    def test_cloth_camera_preserves_mask_and_swizzle(self):
        for mask, camera, result_swizzle in [('xyz', 'xyzx', 'xyzx'),
                                              ('xyw', 'xyxz', 'xywx'),
                                              ('xzw', 'xxyz', 'xzwx')]:
            with self.subTest(mask=mask):
                program = surface_program(f'''mov r0.xyzw, l(0.5, 0.5, 0.5, 1.0)
add r15.xyz, r0.xyzx, -cb0[122].xyzx
add r1.{mask}, -r0.{camera}, cb0[122].{camera}''', f'r1.{result_swizzle}')
                sliced = Slice(program, [], {}, view_dependent=True)
                sliced.emit()
                expected = [2, 3, 5]
                actual = evaluate_nodes(sliced, None, [0]*4, expected)
                original = forward(program, [], None, [0]*4, expected)
                np.testing.assert_array_equal(actual['normal'], expected)
                np.testing.assert_array_equal(original['normal'], expected)

    def test_repeated_camera_component_is_rejected(self):
        program = surface_program('add r0.xyz, -r1.xyzx, cb0[122].xyyx')
        with self.assertRaisesRegex(ValueError, 'Invalid cloth camera anchor'):
            Slice(program, [], {}, view_dependent=True)

    def test_rectangular_texture_dimensions_affect_surface(self):
        program = surface_program('''resinfo_indexable(texture2d)(float,float,float,float) r0.xyzw, l(0), t3.xyzw
div r0.x, r0.x, r0.y
div r0.y, r0.y, l(512.000000)''')
        info = {'t3': {'width': 512, 'height': 256, 'depth': 1, 'mipCount': 10, 'array': False}}
        original = forward(program, [], lambda *args: [512, 256, 1, 10], [0]*4)
        actual = evaluate_nodes(Slice(program, [], info), None, [0]*4)
        np.testing.assert_array_equal(original['normal'], [2, .5, 1])
        np.testing.assert_array_equal(actual['normal'], original['normal'])


if __name__ == '__main__':
    unittest.main()
