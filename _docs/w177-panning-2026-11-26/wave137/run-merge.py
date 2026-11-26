"""Wave 137: one merge.py invocation over the w177 accepted wrapper (2 PanningHologram rows from the provenance-fixed v4
preview). Copy of wave131-merge/run-merge.py with the wave-137 spec and note. Runs after the idle check (idle-check.txt),
with the active index still b164180c (the one the v4 index stage was built on).
  python -I _docs/goal-100-2026-10-11/wave137-merge/run-merge.py NAME"""
import subprocess, sys
from pathlib import Path
name = sys.argv[1]
specs = ['_docs/goal-100-2026-10-11/w177-panning-contract/accepted:../review-v4-captures-main']
note = ('Wave 137 full-size review (26 Nov 2026, w177 PanningHologram, preview v4 on current main 963d906): the translucent '
        'Ospuze sports jacket matches its icon at every angle, its hem tabs read as the PopPour decal with no pixel grid; the '
        'vaporwave glasses CNS lens pans its rainbow gradient, 20x BaseIntensity does not clip white (more saturated than the '
        "icon's pastel, recorded not tuned). Manifests record the admitted 17 Nov wrapper (rawSha256 ab1af562, qualified "
        'c2bad042). 0 capture errors. Runtime: PR #74 (merged 22 Nov).')
log = Path(f'_docs/goal-100-2026-10-11/wave137-merge/{name}.log')
if log.exists(): raise SystemExit(f'Preserve {log}')
r = subprocess.run(['C:/ProgramData/anaconda3/python.exe', '-X', 'utf8', '-I', '_docs/goal-100-2026-10-11/merge.py', name, note, *specs],
                   capture_output=True, text=True, encoding='utf-8', errors='replace')
log.write_text(r.stdout + '\n--- stderr ---\n' + r.stderr + f'\nexit {r.returncode}\n', encoding='utf-8')
print(r.stdout[-3000:]); print(r.stderr[-3000:]); print('exit', r.returncode)
