"""Parameter activations must keep the recipient's identity and permutation."""
import json
import tempfile
import unittest
from pathlib import Path
from material_inputs import material_inputs, texture_paths, static_parameters


class ParameterOverrides(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.info = lambda name: {'Name': name, 'Index': -1, 'Association': 'GlobalParameter'}
        self.write('M_Face', None, cached={'ReferencedTextures': [{'ObjectPath': '/Game/Default.0'}]})
        self.write('Parent', 'M_Face', ScalarParameterValues=[self.value('Skin', 1)],
                   StaticParametersRuntime=self.switch(True))
        self.write('Face', 'Parent', ScalarParameterValues=[self.value('Skin', 2)])
        self.write('Scalp', 'Parent', ScalarParameterValues=[self.value('Hair', .25)],
                   TextureParameterValues=[self.value('HairTexture', {'ObjectPath': '/Game/Scalp.0'})],
                   StaticParametersRuntime=self.switch(True))
        (self.root / 'Parent.SP_PCD3D_SM5.uniforms.json').write_text('{}')

    def switch(self, value):
        return {'StaticSwitchParameters': [{'ParameterInfo': self.info('UseHair'), 'bOverride': True, 'Value': value}]}

    def value(self, name, value):
        return {'ParameterInfo': self.info(name), 'ParameterValue': value}

    def write(self, name, parent, cached=None, **properties):
        if parent: properties['Parent'] = {'ObjectPath': '/Game/' + parent + '.0'}
        record = {'Name': name, 'Package': '/Game/' + name, 'Properties': properties}
        if cached: record['CachedExpressionData'] = cached
        (self.root / (name + '.json')).write_text(json.dumps([record]))

    def run_job(self, overlays=None):
        return list(material_inputs(self.root, [{'id': 'test', 'instance': 'Face', 'parameterOverrides': overlays or ['Scalp']}]))[0]

    def test_only_explicit_dynamic_values_are_copied(self):
        _, instance, owner, chain = self.run_job()
        self.assertEqual((instance, owner), ('Face', 'Parent'))
        values = {p['ParameterInfo']['Name']: p['ParameterValue'] for m in chain for p in m['Properties'].get('ScalarParameterValues', [])}
        self.assertEqual(values, {'Skin': 2, 'Hair': .25})
        self.assertNotIn('StaticParametersRuntime', chain[-1]['Properties'])
        self.assertEqual(list(texture_paths(chain, {'textureBindings': [{'slot': 't1', 'parameter': 'HairTexture', 'defaultTextureIndex': 0}]})),
                         [('t1', '/Game/Scalp.0')])

    def test_donor_static_switch_does_not_replace_recipient_shader(self):
        self.write('Scalp', 'Parent', StaticParametersRuntime=self.switch(False), ScalarParameterValues=[self.value('Hair', .5)])
        _, instance, owner, chain = self.run_job()
        self.assertEqual((instance, owner), ('Face', 'Parent'))
        self.assertEqual(next(iter(static_parameters(chain).values())), {'Value': True})
        self.assertNotIn('StaticParametersRuntime', chain[-1]['Properties'])
        self.assertEqual(chain[-1]['Properties']['ScalarParameterValues'][0]['ParameterValue'], .5)

    def test_ordered_colour_override_keeps_scalp_texture_and_skin(self):
        self.write('Colour', 'Parent', ScalarParameterValues=[self.value('Hair', .8)])
        _, _, owner, chain = self.run_job(['Scalp', 'Colour'])
        values = {p['ParameterInfo']['Name']: p['ParameterValue'] for m in chain for p in m['Properties'].get('ScalarParameterValues', [])}
        self.assertEqual(values, {'Skin': 2, 'Hair': .8})
        self.assertEqual(owner, 'Parent')
        self.assertEqual(list(texture_paths(chain, {'textureBindings': [{'slot': 't1', 'parameter': 'HairTexture', 'defaultTextureIndex': 0}]})),
                         [('t1', '/Game/Scalp.0')])

    def test_foreign_root_is_rejected(self):
        self.write('M_Skin', None)
        self.write('Scalp', 'M_Skin', StaticParametersRuntime=self.switch(True))
        with self.assertRaisesRegex(ValueError, 'different material root'): self.run_job()

    def test_repeated_override_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Repeated'): self.run_job(['Scalp', 'Scalp'])


if __name__ == '__main__': unittest.main()
