"""Summarize validated colour compositions and their complete viewer integration."""
import hashlib
import json
from pathlib import Path
from material_inputs import read_json

out = Path('scripts/generated/shader-probe/reference-hair-variants-01')
visual = Path('visual-diff/reconstructed/reference-hair-variants-01')
files = {
    'cpu': out / 'exports/translation-checks.json', 'gpu': out / 'webgl-checks.json',
    'variantViewer': visual / 'checks.json',
    'hairRigRegression': Path('visual-diff/reconstructed/reference-hair-01/hair-rig-checks.json'),
    'skinPairRegression': visual / 'skin-pair-regression/skin-pair-checks.json',
    'assemblyRegression': Path('visual-diff/reconstructed/assembly-batch-01/checks.json'),
    'visibilityRegression': Path('visual-diff/reconstructed/source-assembly-checks.json'),
    'integrationRegression': Path('visual-diff/reconstructed/integration-checks.json'),
}
reports = {key: read_json(path) for key, path in files.items()}
for key, report in reports.items():
    rows = report['checks'] if isinstance(report, dict) else report
    if not rows or any(row.get('passed') is False or row.get('error') for row in rows): raise ValueError('Invalid evidence: ' + key)
    if isinstance(report, dict) and report.get('errors'): raise ValueError('Browser errors: ' + key)
index = read_json(Path('public/models/reconstructed-assemblies-v1/assets.json'))
ready = read_json(Path('public/models/reconstructed-assemblies-v1/supported-items.json'))['ready']
variants = read_json(out / 'variants.json')
source_files = [Path(p) for p in ['src/rig/SourceAssembly.ts', 'src/rig/CharacterRig.ts', 'src/components/CharacterViewer.tsx',
                                  'scripts/shader-probe/material_inputs.py', 'scripts/shader-probe/prepare-hair-variants.py']]
summary = {
    'formatVersion': 1, 'date': '2026-09-09',
    'scope': 'Six source Afro Fade colour options with paired scalp compositions, shared rendering and atomic appearance swaps. Preview lighting and ordering policy; not native game parity.',
    'counts': {
        'sourceItems': len(ready), 'clothingAssemblies': sum(r['slot'] != 'hair' for r in ready),
        'afroFadeOptionsIncludingBase': sum(r['slot'] == 'hair' for r in ready),
        'activePreservedMeshes': len(index['meshes']), 'baseMaterialInstances': len(index['materials']),
        'parameterCompositions': len(index['materialVariants']), 'newCompositions': len(variants) * 2,
        'partialHeadBodyPairs': 1, 'recoveredHeadSections': 5, 'totalHeadSections': 7,
    },
    'validation': {
        'cpuQuads': sum(r['cases'] for r in reports['cpu']), 'cpuMaxError': max(r['maxAbsoluteError'] for r in reports['cpu']),
        'gpuQuads': sum(r['cases'] for r in reports['gpu']), 'gpuMaxError': max(r['maxAbsoluteError'] for r in reports['gpu']),
        'sourceAndViewerChecks': len(reports['variantViewer']['checks']), 'parameterUnitTests': 5,
        'matchedColourCaptures': len(reports['variantViewer']['captures']),
        'typeScriptProjectBuild': 'passed', 'productionJsCss': 'passed; 647 modules; existing bundle-size warning',
    },
    'regressions': {key: len(value) for key, value in reports.items() if key.endswith('Regression')},
    'variants': variants,
    'policy': {
        'parameterValues': 'Copy only explicit scalar/vector/texture overrides, preserving recipient shader and inherited recipient defaults',
        'donorStatics': 'Not copied; donor static differences do not substitute a different compiled shader',
        'withinItemOrder': 'Authored activation array order, last applicable value wins; a bounded preview inference, not native execution-order proof',
        'crossItemPriority': 'Rejected; only exact indexed ordered compositions from one contributor are accepted',
        'appearanceSwap': 'Stage changed hair and head/scalp before any commit; failures and cancellations retain the previous pair',
    },
    'reference': 'https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/Engine/Materials/UMaterialInstanceDynamic/CopyParameterOverrides?application_version=5.5',
    'evidence': {key: {'file': path.as_posix(), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()} for key, path in files.items()},
    'sourceFiles': {path.as_posix(): hashlib.sha256(path.read_bytes()).hexdigest() for path in source_files},
    'comparison': (visual / 'colour-variants.png').as_posix(),
    'remaining': ['Translucent eye-shell/eye-edge surfaces and skin scattering', 'Head/neck wrap and visible seam',
                  'Native garment/body culling, other body archetypes and catalog expansion',
                  'Native motion-reprojected TAA, hair volume shadows and pixel depth offset',
                  'Native parameter contributor priority and matched in-game appearance'],
}
(out / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n', encoding='utf-8')
print(json.dumps({key: summary[key] for key in ['counts', 'validation', 'regressions']}, indent=2))
