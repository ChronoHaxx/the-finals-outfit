// Ordered priorities, not release dates or claims of completed catalog coverage.
export const ROADMAP = [
  {
    title: "Cover more items through shared fixes",
    stage: "Current focus",
    description: "Expand the first pass on Medium, starting with compatible accessories and clothing families.",
    tasks: [
      "Recover missing mesh parts and material assignments for accessories and clothing.",
      "Apply common shader fixes to whole families and their colour variants; investigate individual exceptions when needed.",
      "Check a representative outfit after each batch and record visible problems.",
    ],
    finish: "Each batch loads its intended parts, has plausible materials and has an accurate status label.",
  },
  {
    title: "Finish materials and animated effects",
    stage: "Next",
    description: "Bring the remaining material families into the same preview system.",
    tasks: [
      "Complete layered fabrics, leather, metal, glass and transparent surfaces.",
      "Recreate supported glowing and moving patterns on nails, visors, glasses and other accessories.",
      "Resolve hair, face and body-paint finish differences, including how cosmetic layers combine.",
    ],
    finish: "The intended appearance and animation survive switching, removing and reloading items.",
  },
  {
    title: "Make outfits fit together",
    stage: "Alongside every batch",
    description: "Close the gaps between individually working items and a usable outfit.",
    tasks: [
      "Fix body and hair culling, sleeve and wrist gaps, and clipping beneath headwear or clothing.",
      "Check attachments and layered cosmetics together, including swaps and removal.",
      "Expand review to eight-angle views and representative outfit combinations; keep failures marked purple.",
    ],
    finish: "Reviewed combinations have no obvious missing parts, exposed cutouts or major intersections.",
  },
  {
    title: "Reach broadly usable outfits on Medium",
    stage: "80% milestone",
    description: "Count cosmetics that look broadly correct and work in reviewed outfits on Medium.",
    tasks: [
      "Review appearance and fitting before counting an item toward the target; a first pass still needs checking.",
      "Track remaining failures and test loading, switching and shared-link reloads.",
      "Keep detailed visual polish and other body types as follow-up work.",
    ],
    finish: "At least 80% of the catalog passes the agreed usable-Medium checks. The colour bar tracks current review states, not this milestone's completion.",
  },
  {
    title: "Finish remaining items and body types",
    stage: "After the Medium target",
    description: "Resolve the remaining exceptions, then extend fitting and review to Light and Heavy.",
    tasks: [
      "Finish uncommon materials and multi-part cosmetics left out of the broad passes.",
      "Verify each supported body type and its clothing and accessory fits.",
      "Improve lighting, fine detail, loading reliability and performance on desktop and mobile.",
    ],
    finish: "Every catalog item is accounted for, with remaining limitations visible and tested across supported bodies.",
  },
  {
    title: "Physics and secondary motion",
    stage: "Planned",
    description: "Add motion to hair, clothing and dangling accessories once their geometry and fitting are reliable.",
    tasks: [
      "Investigate the available motion and collision data and add supported simulations in stages.",
      "Check movement against the body and nearby clothing so motion does not introduce new clipping.",
      "Include reduced-motion and performance options for heavier scenes and smaller devices.",
    ],
    finish: "Motion is stable in supported outfits, with clear limits where game behaviour cannot yet be reproduced.",
  },
  {
    title: "Themes, random outfits and suggestions",
    stage: "Future discovery tools",
    description: "Make a large catalog easier to explore and combine.",
    tasks: [
      "Add theme filters such as Playful when reliable item tags are available.",
      "Add a randomiser with controls to keep chosen pieces and choose compatible items.",
      "Explore optional AI outfit suggestions after names, tags and fitting are dependable.",
    ],
    finish: "People can discover and share useful combinations without needing to know internal item names.",
  },
  {
    title: "Reports and community contributions",
    stage: "Future support tools",
    description: "Make it easier to report a broken item and contribute a fix.",
    tasks: [
      "Add item and mesh reports with the outfit link, affected cosmetic and useful screenshots.",
      "Document how to reproduce a problem and verify a contribution.",
      "Keep status changes linked to evidence so blue, purple and green remain useful.",
    ],
    finish: "A contributor can reproduce a reported problem, submit a fix and show that it works.",
  },
] as const;
