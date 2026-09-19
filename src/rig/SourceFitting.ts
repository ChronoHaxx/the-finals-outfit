import type * as THREE from "three";

// Bounded preview rule: these decoded tag groups name authored morphs, plus the
// single exact tag PushJacket.bandolier_squeeze; no other PushJacket leaf is decoded.
// Exact leaf matches activate at full weight. The game's native evaluator,
// wrap deformation, attachment offsets and other shape groups are not recovered.
export function fittingMorphNames(tags: Iterable<string>): Set<string> {
  const result = new Set<string>();
  for (const tag of tags) {
    const match = /^Customization\.Shape\.(?:PushInsideClothes|ShrinkWrap|HeadNeckMatch|PushJacket(?=\.bandolier_squeeze$))\.([A-Za-z0-9_]+)$/.exec(tag);
    if (match) result.add(match[1]);
  }
  return result;
}

// Remember only the weights we own, so removing a fitting rule restores the
// previous value without clearing body-type or other unrelated morph controls.
export class SourceFitting {
  private readonly originals = new WeakMap<THREE.Mesh, Map<number, number>>();

  apply(mesh: THREE.Mesh, names: ReadonlySet<string>): void {
    const dictionary = mesh.morphTargetDictionary, weights = mesh.morphTargetInfluences;
    if (!dictionary || !weights) return;
    let previous = this.originals.get(mesh);
    if (!previous) { previous = new Map(); this.originals.set(mesh, previous); }
    const active = new Set<number>();
    const matched: string[] = [];
    for (const name of names) {
      const index = dictionary[name];
      if (!Number.isInteger(index) || index < 0 || index >= weights.length) continue;
      if (!previous.has(index)) previous.set(index, weights[index]);
      weights[index] = 1;
      active.add(index); matched.push(name);
    }
    for (const [index, weight] of previous) if (!active.has(index)) {
      weights[index] = weight;
      previous.delete(index);
    }
    mesh.userData.sourceFittingMorphs = matched.sort();
  }
}
