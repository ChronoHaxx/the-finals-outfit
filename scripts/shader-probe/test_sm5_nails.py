"""Compiler-folded material defaults observed in M_CharacterNails_Base, independent of game data.

The nail master leaves Normal, Specular and AmbientOcclusion unconnected. The compiler then folds
the defaults into the engine's own instructions instead of emitting the material values that the
clothing anchors read: the tangent normal (0,0,1) becomes the multiplier of the view override, AO
1 becomes add_sat of two view constants, and Specular 0.5 becomes the 0.04 = 0.08 * 0.5 literal
of F0 = lerp(0.08 * Specular, BaseColor, Metallic). These programs keep the observed shapes,
including both multiply operand orders seen in the two nail permutations.
"""
import unittest

import numpy as np

from sm5_slice import Slice
from test_translation import evaluate_nodes, forward

BASE_FIRST = 'mul r4.xyw, r4.xyxw, r7.xxxx'   # M_CharacterNails_Base
METAL_FIRST = 'mul r4.xyw, r7.xxxx, r4.xyxw'  # its UseColorTexture permutation


def nail_program(f0_mul=BASE_FIRST, f0_base='r6.xyxw', extra=''):
    return f'''ps_5_0
mul r6.xyz, cb0[159].wwww, l(0.000000, 0.000000, 1.000000, 0.000000)
add r6.xyz, r6.xyzx, cb0[159].xyzx
mov r5.w, l(0.300000)
mov r6.xyw, l(0.200000, 0.400000, 0.000000, 0.600000)
mov r9.xyzw, l(0.700000, 0.700000, 0.700000, 0.700000)
mov r7.x, l(0.250000)
mov r8.x, l(0.900000)
{extra}
mad o2.z, r5.w, cb0[160].y, cb0[160].x
add_sat r2.w, cb0[160].z, cb0[160].w
add r4.xyw, {f0_base}, l(-0.040000, -0.040000, 0.000000, -0.040000)
{f0_mul}
add r4.xyw, r4.xyxw, l(0.040000, 0.040000, 0.000000, 0.040000)
mov o2.x, r7.x
mov o3.xyz, r6.xywx
'''


class FoldedNailDefaults(unittest.TestCase):
    def surfaces(self, program):
        sliced = Slice(program, [], {})
        sliced.emit()
        return evaluate_nodes(sliced, None, [0] * 4), forward(program, [], None, [0] * 4)

    def test_folded_normal_specular_and_ao_in_both_multiply_orders(self):
        for order in (BASE_FIRST, METAL_FIRST):
            with self.subTest(order=order):
                sliced, original = self.surfaces(nail_program(order))
                for name, value in [('normal', [0, 0, 1]), ('specular', [0.5]), ('ao', [1]),
                                    ('baseColor', [0.2, 0.4, 0.6]), ('metalness', [0.25]), ('roughness', [0.3])]:
                    np.testing.assert_allclose(sliced[name], value, rtol=0, atol=1e-7, err_msg=name)
                    np.testing.assert_allclose(original[name], value, rtol=0, atol=1e-7, err_msg=name)

    def test_folded_f0_must_read_the_emitted_base_colour(self):
        with self.assertRaisesRegex(ValueError, 'specular'):
            Slice(nail_program(f0_base='r9.xyxw'), [], {})

    def test_folded_f0_must_weight_by_the_emitted_metalness(self):
        with self.assertRaisesRegex(ValueError, 'specular'):
            Slice(nail_program('mul r4.xyw, r4.xyxw, r8.xxxx'), [], {})

    def test_a_connected_specular_beside_the_folded_literal_is_ambiguous(self):
        with self.assertRaisesRegex(ValueError, 'Ambiguous specular anchor'):
            Slice(nail_program(extra='mul r9.x, r5.w, l(0.080000)'), [], {})

    def test_an_incomplete_f0_sequence_is_not_a_specular_anchor(self):
        program = nail_program().replace('add r4.xyw, r4.xyxw, l(0.040000, 0.040000, 0.000000, 0.040000)',
                                         'add r4.xyw, r4.xyxw, l(0.050000, 0.050000, 0.000000, 0.050000)')
        with self.assertRaisesRegex(ValueError, 'Missing surface anchors'):
            Slice(program, [], {})


if __name__ == '__main__':
    unittest.main()
