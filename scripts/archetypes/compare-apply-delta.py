"""Check that a rebuild on a moved index makes exactly the reviewed change (25 Nov 2026).

An archetype build is reviewed as one change to one active index: reviewed = result - active. When another apply lands
first (w177, S12 batch C), the builder runs again on the new active index and its result sha cannot match. What must
match is the change itself:
- every path the rebuild adds, with its value, equals the reviewed change;
- neither change alters or removes anything already active (additive).

A path is a key path into assets.json down to a leaf: a list, a scalar or an empty object. An entry the other apply
changed underneath the reviewed change (for example a mask the Light build derives from) shows up as a value
difference, and the check fails closed.

Usage:
  python -I scripts/archetypes/compare-apply-delta.py <reviewed active> <reviewed result> <new active> <new result>
Exits 0 when the two changes match; otherwise prints the difference and exits 1.
"""
import json, sys


def leaves(value, path=()):
    if isinstance(value, dict) and value:
        for k, v in value.items():
            yield from leaves(v, path + (k,))
    else:
        yield path, json.dumps(value, sort_keys=True)


def change(active, result):
    """(added: {path: value}, altered: [path], removed: [path]) from active to result."""
    a, r = dict(leaves(active)), dict(leaves(result))
    prefixes = {p[:i] for p in r for i in range(1, len(p))}
    added = {p: v for p, v in r.items() if p not in a}
    altered = sorted(p for p, v in r.items() if p in a and a[p] != v)
    # An empty object that the result fills is not a removal.
    removed = sorted(p for p in a if p not in r and not (a[p] == "{}" and p in prefixes))
    return added, altered, removed


def compare(reviewed_active, reviewed_result, new_active, new_result):
    show = lambda paths: [list(p) for p in paths[:5]]
    report, ok = {}, True
    changes = {}
    for name, (act, res) in {"reviewed": (reviewed_active, reviewed_result), "new": (new_active, new_result)}.items():
        added, altered, removed = change(act, res)
        changes[name] = added
        report[name] = {"added": len(added), "altered": len(altered), "removed": len(removed)}
        if altered or removed:
            ok = False
            report[name]["notAdditive"] = show(altered + removed)
    one, two = changes["reviewed"], changes["new"]
    only_reviewed = sorted(set(one) - set(two))
    only_new = sorted(set(two) - set(one))
    differ = sorted(p for p in set(one) & set(two) if one[p] != two[p])
    report["onlyReviewed"], report["onlyNew"], report["valueDiffers"] = len(only_reviewed), len(only_new), len(differ)
    if only_reviewed or only_new or differ:
        ok = False
        report["first"] = {"onlyReviewed": show(only_reviewed), "onlyNew": show(only_new), "valueDiffers": show(differ)}
    report["meshesAdded"] = len({p[1] for p in two if p[0] == "meshes"})
    report["ok"] = ok
    return ok, report


def main():
    if len(sys.argv) != 5:
        sys.exit(__doc__)
    docs = [json.loads(open(f, encoding="utf-8-sig").read()) for f in sys.argv[1:]]
    ok, report = compare(*docs)
    print(json.dumps(report, indent=1))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
