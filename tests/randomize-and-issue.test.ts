import test from "node:test";
import assert from "node:assert/strict";
import { randomizeBuild, seededRandom, RANDOM_SLOTS, CORE_SLOTS } from "../src/lib/randomize";
import { issueUrl, issueBody, MAX_ISSUE_URL } from "../src/lib/issue-report";
import { SLOTS, type Slot } from "../src/lib/slots";
import { resolveEquipmentSlots } from "../src/lib/equipment";

const blank = () => Object.fromEntries(SLOTS.map(s => [s, null])) as Record<Slot, string | null>;
const pool = (slot: Slot) => [1, 2, 3].map(n => `${slot}-${n}`);

test("locked slots keep their value, including an empty one", () => {
  const build = { ...blank(), face: "my-face", headwear: null };
  for (let seed = 1; seed < 50; seed++) {
    const next = randomizeBuild({ build, locked: new Set<Slot>(["face", "headwear"]), candidates: pool, random: seededRandom(seed) });
    assert.equal(next.face, "my-face");
    assert.equal(next.headwear, null);
  }
});

test("core slots are always filled from their candidates; others only from theirs", () => {
  for (let seed = 1; seed < 50; seed++) {
    const next = randomizeBuild({ build: blank(), locked: new Set(), candidates: pool, random: seededRandom(seed) });
    for (const slot of CORE_SLOTS) assert.ok(pool(slot).includes(next[slot]!));
    for (const slot of RANDOM_SLOTS) if (next[slot]) assert.ok(pool(slot).includes(next[slot]!));
    assert.equal(next.emote, null); // not a random slot
  }
});

test("a random hat is never paired with a random hairstyle", () => {
  for (let seed = 1; seed < 400; seed++) {
    const next = randomizeBuild({ build: blank(), locked: new Set(), candidates: pool, random: seededRandom(seed) });
    assert.ok(!(next.hair && next.headwear));
  }
  const locked = randomizeBuild({ build: { ...blank(), hair: "h" }, locked: new Set<Slot>(["hair"]),
    candidates: pool, random: () => 0 }); // chance always passes
  assert.equal(locked.hair, "h");
  assert.ok(locked.headwear); // a locked hairstyle does not suppress a hat
});

test("an empty candidate pool leaves the slot empty and the same seed reproduces the roll", () => {
  const none = randomizeBuild({ build: blank(), locked: new Set(), candidates: () => [], random: seededRandom(3) });
  assert.ok(RANDOM_SLOTS.every(s => none[s] === null));
  const a = randomizeBuild({ build: blank(), locked: new Set(), candidates: pool, random: seededRandom(7) });
  const b = randomizeBuild({ build: blank(), locked: new Set(), candidates: pool, random: seededRandom(7) });
  assert.deepEqual(a, b);
});

test("issue link carries the share link, items and context and stays under the URL limit", () => {
  const items = [{ slot: "headwear" as Slot, id: "hat-1", name: "Hat", status: "Blue · needs polish" }];
  const url = new URL(issueUrl({ repositoryUrl: "https://github.com/o/r/", shareUrl: "https://x.test/o/abc",
    items, focus: items[0], viewport: { width: 390, height: 844, pixelRatio: 3 } }));
  assert.equal(url.origin + url.pathname, "https://github.com/o/r/issues/new");
  assert.match(url.searchParams.get("title")!, /Hat \(Headwear\)/);
  const body = url.searchParams.get("body")!;
  assert.match(body, /https:\/\/x\.test\/o\/abc/);
  assert.match(body, /`hat-1`.*reported item/);
  assert.match(body, /390×844 @3x/);
  const many = Array.from({ length: 400 }, (_, n) => ({ ...items[0], id: `item-${n}`, name: "Long name ".repeat(5) }));
  assert.ok(issueUrl({ repositoryUrl: "https://github.com/o/r", shareUrl: "s", items: many, userAgent: "UA".repeat(500) }).length <= MAX_ISSUE_URL);
  assert.doesNotMatch(issueBody({ repositoryUrl: "r", shareUrl: "s", items: [] }), /reported item/);
});

test('random outfits avoid full-body collisions and keep locked clothes/empty slots unchanged', () => {
  const overalls = 'casual-onestrapoveralls-denim', shirt = 'casual-basictshirt-cotton-black', pants = 'casual-loosejeans-denim-darkblue';
  const blank = Object.fromEntries(SLOTS.map(s => [s, null])) as Record<Slot, string | null>;
  const candidates = (slot: Slot) => slot === 'upperBody' ? [overalls, shirt] : slot === 'lowerBody' ? [pants] : [];
  for (let seed = 1; seed <= 50; seed++) {
    const result = randomizeBuild({ build: blank, locked: new Set(), candidates, random: seededRandom(seed) });
    assert.ok(!(result.upperBody === overalls && result.lowerBody));
    assert.deepEqual(resolveEquipmentSlots(result).removed, []);
    const locked = randomizeBuild({ build: { ...blank, lowerBody: pants }, locked: new Set(['lowerBody', 'face']),
      candidates, random: seededRandom(seed) });
    assert.equal(locked.lowerBody, pants);
    assert.equal(locked.upperBody, shirt);
    assert.equal(locked.face, null);
    const lockedSuit = randomizeBuild({ build: { ...blank, upperBody: overalls }, locked: new Set(['upperBody']),
      candidates, random: seededRandom(seed) });
    assert.equal(lockedSuit.upperBody, overalls);
    assert.equal(lockedSuit.lowerBody, null);
  }
});
