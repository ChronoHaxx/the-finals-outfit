"""Neck coverage boundaries and binding guards, using synthetic SM5 only."""
import unittest
import numpy as np
from material_inputs import neck_fade_inputs
from sm5_slice import Slice
from quad_translation import evaluate_quad, forward_quad
from test_sm5_skin import skin_program


CONFIG = {'texture': 't16', 'amount': 'cb3[0].x', 'enabled': 'cb3[0].y'}
BODY = '''sample_b_indexable(texture2d)(float,float,float,float) r30.y, v2.xyxx, t16.yxzw, s1, l(0.0)
mul_sat r30.z, r30.y, cb3[0].x
add r30.z, r30.z, l(-1.000000)
mad r30.z, cb3[0].y, r30.z, l(1.000000)
mov r0.xyz, l(1.0)
'''
INFO = {'t16': {'array': False, 'width': 2, 'height': 2}}
GEOMETRY = [dict(position=[0,0,0], objectPosition=[0,0,0], view=[0,0,3],
                 normal=[0,0,1], tangent=[1,0,0], handedness=1)] * 4


class NeckFadeSemantics(unittest.TestCase):
    def test_source_channel_gain_saturation_and_enable(self):
        # Non-red values deliberately disagree: this mask is not diffuse alpha.
        for enabled in [0, 1]:
            for amount in [0, .4, 1, 1.625128, 3]:
                constants = [amount, enabled, 0, 0]
                sliced = Slice(skin_program(BODY), constants, INFO, skin_surface=True, neck_fade=CONFIG)
                for red in [-.2, 0, .1, .4, .9, 1, 1.2]:
                    texture = lambda *_: [red, .8, .3, 0]
                    expected = 1 if not enabled else np.clip(np.float32(red)*np.float32(amount), 0, 1)
                    reference = forward_quad(skin_program(BODY), constants, texture, [0]*4, GEOMETRY, [0,0,3],
                                             skin_surface=True, neck_fade=CONFIG)
                    actual = evaluate_quad(sliced, texture, [0]*4, GEOMETRY)
                    np.testing.assert_allclose(actual['opacity'], expected, atol=1e-7)
                    np.testing.assert_array_equal(actual['opacity'], reference['opacity'])

    def test_shadow_slice_has_no_live_geometry_and_keeps_sample_bias(self):
        body = BODY.replace('s1, l(0.0)', 's1, l(-1.5)')
        sliced = Slice(skin_program(body), [1,1,0,0], INFO, skin_surface=True, neck_fade=CONFIG)
        code, textures, report = sliced.emit(['opacity'])
        self.assertEqual(textures, ['t16']); self.assertEqual(report['requiredGeometryFields'], [])
        self.assertIn('texture(u_t16, vec2(uv0.x, uv0.y), -1.5)', code)
        self.assertEqual(report['skinCoverage'], 'neck-fade')

    def test_disabled_fade_drops_unused_texture(self):
        sliced = Slice(skin_program(BODY), [1,0,0,0], INFO, skin_surface=True, neck_fade=CONFIG)
        _, textures, _ = sliced.emit(['opacity']); self.assertEqual(textures, [])

    def test_ambiguous_missing_or_different_source_anchor_rejects(self):
        for body in [BODY+BODY, BODY.replace('mul_sat r30.z, r30.y, cb3[0].x', ''),
                     BODY.replace('t16.yxzw', 't15.yxzw'), BODY.replace('mad r30.z, cb3[0].y, r30.z, l(1.000000)', '')]:
            with self.assertRaises(ValueError):
                Slice(skin_program(body), [1,1,0,0], INFO, skin_surface=True, neck_fade=CONFIG)

    def test_binding_resolution_requires_decoded_texture_and_direct_scalar_fields(self):
        texture = '/Game/Discovery/Characters/Heads/Shared/Textures/T_Face_NeckFade.0'
        chain = [{'Name': 'M_Face', 'Properties': {}, 'CachedExpressionData': {'ReferencedTextures': [{'ObjectPath': texture}]}}]
        bindings = {'textureBindings': [{'slot':'t16', 'parameter':'None', 'defaultTextureIndex':0}],
                    'uniformFields': [{'expression':name, 'type':'Float1', 'floatOffset':i, 'register':reg}
                                      for i, (name, reg) in enumerate([('FadeAmount','cb3[0].x'),('NeckFadeEnabled','cb3[0].y')])]}
        self.assertEqual(neck_fade_inputs(chain, bindings, [1.6,1]), CONFIG)
        for values in [[float('nan'),1],[-1,1],[1,.5],[1,2]]:
            with self.assertRaises(ValueError): neck_fade_inputs(chain, bindings, values)
        bindings['uniformFields'][0]['expression'] = 'GuessedFade'
        with self.assertRaises(ValueError): neck_fade_inputs(chain, bindings, [1,1])


if __name__ == '__main__': unittest.main()
