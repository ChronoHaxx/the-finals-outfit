import struct
import unittest
from nail_sampler import effective_nail_sampler, apply_nail_sampler


def resource_table(view_hash=0xC873DB14, resource=0):
    # View cb0 binds resource0 to s0 and resource1 to s1; material textures are cb3.
    arrays = [[], [4, 0, 0, 0, resource << 8, 257, 0xFFFFFFFF], [],
              [view_hash, 0, 0, 123], [], []]
    return struct.pack('<I', 9) + b''.join(struct.pack('<I', len(a)) +
           struct.pack('<'+'I'*len(a), *a) for a in arrays) + b'DXBC'


ASM = 'sample_indexable [precise](texture2d)(float,float,float,float) r8.xyzw, r8.xyxx, t2.xyzw, s0'


class EffectiveNailSampler(unittest.TestCase):
    def test_actual_shader_binding_overrides_clamped_texture_metadata(self):
        actual = apply_nail_sampler({'wrapS': 'TA_Clamp', 'wrapT': 'TA_Clamp'},
                                   effective_nail_sampler(resource_table(), ASM, 't2'))
        self.assertEqual((actual['wrapS'], actual['wrapT']), ('TA_Wrap', 'TA_Wrap'))
        self.assertEqual(actual['textureAddressMode']['wrapT'], 'TA_Clamp')

    def test_no_blanket_wrapping_or_metadata_churn(self):
        sampler = effective_nail_sampler(resource_table(), ASM.replace('s0', 's1'), 't2')
        entry = {'wrapS': 'TA_Clamp', 'wrapT': 'TA_Clamp'}
        self.assertIs(apply_nail_sampler(entry, sampler), entry)

    def test_unknown_layout_sampler_and_multiple_sampler_reads_fail_closed(self):
        for raw, asm in [(resource_table(view_hash=1), ASM),
                         (resource_table(resource=7), ASM),
                         (resource_table(), ASM+'\n'+ASM.replace('s0', 's1'))]:
            with self.subTest(asm=asm), self.assertRaises(ValueError):
                effective_nail_sampler(raw, asm, 't2')
