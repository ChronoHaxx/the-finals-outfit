"""Source package identity: exact paths, plus one narrow case the engine resolves - directory capitalisation.

A requested object '/Game/<dirs>/<Name>.<Name>' names the exported package 'Discovery/Content/<dirs>/<Name>.uasset'.
Package lookup in the game ignores case, so a mesh slot or material parent may spell a directory differently
from the exported pak entry. Such a reference is accepted only when exactly one exported package has the same
full path ignoring case, its basename and object name are identical, and no other export shares its basename
ignoring case (working exports are stored by basename). Every other difference stays rejected: another
directory, package or object name, a case-only basename difference, a malformed path, or several exports that
fold to one path - even when one of them matches exactly. Pure: no files, no side effects.
"""

GAME, CONTENT, SUFFIX = '/Game/', 'Discovery/Content/', '.uasset'
EXACT, DIRECTORY_CASE = 'exact', 'directory-case'
NOT_EXPORTED = 'Exact source package is not in the working export'


def _parts(path, what, original):
    parts = path.split('/')
    if any(p in ('', '.', '..') or '\\' in p or p != p.strip() for p in parts) or '.' in parts[-1]:
        raise ValueError(f'Malformed {what}: {original!r}')
    return parts


def package_parts(package):
    """'Discovery/Content/A/B/X.uasset' -> ['A', 'B', 'X']."""
    if not isinstance(package, str) or not package.startswith(CONTENT) or not package.endswith(SUFFIX):
        raise ValueError(f'Malformed package path: {package!r}')
    return _parts(package[len(CONTENT):-len(SUFFIX)], 'package path', package)


def object_parts(object_path):
    """'/Game/A/B/X.Y' -> (['A', 'B', 'X'], 'Y')."""
    if not isinstance(object_path, str) or not object_path.startswith(GAME) or '.' not in object_path:
        raise ValueError(f'Malformed object path: {object_path!r}')
    package, name = object_path[len(GAME):].rsplit('.', 1)
    if not name or name != name.strip() or '/' in name:
        raise ValueError(f'Malformed object path: {object_path!r}')
    return _parts(package, 'object path', object_path), name


def canonical_object(package):
    """The object path build-assembly-assets.object_path gives an exported package."""
    parts = package_parts(package)
    return GAME + '/'.join(parts) + '.' + parts[-1]


def requested_package(object_path):
    parts, name = object_parts(object_path)
    if name != parts[-1]:
        raise ValueError(f'Object name differs from its package name: {object_path}')
    return CONTENT + '/'.join(parts) + SUFFIX


def match(requested, exported):
    """EXACT, or DIRECTORY_CASE when only ASCII capitalisation of directories differs; otherwise ValueError."""
    if requested == exported:
        package_parts(exported)
        return EXACT
    a, b = package_parts(requested), package_parts(exported)
    if a[-1] != b[-1]:
        raise ValueError(f'Package name differs from the exported package: {requested} != {exported}')
    if len(a) != len(b) or any(x != y and not (x.isascii() and y.isascii() and x.lower() == y.lower())
                               for x, y in zip(a[:-1], b[:-1])):
        raise ValueError(f'Package directory differs from the exported package: {requested} != {exported}')
    return DIRECTORY_CASE


def _basename(path):
    return path.rsplit('/', 1)[-1].removesuffix(SUFFIX)


def resolve(object_path, inventory):
    """The one exported package a requested object path names, checked against the full export inventory.

    inventory lists every exported package path, before any basename dictionary could hide a collision.
    Returns {'match', 'package', 'object'}: the actual package and its canonical object path.
    """
    package = requested_package(object_path)
    folded, name = package.casefold(), package_parts(package)[-1].casefold()
    candidates = sorted({p for p in inventory if p.casefold() == folded})
    if not candidates:
        raise ValueError(NOT_EXPORTED)
    if len(candidates) > 1:
        raise ValueError(f'Package path is ambiguous ignoring case: {candidates}')
    actual, = candidates
    kind = match(package, actual)
    namesakes = sorted({p for p in inventory if _basename(p).casefold() == name})
    if namesakes != [actual]:
        raise ValueError(f'Package name is not unique in the export: {namesakes}')
    return {'match': kind, 'package': actual, 'object': canonical_object(actual)}


def parent_link(link, parent_package):
    """A decoded Parent ObjectPath ('/Game/A/X.0' or '/Game/A/X.X') must name its decoded parent's package."""
    parts, name = object_parts(link)
    if name != parts[-1] and not (name.isascii() and name.isdigit()):
        raise ValueError(f'Parent link names another object: {link}')
    return match(CONTENT + '/'.join(parts) + SUFFIX, parent_package)


def chain_identity(chain, inventory):
    """Every decoded chain member (root first) resolved against the inventory; every parent link against its parent.

    Parent-chain walks are by basename; this rejects a link into another directory even when the basename matches.
    """
    members = []
    for index, record in enumerate(chain):
        found = resolve(record['Package'] + '.' + record['Name'], inventory)
        link = ((record.get('Properties') or {}).get('Parent') or {}).get('ObjectPath')
        if index == 0:
            if link:
                raise ValueError(f'Chain root {record["Name"]} has a parent')
            parent = None
        else:
            if not link:
                raise ValueError(f'Chain member {record["Name"]} has no parent link')
            parent = {'object': link, 'match': parent_link(link, members[-1]['package'])}
        members.append({'object': record['Package'] + '.' + record['Name'], 'package': found['package'],
                        'exportedObject': found['object'], 'match': found['match'], 'parent': parent})
    return members


def requested_keys(materials, resolution, inventory):
    """Rename index keys built from exported packages back to the requested source, for verified rows only.

    Only a resolution row recording a directory-case match that still resolves identically against the
    inventory renames its canonical key; every other key, including every exact one, is kept as is.
    """
    renames = {}
    for row in resolution:
        evidence = row.get('sourcePackage')
        if 'error' in row or not evidence:
            continue
        found = resolve(row['source'], inventory)
        if found['match'] != DIRECTORY_CASE or evidence.get('match') != DIRECTORY_CASE \
                or evidence.get('requested', {}).get('object') != row['source'] \
                or {k: evidence.get('actual', {}).get(k) for k in ('package', 'object')} != \
                {k: found[k] for k in ('package', 'object')}:
            raise ValueError(f'Recorded directory-case resolution no longer holds: {row["source"]}')
        if renames.setdefault(found['object'], row['source']) != row['source']:
            raise ValueError(f'Two requested sources resolve to {found["object"]}')
    requested = {row['source'] for row in resolution}
    out = {}
    for key, value in materials.items():
        target = renames.get(key, key)
        if target in out or (target != key and key in requested):
            raise ValueError(f'Index keys collide for requested source {target}')
        out[target] = value
    return out
