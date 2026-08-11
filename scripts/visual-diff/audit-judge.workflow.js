export const meta = {
  name: 'audit-judge',
  description: 'Vision-judge each rendered item vs its official icon; score fidelity + categorize the root cause so fixable clusters surface',
  phases: [{ title: 'Judge' }],
}

// args = [[id, slot], ...] (the audit list). Renders live at visual-diff/audit/<id>.render.png
// and the official icon at visual-diff/audit/<id>.icon.webp (copied by verify-render2).
const list = (typeof args === 'string' ? JSON.parse(args) : args) || []

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['id', 'score', 'category', 'issue', 'fixableInRepo'],
  properties: {
    id: { type: 'string' },
    score: { type: 'number', description: '0-100: how well the render matches the icon for THIS item (shape, color, material, prints, details)' },
    category: {
      type: 'string',
      description: 'the single biggest discrepancy category: good | color-too-light | color-wrong | missing-print | wrong-print | metal-grey | material-flat | wrong-mesh | missing-part | emissive-missing | artifact | framing | other',
    },
    issue: { type: 'string', description: 'one concrete sentence on the biggest discrepancy (or "matches" if good)' },
    fixableInRepo: {
      type: 'string',
      description: 'in-repo (decode/material/import/rig fix possible) | blender (needs mesh re-convert) | gated (lighting/stripped-recipe) | none',
    },
  },
}

phase('Judge')

const verdicts = await pipeline(
  list,
  ([id, slot]) =>
    agent(
      `Compare our 3D render to the official game icon for cosmetic item "${id}" (slot: ${slot}).\n` +
        `Read BOTH images:\n` +
        `  RENDER (our recreation): visual-diff/audit/${id}.render.png\n` +
        `  ICON (ground truth):     visual-diff/audit/${id}.icon.webp\n\n` +
        `The render is on a grey mannequin in a neutral studio; the icon may be lit differently and ` +
        `framed differently — judge the ITEM's identity (silhouette/shape, base color, material read, ` +
        `prints/logos/patterns, metallic vs matte, glow), NOT lighting/pose/background differences.\n` +
        `Score 0-100 (100 = faithful). Pick the SINGLE biggest discrepancy + its category + whether it's ` +
        `fixable in our code (in-repo), needs a mesh re-convert (blender), or is gated (lighting/stripped data). ` +
        `If the item isn't visible/centered in the render, category=framing. Be concrete and terse.`,
      { label: `judge:${id}`, phase: 'Judge', schema: SCHEMA, agentType: 'Explore', effort: 'low' },
    ).catch(() => ({ id, score: -1, category: 'other', issue: 'judge failed', fixableInRepo: 'none' })),
)

// cluster
const ok = verdicts.filter(Boolean)
const byCat = {}
for (const v of ok) (byCat[v.category] ??= []).push({ id: v.id, score: v.score, issue: v.issue, fix: v.fixableInRepo })
const lowScores = ok.filter((v) => v.score >= 0 && v.score < 60).sort((a, b) => a.score - b.score)
return {
  judged: ok.length,
  medianScore: ok.map((v) => v.score).filter((s) => s >= 0).sort((a, b) => a - b)[Math.floor(ok.length / 2)],
  categoryCounts: Object.fromEntries(Object.entries(byCat).map(([k, v]) => [k, v.length])),
  inRepoFixable: ok.filter((v) => v.fixableInRepo === 'in-repo' && v.score < 75).map((v) => ({ id: v.id, cat: v.category, issue: v.issue })),
  worst: lowScores.slice(0, 25).map((v) => ({ id: v.id, score: v.score, cat: v.category, issue: v.issue, fix: v.fixableInRepo })),
}
