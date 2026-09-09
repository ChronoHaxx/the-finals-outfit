"""Validate built instances independently and quarantine failures from activation."""
import argparse
import json
from pathlib import Path
from material_inputs import read_json
from test_translation import check_exports


def check(exports, materials, requests):
    built = {r['itemId'] for r in read_json(materials / 'build-report.json')}
    checks, fixtures, passed, errors = [], [], [], []
    for job in read_json(requests):
        if job['id'] not in built:
            continue
        try:
            result = check_exports(exports, [job], materials)
            cases = read_json(exports / 'translation-fixtures.json')
            checks.extend(result)
            fixtures.extend(cases)
            passed.append(job)
        except Exception as error:
            errors.append({**job, 'error': str(error)})
            print(f'UNVERIFIED {job["instance"]}: {error}')
    for name, value in [('translation-checks.json', checks), ('translation-fixtures.json', fixtures),
                        ('translation-errors.json', errors), ('passed.requests.json', passed)]:
        (exports / name).write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')
    print(f'{len(passed)} materials passed; {len(errors)} quarantined')
    return not errors


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    for name in ('exports', 'materials', 'requests'):
        p.add_argument('--' + name, type=Path, required=True)
    a = p.parse_args()
    if not check(a.exports, a.materials, a.requests):
        raise SystemExit(1)
