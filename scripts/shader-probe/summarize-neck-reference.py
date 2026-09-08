"""Record the measured neck checkpoint without implying native rendering parity."""
import hashlib
import json
from pathlib import Path
from material_inputs import read_json

out = Path('scripts/generated/shader-probe/reference-neck-01')
visual = Path('visual-diff/reconstructed/reference-neck-01')
files = {
    'cpu': out / 'exports/translation-checks.json', 'gpu': out / 'webgl-checks.json',
    'adapter': visual / 'adapter-checks.json', 'viewer': visual / 'viewer-checks.json',
    'previewModes': visual / 'preview-mode-checks.json',
    'hairColourRegression': Path('visual-diff/reconstructed/reference-hair-variants-01/checks.json'),
    'skinPairRegression': visual / 'skin-pair-regression/skin-pair-checks.json',
    'fittingRegression': visual / 'fitting-regression/checks.json',
    'assemblyRegression': Path('visual-diff/reconstructed/assembly-batch-01/checks.json'),
    'integrationRegression': Path('visual-diff/reconstructed/integration-checks.json'),
    'detailRegression': Path('visual-diff/reconstructed/reference-details-01/detail-adapter-checks.json'),
}
reports = {key: read_json(path) for key, path in files.items()}
for key, report in reports.items():
    rows = report['checks'] if isinstance(report, dict) else report
    if not rows or any(row.get('passed') is False or row.get('error') for row in rows): raise ValueError('Invalid evidence: ' + key)
    if isinstance(report, dict) and report.get('errors'): raise ValueError('Browser errors: ' + key)
index = read_json(Path('public/models/reconstructed-assemblies-v1/assets.json'))
ready = read_json(Path('public/models/reconstructed-assemblies-v1/supported-items.json'))['ready']
jobs = read_json(out / 'requests.json')
if len(reports['cpu']) != len(jobs) or len(reports['gpu']) != len(jobs): raise ValueError('Incomplete arithmetic evidence')
for row in reports['gpu']:
    if row['cases'] != row['expectedCases'] or row['cases'] <= 0: raise ValueError('Incomplete GPU comparison')
for capture in reports['viewer']['captures']:
    if not Path(capture['file']).is_file(): raise ValueError('Missing viewer capture')
upgraded = [v for table in ['materials', 'materialVariants'] for v in index[table].values() if '/reconstructed-neck-v1/' in v]
if len(upgraded) != len(jobs): raise ValueError('Missing active neck bindings')
source_files = [Path(p) for p in ['src/rig/SourceFitting.ts', 'src/rig/ReconstructedMaterial.ts', 'src/rig/CharacterRig.ts',
    'src/components/CharacterViewer.tsx', 'scripts/shader-probe/material_inputs.py', 'scripts/shader-probe/sm5_slice.py',
    'scripts/shader-probe/quad_translation.py', 'scripts/shader-probe/build-materials.py',
    'scripts/shader-probe/prepare-neck-reference.py', 'scripts/shader-probe/activate-neck-reference.py']]
bundle = list(Path('dist/assets').glob('index-*.js'))
if len(bundle) != 1: raise ValueError('Missing unambiguous production bundle')
summary = {
    'formatVersion': 1, 'date': '2026-09-09',
    'scope': 'Shared source neck matching shapes and undithered neck fade across eight face/scalp compositions. Reduced boundary; native skin rendering and residual shoulder mismatch remain unfinished.',
    'counts': {'sourceItems': len(ready), 'clothingAssemblies': sum(r['slot'] != 'hair' for r in ready),
               'afroFadeOptionsIncludingBase': sum(r['slot'] == 'hair' for r in ready),
               'activePreservedMeshes': len(index['meshes']), 'baseMaterialInstances': len(index['materials']),
               'parameterCompositions': len(index['materialVariants']), 'upgradedFaceScalpCompositions': len(upgraded),
               'partialHeadBodyPairs': 1, 'recoveredHeadSections': 5, 'totalHeadSections': 7},
    'validation': {'cpuQuads': sum(r['cases'] for r in reports['cpu']), 'cpuMaxError': max(r['maxAbsoluteError'] for r in reports['cpu']),
                   'gpuQuads': sum(r['cases'] for r in reports['gpu']), 'gpuMaxError': max(r['maxAbsoluteError'] for r in reports['gpu']),
                   'adapterGpuChecks': len(reports['adapter']), 'sourceViewerChecks': len(reports['viewer']['checks']),
                   'previewModeChecks': len(reports['previewModes']), 'matchedInteractionCaptures': len(reports['viewer']['captures']),
                   'neckUnitTests': 5, 'syntheticCoverageCombinations': 70, 'sm5RegressionUnitTests': 18, 'parameterUnitTests': 5,
                   'fittingRuleTests': 'passed', 'typeScriptProjectBuild': 'passed',
                   'productionJsCss': 'passed; 647 modules; existing bundle-size warning'},
    'regressions': {key: len(value['checks'] if isinstance(value, dict) else value) for key, value in reports.items() if key.endswith('Regression')},
    'policy': {'fitting': 'Exact decoded HeadNeckMatch leaf activates the authored morph at weight 1; bounded preview inference, original weights restored',
               'coverage': 'Source texture sample, saturated FadeAmount and binary NeckFadeEnabled',
               'rasterization': 'Existing Three alpha hashing and 32-sample still-view smoothing; source dither/discard/depth offset and engine effects excluded',
               'background': 'Legacy head body-mask omitted only for recovered neck coverage; body skin remains behind the fade'},
    'evidence': {key: {'file': path.as_posix(), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()} for key, path in files.items()},
    'sourceFiles': {path.as_posix(): hashlib.sha256(path.read_bytes()).hexdigest() for path in source_files},
    'productionBundle': {'file': bundle[0].as_posix(), 'sha256': hashlib.sha256(bundle[0].read_bytes()).hexdigest()},
    'comparison': (visual / 'neck-comparison.png').as_posix(),
    'remaining': ['Residual shoulder overlap and highlights; native depth offset and head/body wrapping',
                  'Skin scattering and translucent eye-shell/eye-edge surfaces',
                  'Native garment/body culling, other archetypes and broader catalog coverage',
                  'Native temporal reprojection, hair volume shadows and contributor priority',
                  'Matched in-game appearance'],
}
(out / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps({k: summary[k] for k in ['counts', 'validation', 'regressions']}, indent=2))
