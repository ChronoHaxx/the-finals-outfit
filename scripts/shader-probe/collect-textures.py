"""Resolve selected material texture bindings through their parent chains.

Collect all bound textures so extraction can run before material slicing. The
builder subsequently drops dependencies unused by the ordinary coat surface.
"""
import argparse
import json
from pathlib import Path
from material_inputs import material_inputs, texture_paths


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def collect(exports, requests=None, keep_going=False):
    paths, errors = set(), []
    for item_id, instance, owner, chain in material_inputs(exports, requests):
        try:
            bindings = read_json(exports / "bindings" / (owner + ".SP_PCD3D_SM5.basepass-pixel.bindings.json"))
            resolved = [path for _, path in texture_paths(chain, bindings)]
            paths.update(resolved)
        except Exception as error:
            if not keep_going: raise
            errors.append({'itemId': item_id, 'instance': instance, 'error': str(error)})
            print(f'UNSUPPORTED {instance}: {error}')
    return sorted(paths), errors


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exports", type=Path, required=True)
    parser.add_argument("--requests", type=Path)
    parser.add_argument("--keep-going", action="store_true", help="Record unsupported bindings and collect the remaining materials; exit nonzero if any fail")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    generated = Path(__file__).resolve().parents[1] / "generated"
    if not args.output.resolve().is_relative_to(generated):
        parser.error("Texture requests must stay under scripts/generated")
    paths, errors = collect(args.exports, args.requests, args.keep_going)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(paths, indent=2) + "\n", encoding="utf-8")
    args.output.with_suffix('.errors.json').write_text(json.dumps(errors, indent=2) + "\n", encoding="utf-8")
    print(f"Resolved {len(paths)} bound texture objects to {args.output}")
    if errors: raise SystemExit(1)
