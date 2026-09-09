"""Record the still-view smoothing checkpoint separately from source recovery."""
import hashlib
import json
from pathlib import Path

visual = Path('visual-diff/reconstructed/reference-temporal-01')
out = Path('scripts/generated/shader-probe/reference-temporal-01')
out.mkdir(parents=True, exist_ok=True)
read = lambda path: json.loads(Path(path).read_text(encoding='utf-8'))
files = {
    'temporalGpu': visual / 'temporal-gpu.json',
    'temporalViewer': visual / 'viewer-checks.json',
    'hairRigRegression': Path('visual-diff/reconstructed/reference-hair-01/hair-rig-checks.json'),
    'skinPairRegression': visual / 'skin-pair-regression/skin-pair-checks.json',
    'assemblyRegression': Path('visual-diff/reconstructed/assembly-batch-01/checks.json'),
    'integrationRegression': Path('visual-diff/reconstructed/integration-checks.json'),
}
reports = {key: read(path) for key, path in files.items()}
for key, report in reports.items():
    rows = report['checks'] if isinstance(report, dict) else report
    if not rows or any(row.get('passed') is False for row in rows):
        raise ValueError('Missing/failed validation: ' + key)
    if isinstance(report, dict) and report.get('errors'):
        raise ValueError('Browser errors: ' + key)
index = read('public/models/reconstructed-assemblies-v1/assets.json')
items = read('public/models/reconstructed-assemblies-v1/supported-items.json')['ready']
gpu, viewer = reports['temporalGpu'], reports['temporalViewer']
partial = [r for r in gpu['coverage'] if 0 < r['opacity'] < 1]
drag = next(r for r in viewer['checks'] if r['name'].startswith('OrbitControls'))
sources = [Path(p) for p in [
    'src/rig/StableFrameAccumulator.ts', 'src/rig/StableFrameState.ts',
    'src/rig/StableCamera.ts', 'src/components/StablePreview.tsx', 'src/components/CharacterViewer.tsx',
]]
summary = {
    'formatVersion': 1, 'date': '2026-09-08',
    'scope': 'Shared still-view accumulation for recovered hair and lashes. Preview policy; not recovered native TAA or motion reprojection.',
    'counts': {
        'clothingAssemblies': sum(r['slot'] != 'hair' for r in items),
        'hairAssemblies': sum(r['slot'] == 'hair' for r in items),
        'validatedBaseMaterialInstances': len(index['materials']),
        'validatedParameterVariants': len(index['materialVariants']),
        'activePreservedMeshes': len(index['meshes']),
        'partialHeadBodyPairs': 1, 'recoveredHeadSections': 5, 'totalHeadSections': 7,
    },
    'policy': {
        'samples': 32, 'sceneSamplesPerFrame': 1, 'targets': 2,
        'targetFormats': 'RGBA16F sample with depth; RGBA16F accumulated colour without depth',
        'colour': 'Linear HDR average, unpremultiply covered colour, one display tone/transfer transform, premultiply for canvas',
        'cameraTolerancePhysicalPixels': .125,
        'cameraPolicy': 'Whole-frustum bound against retained camera; all accumulated samples use that one camera; cumulative movement resets it',
        'historyPolicy': 'New camera/pose/morph/geometry/material/texture/light/visibility/outfit/display inputs discard the previous history',
        'activation': 'Recovered lit preview with visible reconstructed alpha-hashed surfaces; temporal=0 disables it',
        'fallbacks': ['Raw surface and albedo calibration views', 'No visible recovered masked surface', 'XR or missing float colour-buffer support'],
    },
    'validation': {
        'newGpuChecks': len(gpu['checks']), 'newViewerChecks': len(viewer['checks']),
        'coverageVarianceReductionRange': [min(r['varianceReduction'] for r in partial), max(r['varianceReduction'] for r in partial)],
        'coverageMeanMaximumError': max(abs(r['averaged']['mean'] - r['opacity']) for r in gpu['coverage']),
        'displayColourMaximumError': max(r['maxError'] for r in gpu['display']),
        'layeredCoverageAndColour': gpu['layered'], 'partialSilhouettePixelsAcrossTwoEdges': gpu['partialEdgePixels'],
        'actualDragToSettledMs': drag['elapsedMs'], 'actualDragHistoryResets': drag['movementResets'],
        'dragTimingQualification': 'One local headless Edge run; not a device-independent performance guarantee',
        'capturedViews': len(viewer['captures']),
    },
    'regressions': {key: len(value) for key, value in reports.items() if key.endswith('Regression')},
    'additionalChecks': {'typeScriptProjectBuild': 'passed', 'productionJsCssBundle': 'passed, 647 modules; existing bundle-size warning'},
    'evidence': {key: {'file': path.as_posix(), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()} for key, path in files.items()},
    'sourceFiles': {p.as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in sources},
    'reference': 'https://threejs.org/docs/pages/TAARenderPass.html',
    'remaining': [
        'Moving views intentionally restart without old samples; motion-reprojected TAA is not implemented',
        'Native hair volume shadows and pixel depth offset',
        'Additional hair/scalp colour variants and contributor priority',
        'Eye-shell/eye-edge layers, skin scattering and native opacity',
        'Head/neck wrap and seam, native body/garment culling and other body archetypes',
        'Matched in-game validation and broader catalog coverage',
    ],
}
(out / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n', encoding='utf-8')
print(json.dumps({key: summary[key] for key in ['counts', 'validation', 'regressions']}, indent=2))
