"""Record measured hair/scalp coverage, provenance and bounded validation results."""
import hashlib
import json
from pathlib import Path
from material_inputs import read_json

out = Path('scripts/generated/shader-probe/reference-hair-01')
visual = Path('visual-diff/reconstructed/reference-hair-01')
index = read_json(Path('public/models/reconstructed-assemblies-v1/assets.json'))
available = read_json(Path('public/models/reconstructed-assemblies-v1/supported-items.json'))
pair = read_json(Path('public/models/reconstructed-assemblies-v1/skin-pairs.json'))['items']['head-face-01-base']
clothing = [r for r in available['ready'] if r['slot'] != 'hair']
hair = [r for r in available['ready'] if r['slot'] == 'hair']
used = {b['source'] for r in available['ready'] for p in r['parts'] for b in p['materials'].values()}
used.update(b['source'] for p in ('head', 'body') for b in pair[p]['materials'].values() if b.get('url'))
files = {
    'scalpCPU': out / 'exports/translation-checks.json',
    'scalpGPU': out / 'webgl-checks.json',
    'hairGPU': visual / 'hair-adapter-checks.json',
    'hairRig': visual / 'hair-rig-checks.json',
    'detailRegression': Path('visual-diff/reconstructed/reference-details-01/detail-adapter-checks.json'),
    'headPairRegression': visual / 'skin-pair-regression/skin-pair-checks.json',
    'assemblyRegression': Path('visual-diff/reconstructed/assembly-batch-01/checks.json'),
    'visibilityRegression': Path('visual-diff/reconstructed/source-assembly-checks.json'),
    'integrationRegression': Path('visual-diff/reconstructed/integration-checks.json'),
    'comparison': visual / 'hair-comparison.json',
}
reports = {key: read_json(path) for key, path in files.items()}
for key, report in reports.items():
    rows = report['checks'] if isinstance(report, dict) else report
    if any(row.get('passed') is False or (isinstance(row.get('error'), str) and row['error']) for row in rows):
        raise ValueError('Failed validation: ' + key)
summary = {
    'formatVersion': 1, 'date': '2026-09-08',
    'scope': 'Base Afro Fade strand-lighting preview, preserved head socket attachment and Face 01 scalp parameter composition. Native game lighting and full reconstruction remain unfinished.',
    'counts': {
        'validatedBaseMaterialInstances': len(index['materials']),
        'validatedParameterVariants': len(index['materialVariants']),
        'clothingAssemblies': len(clothing), 'hairAssemblies': len(hair),
        'clothingPartOccurrences': sum(len(r['parts']) for r in clothing),
        'distinctGarmentMeshes': len({p['sourceMesh'] for r in clothing for p in r['parts']}),
        'activePreservedMeshes': len(index['meshes']),
        'validatedBaseMaterialsOutsideAssembliesAndPair': len(set(index['materials']) - used),
        'partialHeadBodyPairs': 1, 'recoveredHeadSections': 5, 'totalHeadSections': 7,
    },
    'newValidation': {
        'scalpCpuQuads': sum(r['cases'] for r in reports['scalpCPU']),
        'scalpCpuMaxError': max(r['maxAbsoluteError'] for r in reports['scalpCPU']),
        'scalpGpuQuads': sum(r['cases'] for r in reports['scalpGPU']),
        'scalpGpuMaxError': max(r['maxAbsoluteError'] for r in reports['scalpGPU']),
        'hairGpuCases': len(reports['hairGPU']['checks']),
        'hairPublishedEquationMaxError': reports['hairGPU']['maxError'],
        'hairRigCases': len(reports['hairRig']),
        'hairMotionVertices': sum(r.get('vertices', 0) for r in reports['hairRig']),
        'hairMotionMaxError': max(r.get('maxError', 0) for r in reports['hairRig']),
        'parameterOverrideUnitTests': 4,
    },
    'regressions': {key: len(reports[key]) for key in files if key.endswith('Regression')},
    'additionalChecks': {'syntheticSm5Tests': 18, 'typeScript': 'passed', 'productionBundle': 'passed, 641 modules, existing bundle-size warning'},
    'assets': {'hairMaterial': 'public/models/reconstructed-details-v2/hair-afrofade.json',
               'scalpVariant': 'public/models/reconstructed-hair-v1/head-face-01-afrofade.json',
               'attachmentBody': index['attachmentBody']['source'],
               'attachmentBodySha256': index['attachmentBody']['sha256']},
    'lightingReference': {
        'url': 'https://blog.selfshadow.com/publications/s2016-shading-course/karis/s2016_pbs_epic_hair.pdf',
        'sha256': hashlib.sha256((out / 'references/epic-hair-2016.pdf').read_bytes()).hexdigest(),
        'equations': 'Slides 18, 20, 25-29, 32, 39 and 47; shared preview lobe settings, regular Three shadows',
    },
    'evidence': {key: {'file': path.as_posix(), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()} for key, path in files.items()},
    'remaining': ['Temporal smoothing of hair/lash coverage', 'Native hair lighting, exponential volume shadows and pixel depth offset',
                  'Additional hair/scalp colour parameter combinations and contributor priority',
                  'Eye-shell and eye-edge layers', 'Skin scattering and native opacity', 'Head/neck wrap and seam',
                  'Native body/garment culling and other body archetypes', 'Matched in-game validation and broader catalog coverage'],
}
(out / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'counts': summary['counts'], 'newValidation': summary['newValidation'], 'regressions': summary['regressions']}, indent=2))
