// White-patch review ledger — verdicts DERIVED against content, never merely stored.
//
// The scan's measurement half was always reproducible; its judgement half was not. An earlier
// version keyed verdicts by path prefix, so a re-bake that genuinely broke a reviewed item still
// printed "legitimate" — the report would have certified the regression it exists to catch.
//
// This is the same rule scripts/lib/verification/queue.mjs already applies to marks: a judgement
// is bound to a hash of what was judged, and stops applying the moment that hash moves. See that
// file's opening line — "the queue is DERIVED, never maintained, which is what stops it rotting
// the way a hand-kept list does". A ledger keyed by name is a hand-kept list.
//
// Statuses:
//   legitimate   — compared against the item's catalogue icon; the white is intended
//   unverifiable — no catalogue icon exists to compare against, so nobody has confirmed it
//   broken       — compared against the icon and still wrong
// Derived, never written here:
//   stale        — the albedo changed since it was reviewed; the verdict no longer applies
//   unreviewed   — no verdict recorded for this albedo at all
import { createHash } from "node:crypto";

export const REVIEW_LEDGER = [
  { path: "public/models/cosmetics/casual-sandals-with-socks.cotton_alien.albedo.webp", sha256: "6974735af6d1b217916c605deac436bf1d26168a11d4c4091390ab7d80b23f39", status: "legitimate", note: "matching alien icon has bright stars, buckles, and socks" },
  { path: "public/models/cosmetics/casual-tall-sneakers.canvas.albedo.webp", sha256: "6f278753c0c44a2cf5699dacc2e86806d70801a39e4fc7009a18eaed00a47a2d", status: "legitimate", note: "matching icons show white soles, toes, and laces" },
  { path: "public/models/cosmetics/casual-tall-sneakers.canvas_black.albedo.webp", sha256: "071860147fb901569113d39ec9b3a8a02956725366cfaacb3b39aadf93155e29", status: "legitimate", note: "matching icons show white soles, toes, and laces" },
  { path: "public/models/cosmetics/casual-tall-sneakers.canvas_camoenorino.albedo.webp", sha256: "4e7d9865455c56e1f328946e132e7472e4fc67a5a7bdac9b8107743d1beb7fe3", status: "legitimate", note: "matching icons show white soles, toes, and laces" },
  { path: "public/models/cosmetics/casual-tall-sneakers.canvas_orf.albedo.webp", sha256: "655d76b29e372813754c0aee3927f129f343bff2282a7650459139438cadd06c", status: "legitimate", note: "matching icons show white soles, toes, and laces" },
  { path: "public/models/cosmetics/casual-tall-sneakers.canvas_sponsorengimo.albedo.webp", sha256: "a27bcb127fa8c9ac20de63116b856eb302f79fadbed6a72efa9be88f9a354d4e", status: "legitimate", note: "matching icons show white soles, toes, and laces" },
  { path: "public/models/cosmetics/cowboy-low-boots.leather_wedding.albedo.webp", sha256: "170119d2afc2fda0b2fccf9fd9fe1006d57a9374cb9e36265c76f539d50c648e", status: "legitimate", note: "wedding icon is an intentionally white boot" },
  { path: "public/models/cosmetics/cute-devil-horns.leather.albedo.webp", sha256: "d0ba3fd34c96c550cdbec3ba4015aab674d6a51a7f1450a5b36dd479666c6fa6", status: "legitimate", note: "matching icon has a white head/base around the orange horns" },
  { path: "public/models/cosmetics/medieval-elf-quiver.leather.albedo.webp", sha256: "605c0064d8e15f2d8fa2334f9e40cd45dafe35bc4422c6f76ca87dad982250ea", status: "legitimate", note: "matching icons show white arrow fletching and decorative glyphs" },
  { path: "public/models/cosmetics/medieval-elf-quiver.leather_dark.albedo.webp", sha256: "fb02e3a8627e552fc73090f926254c3248dc0ad6bcb18cf61b8094ab4111b18d", status: "legitimate", note: "matching icons show white arrow fletching and decorative glyphs" },
  { path: "public/models/cosmetics/medieval-elf-skirt-belt.leather.albedo.webp", sha256: "80c799b4c721d6d5ec827eda100777017d5760d253cc17df1d9eecc63ff9bd2e", status: "unverifiable", note: "albedo islands read as white belt hardware, but no catalogue icon exists for this legacy asset to confirm against" },
  { path: "public/models/cosmetics/medieval-elf-skirt-belt.leather_black.albedo.webp", sha256: "36893faf2c49f2509064cb3425d1b1e7fa1db7866068b5a0c20f619e03bf350c", status: "unverifiable", note: "albedo islands read as white belt hardware, but no catalogue icon exists for this legacy asset to confirm against" },
  { path: "public/models/cosmetics/mexico-mariachi-sombrero.wool.albedo.webp", sha256: "c6b7613f3b77643f47b38b2abe3ab49c1853c83ea9a25a007a98f7be33acfbaf", status: "legitimate", note: "matching icon is an intentional black-and-white sombrero" },
  { path: "public/models/cosmetics/military-assault-pants.polyester_moolahcamo.albedo.webp", sha256: "516edb354c751e8c1e6c102c8cc0ca7dcd3d9afbcd1da3c8e5d80bab1af2e2a1", status: "legitimate", note: "matching icon is an intentional white/black camouflage variant" },
  { path: "public/models/cosmetics/military-assault-vest.polyester_red.albedo.webp", sha256: "3ae9772cab039dc2f449b708896dbca9befd5d644699a9438924b33a53b506b2", status: "legitimate", note: "matching icon has intentional white straps and vest hardware" },
  { path: "public/models/cosmetics/military-beret.wool_arenasecurity.albedo.webp", sha256: "ff2e337c66c74ca59ec4bd55a2815ba550c23d1b59bb9e5b597f6a06b6c76d01", status: "legitimate", note: "matching icon keeps the beret dark; the bright patterned island is not a visible white patch" },
  { path: "public/models/cosmetics/military-combat-vest.denim_starsstripes.albedo.webp", sha256: "fd3c8af5667aacc5d6642c6248ce0789123f60cf846a444fbc417b12c6aab402", status: "legitimate", note: "matching icon is an intentional stars-and-stripes variant" },
  { path: "public/models/cosmetics/military-sniper-pants.windbreaker_dayofthedead.albedo.webp", sha256: "85538d14d5a3eef7b7cd4636929ca5a9afa011d83500bce560ae43ff25952889", status: "legitimate", note: "matching icon has intentional white skull/lettering details" },
  { path: "public/models/cosmetics/military-tactical-helmet.plastic_dissun.albedo.webp", sha256: "b93e5e8bf7a0886678b665c7e80a2a01e33a086601372fcf9c34a81ce7c2f7f2", status: "legitimate", note: "matching icons keep the visible helmet dark; white islands are hidden mask/attachment parts" },
  { path: "public/models/cosmetics/scifi-tech-bomber-jacket.nylon_dragon.albedo.webp", sha256: "c5610129acb6102337a0978a3aa04e0a03188542233ab708e74dab7b91db4a8f", status: "legitimate", note: "matching icon has white piping, panels, and hardware on the red jacket" },
  { path: "public/models/cosmetics/space-alien-boots.canvas.albedo.webp", sha256: "505f5971c4ae1aedcb489f40213ca64ec272e181064d7ca91e23447e65d7e754", status: "legitimate", note: "matching icons show white straps, soles, and the white/black colourway" },
  { path: "public/models/cosmetics/space-alien-boots.canvas_blackivada.albedo.webp", sha256: "a8cdfc5df10eb0e42b4e1abf1e00e2796eadd8a709fd45579a5d7f350e13a9a1", status: "legitimate", note: "matching icons show white straps, soles, and the white/black colourway" },
  { path: "public/models/cosmetics/space-alien-boots.canvas_blackorange.albedo.webp", sha256: "86772e381d2a0e7285fdd3b24a04cb759d1de0d92bba6641aff4bd5c00030391", status: "legitimate", note: "matching icons show white straps, soles, and the white/black colourway" },
  { path: "public/models/cosmetics/space-alien-boots.canvas_tsm.albedo.webp", sha256: "fb8bb7f819505c3b42c16910c451b4fd6706192a12d579e5e9f6f049fdb54d3b", status: "legitimate", note: "matching icons show white straps, soles, and the white/black colourway" },
  { path: "public/models/cosmetics/space-alien-boots.canvas_whiteblack.albedo.webp", sha256: "f4634c9b5452fb89d4f67ec146fae5692809739ad80f35e0245ce9e686ece3e0", status: "legitimate", note: "matching icons show white straps, soles, and the white/black colourway" },
  { path: "public/models/cosmetics/sport-roller-derby-hand-guards.nylon_brazil.albedo.webp", sha256: "c0938c10df1bc25e343496e3afb6f1fb198b5dca9ebfe120988a7a3e5c278148", status: "legitimate", note: "matching icons show white hand/edge details and bright team patches" },
  { path: "public/models/cosmetics/sport-roller-derby-hand-guards.nylon_brazilultimate.albedo.webp", sha256: "c27989558f4db6e431707d7bf2ae5ed887230c4b576539d9b5ecc1b037d0e29f", status: "legitimate", note: "matching icons show white hand/edge details and bright team patches" },
  { path: "public/models/cosmetics/sport-roller-derby-hand-guards.nylon_ospuze.albedo.webp", sha256: "c72a0a84d21b59b8d0096fc344da7e806b18178b1cfd5ccf3ba7baa148514524", status: "legitimate", note: "matching icons show white hand/edge details and bright team patches" },
  { path: "public/models/cosmetics/sport-roller-derby-hand-guards.nylon_ospuzeyellow.albedo.webp", sha256: "8791c4bdbb830e371ef0169d491f2a55fa2d8e58aa5f54b0b936d7747eb8ad75", status: "legitimate", note: "matching icons show white hand/edge details and bright team patches" },
  { path: "public/models/cosmetics/streetwear-cargo-pants.canvas_blackwhite.albedo.webp", sha256: "8ee2fea9723d2cf12d5755e1415f2ee5eaf5132559b7ce200c4ca7c4030c93ce", status: "legitimate", note: "matching icons are intentional black/white, orange/green, and yellow/black variants" },
  { path: "public/models/cosmetics/streetwear-cargo-pants.canvas_cb2a.albedo.webp", sha256: "d12c1d12540f98a586e2877aa458cb725aae6e69d223fe48228308ef659fbb0a", status: "legitimate", note: "matching icons are intentional black/white, orange/green, and yellow/black variants" },
  { path: "public/models/cosmetics/streetwear-cargo-pants.canvas_orangegreen.albedo.webp", sha256: "21f30b6de61ba675e73bd820e6b0581c16d24a82f3903d2e9edd0f26c4b04296", status: "legitimate", note: "matching icons are intentional black/white, orange/green, and yellow/black variants" },
  { path: "public/models/cosmetics/streetwear-commando-jacket.canvas.albedo.webp", sha256: "bd491ab6e3f058be8c2365b57604128d9a36f270fb6ed4fe5b39ccec83ca8947", status: "legitimate", note: "matching icons show white/grey hardware and two-tone camouflage panels" },
  { path: "public/models/cosmetics/streetwear-commando-jacket.canvas_trentila.albedo.webp", sha256: "c7e0f8b1e9fb05c8bcd346bf36f5bd6906720826db60aea97ca1097f363ea508", status: "legitimate", note: "matching icons show white/grey hardware and two-tone camouflage panels" },
  { path: "public/models/cosmetics/streetwear-oversized-bomber-jacket.innernylon.albedo.webp", sha256: "34346868832f8ef41bc0909c6e0dcaa374c8c074ba47460830b67b6d23f344e9", status: "legitimate", note: "matching icon includes a white under-layer and bright trim" },
  { path: "public/models/cosmetics/streetwear-tech-gloves.nylon_teamsecret.albedo.webp", sha256: "3c02264ef3fb5e1b8c396c606937c5d481b0c90e7df79d8087f968ece61c0828", status: "legitimate", note: "matching icon has a white/silver team label and glove details" },
  { path: "public/models/cosmetics/traditional-lunar-bolero-short-sleeve.dark.albedo.webp", sha256: "340c0df7e2f58661c9f597d958274c89465f6d47b219a94590cd27d415a88774", status: "unverifiable", note: "albedo islands read as white embroidery/trim, but no catalogue icon exists for this legacy asset to confirm against" },
  { path: "public/models/cosmetics/traditional-lunar-bolero-short-sleeve.pastelgreen.albedo.webp", sha256: "6ff294ed8db9f23a9a34315e58b6ace7f874ad451d6ba7a9bfa10a29453a7d97", status: "unverifiable", note: "albedo islands read as white embroidery/trim, but no catalogue icon exists for this legacy asset to confirm against" },
  { path: "public/models/cosmetics/traditional-lunar-dress.pastelgreen.albedo.webp", sha256: "6d40dac7f862c4acd92cc69c89873ec7f153454ce37ff881fca6c3616fc281dd", status: "legitimate", note: "matching icon has white embroidery, closures, and under-layer detail" },
  { path: "public/models/earring/miniature-ak-01.miniature-ak-01.attachment.albedo.webp", sha256: "7a7f27497a7b39a24d83f72f6543cc39d31aa4a361e5856ec123d3d0dc2cd344", status: "legitimate", note: "metal hardware is white/silver in the matching miniature-AK icon" },
];

const BY_PATH = new Map(REVIEW_LEDGER.map((entry) => [entry.path, entry]));

export function albedoHash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

// Both arguments matter. A path match alone is what the previous version trusted, and it is
// exactly what cannot detect a re-bake.
export function reviewFor(path, sha256) {
  const entry = BY_PATH.get(path);
  if (!entry) return { status: "unreviewed", note: "no verdict recorded for this albedo" };
  if (entry.sha256 !== sha256) {
    return {
      status: "stale",
      note: `reviewed at ${entry.sha256.slice(0, 12)}, content is now ${sha256.slice(0, 12)} — re-review needed`,
    };
  }
  return { status: entry.status, note: entry.note };
}
