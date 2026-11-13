# Refused meshes: hand-off to the Season 12 item refresh route (6 Nov 2026)

Generated from `reports/refused-handoff-v1.json` (`scripts/body-types/refused-handoff.py` on index-v2). Not hand-fixed.

Columns:
- **Unlocks**: items that become S12 throughout if this mesh alone were refreshed (cascades included), on top of the 1,123 S12 items now.
- **Shows**: supported items that can show it on Medium.
- **Class**: reworked in S12 (S12 source differs from the pre-S12 source beyond morphs); live-derived (S12 changed only morphs, but the live GLB carries our own processing); no pre-S12 copy (cause not decided).
- **S12 changed**: against the pre-S12 source where one exists, else against the live GLB.
- **Morph cm**: largest change of medium_male / medium_female against live (same-vertex meshes only).

## Blocking (213 meshes, ranked by unlocks)

| # | Mesh | Unlocks | Shows | Class | S12 changed | Morph cm |
|---:|---|---:|---:|---|---|---|
| 1 | `SK_Shirt_M` | 47 | 47 | reworked in S12 | bones, normals, positions, skin weights, topology, uvs, vertex colour |  |
| 2 | `SK_Casual_BasicTshirt_M` | 43 | 43 | reworked in S12 | normals, positions, skin weights, topology, uvs, vertex colour |  |
| 3 | `SK_Casual_Tshirt_M` | 20 | 20 | reworked in S12 | bones, skin weights | m 0.001, f 2.746 |
| 4 | `SK_Pants_M` | 17 | 17 | reworked in S12 | normals, positions, skin weights, topology, uvs | m 1.263, f 2.325 |
| 5 | `SK_Military_AssaultPants_M` | 16 | 16 | reworked in S12 | normals, positions, skin weights, topology, uvs | m 0.74, f 1.357 |
| 6 | `SK_StarterSet_TShirt_M` | 13 | 13 | reworked in S12 | morph set |  |
| 7 | `SK_Streetwear_TechGloves_M` | 13 | 13 | reworked in S12 | bones, skin weights | m 0.028, f 0.029 |
| 8 | `SK_Halloween_VampireBoots_M` | 13 | 3 | reworked in S12 | normals, positions, skin weights, topology, uvs | f 1.909, m 1.253 |
| 9 | `SK_Streetwear_VarsityJacket_M` | 12 | 12 | reworked in S12 | skin weights | m 1.363, f 3.678 |
| 10 | `SK_Military_SniperBoots_M` | 10 | 10 | reworked in S12 | normals, positions, skin weights, topology, uvs | m 0.875, f 1.339 |
| 11 | `SK_Socks_Crew_M` | 10 | 1 | reworked in S12 | attribute set, normals, positions, skin weights, topology, uvs | m 0.196, f 0.292 |
| 12 | `SK_Streetwear_BikerJacketHoodie_M` | 9 | 9 | reworked in S12 | attribute set, skin weights, uvs | f 3.789, m 0.0 |
| 13 | `SK_Steampunk_VestWithHood_M` | 9 | 3 | reworked in S12 | normals, positions, skin weights, topology, uvs | f 3.18, m 1.143 |
| 14 | `SK_Military_SniperPants_M` | 8 | 8 | reworked in S12 | normals, skin weights | m 1.434, f 3.309 |
| 15 | `SK_Casual_LongHoodie_M` | 7 | 7 | reworked in S12 | attribute set | m 0.001, f 3.046 |
| 16 | `SK_Casual_Sweater_M` | 7 | 7 | reworked in S12 | bones, skin weights | f 3.073 |
| 17 | `SK_LongCurly_M` | 7 | 7 | reworked in S12 | morph set, normals, positions, rest pose, skin weights, topology, uvs, vertex colour |  |
| 18 | `SK_Military_CombatPants_M` | 7 | 7 | reworked in S12 | topology |  |
| 19 | `SK_Streetwear_HeistBag_M` | 7 | 7 | reworked in S12 | attribute set, bones, skin weights | m 1.229, f 2.533 |
| 20 | `SK_Streetwear_SkiMask_M` | 7 | 7 | reworked in S12 | normals, positions, skin weights, topology, uvs, vertex colour |  |
| 21 | `SK_Streetwear_TacticalBandolier_M` | 7 | 7 | reworked in S12 | normals, positions, skin weights, topology, uvs | f 5.035, m 3.146 |
| 22 | `SK_Casual_Hoodie_M` | 6 | 6 | reworked in S12 | normals, positions, skin weights, topology, uvs, vertex colour | f 4.959, m 4.284 |
| 23 | `SK_FancyDress_SuitJacket_M` | 6 | 6 | reworked in S12 | morph set, skin weights |  |
| 24 | `SK_Military_MarineBoots_M` | 6 | 6 | reworked in S12 | normals, positions, skin weights, topology, uvs | f 0.408, m 0.464 |
| 25 | `SK_Hologram_CombatVestSamuraiHologram_M` | 6 | 1 | reworked in S12 | bones, skin weights | f 0.823 |
| 26 | `SK_Cowboy_HandCloth_M` | 5 | 5 | reworked in S12 | normals, skin weights | m 0.158, f 0.217 |
| 27 | `SK_FromTencent_AsianSpiritBoots_M` | 5 | 5 | reworked in S12 | rest pose | m 0.375, f 0.496 |
| 28 | `SK_Military_DoubleBeltParts_M` | 5 | 5 | reworked in S12 | bones, skin weights | m 1.714, f 2.003 |
| 29 | `SK_Military_MarinePants_M` | 5 | 5 | reworked in S12 | normals, skin weights, uvs | f 1.484, m 0.277 |
| 30 | `SK_Pirate_CaptainPants_M` | 5 | 5 | reworked in S12 | normals, uvs | m 0.003, f 1.292 |
| 31 | `SK_Racing_Helmet_M` | 5 | 5 | reworked in S12 | morph set |  |
| 32 | `SK_Streetwear_HipBag_M` | 5 | 5 | reworked in S12 | normals, skin weights | f 1.434 |
| 33 | `SK_Hologram_DissunJacketHologram_M` | 5 | 1 | reworked in S12 | bones, skin weights | f 0.434, m 0.421 |
| 34 | `SK_Medieval_DragonSlayerSkirt_M` | 5 | 1 | reworked in S12 | normals, positions, skin weights, topology, uvs | f 5.239, m 2.243 |
| 35 | `SK_Cowboy_JeansJacket_M` | 4 | 4 | reworked in S12 | bones, normals, positions, skin weights, topology, uvs | m 2.4, f 3.155 |
| 36 | `SK_Historic_VikingBoots_M` | 4 | 4 | reworked in S12 | normals, positions, skin weights, topology, uvs | f 0.407, m 0.26 |
| 37 | `SK_Pirate_CaptainBoots_M` | 4 | 4 | reworked in S12 | uvs | m 0.613, f 0.929 |
| 38 | `SK_SciFi_HackerGloves_M` | 4 | 4 | reworked in S12 | normals, positions, skin weights, topology, uvs | m 0.655, f 0.507 |
| 39 | `SK_SciFi_TechBomberJacket_M` | 4 | 4 | reworked in S12 | normals, positions, topology, uvs | f 3.654, m 0.292 |
| 40 | `SK_Sport_UmpireMask_M` | 4 | 4 | reworked in S12 | normals, positions, skin weights, topology, uvs | m 2.05, f 1.115 |
| 41 | `SK_Streetwear_BoilerSuitTorso_M` | 4 | 4 | reworked in S12 | bones, skin weights | m 0.0, f 3.259 |
| 42 | `SK_Streetwear_TechPants_M` | 4 | 3 | reworked in S12 | bones, skin weights | m 0.321, f 1.563 |
| 43 | `SK_Casual_Bangles_M` | 3 | 3 | reworked in S12 | normals, positions, skin weights, topology, uvs | f 0.361, m 0.533 |
| 44 | `SK_Cowboy_LowBoots_M` | 3 | 3 | reworked in S12 | normals, positions, topology, uvs | m 0.218, f 0.316 |
| 45 | `SK_FromTencent_AsianSpiritGloves_M` | 3 | 3 | reworked in S12 | rest pose | m 0.298, f 0.257 |
| 46 | `SK_Historic_SimpleBracelet_M` | 3 | 3 | reworked in S12 | normals, positions, skin weights, topology, uvs | f 0.088, m 0.148 |
| 47 | `SK_Medieval_WizardBoots_M` | 3 | 3 | reworked in S12 | skin weights | m 0.272, f 0.497 |
| 48 | `SK_Military_MarineVest_M` | 3 | 3 | reworked in S12 | normals, positions, skin weights, topology, uvs, vertex colour | f 5.98, m 4.878 |
| 49 | `SK_Samurai_LoosePants_M` | 3 | 3 | reworked in S12 | normals | m 1.651, f 1.424 |
| 50 | `SK_Space_AstroPilotGloves_M` | 3 | 3 | reworked in S12 | normals, positions, skin weights, topology, uvs | m 0.244, f 0.244 |
| 51 | `SK_Sport_PaddedPants_M` | 3 | 3 | reworked in S12 | normals, positions, skin weights, topology, uvs | m 3.559, f 5.182 |
| 52 | `SK_Traditional_LunarBoots_M` | 3 | 3 | reworked in S12 | skin weights | f 0.581, m 0.293 |
| 53 | `SK_Hologram_EngimoPantsHologram_M` | 3 | 1 | reworked in S12 | bones, skin weights | f 0.799, m 0.291 |
| 54 | `SK_SciFi_PantsToolBag_M` | 3 | 1 | reworked in S12 | normals, positions, uvs | f 0.88, m 0.358 |
| 55 | `SK_ActionHero_SentinelTop_M` | 2 | 2 | reworked in S12 | normals, positions, skin weights, topology, uvs, vertex colour | f 3.13, m 3.594 |
| 56 | `SK_Casual_WaterproofBoots_M` | 2 | 2 | reworked in S12 | normals, positions, skin weights, topology, uvs | m 1.486, f 2.449 |
| 57 | `SK_Cowboy_WranglerBandolier_M` | 2 | 2 | reworked in S12 | bones, normals, skin weights | m 0.32, f 3.688 |
| 58 | `SK_Cowboy_WranglerBracelet_M` | 2 | 2 | reworked in S12 | normals | m 0.001, f 0.001 |
| 59 | `SK_Historic_EasternEmperorPants_M` | 2 | 2 | reworked in S12 | bones, normals, positions, skin weights, topology, uvs | f 1.373, m 0.964 |
| 60 | `SK_Historic_EasternEmperorShoes_M` | 2 | 2 | reworked in S12 | bones, skin weights | f 0.2 |
| 61 | `SK_Historic_EmpressFaceMask_M` | 2 | 2 | reworked in S12 | skin weights | f 0.274, m 0.274 |
| 62 | `SK_Historic_EmpressShoes_M` | 2 | 2 | reworked in S12 | normals, positions, skin weights, topology, uvs | f 1.438, m 1.165 |
| 63 | `SK_Historic_VikingPants_M` | 2 | 2 | reworked in S12 | normals, positions, skin weights, topology, uvs | f 4.682, m 2.553 |
| 64 | `SK_Medieval_ElfPrincessMask_M` | 2 | 2 | reworked in S12 | normals, positions, skin weights, topology, uvs, vertex colour |  |
| 65 | `SK_Medieval_JesterHat_M` | 2 | 2 | reworked in S12 | topology |  |
| 66 | `SK_Medieval_JesterJacket_M` | 2 | 2 | reworked in S12 | skin weights | m 1.279, f 2.795 |
| 67 | `SK_Medieval_JesterPants_M` | 2 | 2 | reworked in S12 | skin weights | f 2.507, m 1.019 |
| 68 | `SK_Medieval_JesterShoes_M` | 2 | 2 | reworked in S12 | skin weights | m 0.594, f 1.325 |
| 69 | `SK_Medieval_KnightTopPlain_M` | 2 | 2 | reworked in S12 | normals, positions, skin weights, topology, uvs, vertex colour | f 4.9, m 4.499 |
| 70 | `SK_Military_AcePilotTop_M` | 2 | 2 | reworked in S12 | bones, skin weights | f 3.81, m 1.503 |
| 71 | `SK_Military_BulletBandolier_M` | 2 | 2 | reworked in S12 | rest pose | f 3.215, m 1.549 |
| 72 | `SK_Monsters_EasternDemonGauntlet_M` | 2 | 2 | reworked in S12 | bones, skin weights | f 0.016, m 0.017 |
| 73 | `SK_Ninja_ShinobiRope_M` | 2 | 2 | reworked in S12 | normals, uvs | m 0.002, f 3.142 |
| 74 | `SK_Pirate_CaptainJacket_M` | 2 | 2 | reworked in S12 | bones, normals, positions, skin weights, topology, uvs, vertex colour | m 0.767, f 3.503 |
| 75 | `SK_Pirate_ScallywagPants_M` | 2 | 2 | reworked in S12 | normals, positions, skin weights, topology, uvs | f 2.513, m 2.481 |
| 76 | `SK_Robots_SynthHelmet_M` | 2 | 2 | reworked in S12 | normals, positions, skin weights, topology, uvs | f 1.165, m 2.188 |
| 77 | `SK_Samurai_GetaShoes_M` | 2 | 2 | reworked in S12 | normals, positions, skin weights, topology, uvs | m 0.007, f 0.24 |
| 78 | `SK_SciFi_PhantomMaskTranslucent_M` | 2 | 2 | reworked in S12 | morph set |  |
| 79 | `SK_Space_PioneerShoes_M` | 2 | 2 | reworked in S12 | normals, positions, skin weights, topology, uvs, vertex colour |  |
| 80 | `SK_Space_SpacePilotGloves_M` | 2 | 2 | reworked in S12 | uvs | m 0.254, f 0.257 |
| 81 | `SK_Sport_FencerShoes_M` | 2 | 2 | reworked in S12 | normals, positions, skin weights, topology, uvs | m 0.376, f 0.497 |
| 82 | `SK_Streetwear_BandanaCap_M` | 2 | 2 | reworked in S12 | attribute set, uvs | m 0.313, f 0.2 |
| 83 | `SK_Streetwear_CuteJacket_M` | 2 | 2 | reworked in S12 | bones, skin weights | m 1.314, f 3.404 |
| 84 | `SK_Streetwear_MessengerBag_M` | 2 | 2 | reworked in S12 | bones, normals, positions, skin weights, topology, uvs, vertex colour |  |
| 85 | `SK_Streetwear_RingWrapBracelet_M` | 2 | 2 | reworked in S12 | normals, uvs | f 0.278, m 0.285 |
| 86 | `SK_Streetwear_SingleSleeveTop_M` | 2 | 2 | reworked in S12 | bones, skin weights | f 3.371, m 0.339 |
| 87 | `SK_Streetwear_TechBoots_M` | 2 | 2 | reworked in S12 | bones, skin weights | m 0.0, f 0.378 |
| 88 | `SK_Streetwear_TechCropTop_M` | 2 | 2 | reworked in S12 | bones, morph set, normals, positions, skin weights, topology, uvs, vertex colour |  |
| 89 | `SK_Traditional_UrbanWarriorPants_M` | 2 | 2 | reworked in S12 | normals, positions, skin weights, topology, uvs | f 4.553, m 3.732 |
| 90 | `SK_Hologram_IseultPufferJacketHologram_M` | 2 | 1 | reworked in S12 | bones, skin weights | f 3.053 |
| 91 | `SK_Medieval_KnightGlovesSpikesL_M` | 2 | 1 | reworked in S12 | morph set |  |
| 92 | `SK_Medieval_WizardParts_M` | 2 | 1 | reworked in S12 | normals, positions, skin weights, topology, uvs, vertex colour |  |
| 93 | `SK_Casual_CropTopCorset_M` | 1 | 1 | reworked in S12 | normals, positions, skin weights, topology, uvs | m 1.854, f 4.32 |
| 94 | `SK_Christmas_ElfBoots_M` | 1 | 1 | reworked in S12 | bones, normals, skin weights | f 0.453, m 0.183 |
| 95 | `SK_CrossPromo_NRHarness_M` | 1 | 1 | reworked in S12 | normals, positions, skin weights, topology, uvs | f 3.964, m 4.333 |
| 96 | `SK_Cute_FrogShoes_M` | 1 | 1 | reworked in S12 | normals, uvs | f 0.218 |
| 97 | `SK_FromTencent_MilitaryMonkVest_M` | 1 | 1 | reworked in S12 | normals, positions, skin weights, topology, uvs, vertex colour |  |
| 98 | `SK_FromTencent_OperaClothingJacket_M` | 1 | 1 | reworked in S12 | normals, positions, skin weights, topology, uvs, vertex colour |  |
| 99 | `SK_Historic_AnubisMaskRegular_M` | 1 | 1 | reworked in S12 | normals, positions, topology, uvs | f 0.273, m 0.256 |
| 100 | `SK_Historic_NeckCape_M` | 1 | 1 | reworked in S12 | skin weights | m 1.234, f 3.367 |
| 101 | `SK_Hologram_EngimoPantsHologram02_M` | 1 | 1 | reworked in S12 | bones, skin weights | f 0.221 |
| 102 | `SK_Hologram_HoltowJacketHologram_M` | 1 | 1 | reworked in S12 | bones, normals, positions, skin weights, topology, uvs, vertex colour |  |
| 103 | `SK_Hologram_HoltowPantsHologram_M` | 1 | 1 | reworked in S12 | bones, skin weights | f 0.761, m 0.119 |
| 104 | `SK_Hologram_TrentilaShoesHologram_M` | 1 | 1 | reworked in S12 | skin weights | f 0.186, m 0.05 |
| 105 | `SK_Medieval_DragonSlayerTorso_M` | 1 | 1 | reworked in S12 | normals, positions, skin weights, topology, uvs, vertex colour | f 3.453, m 2.523 |
| 106 | `SK_Medieval_ElfPrincessTorsoUltimate_M` | 1 | 1 | reworked in S12 | skin weights | f 3.349 |
| 107 | `SK_Medieval_RoyalGloves_M` | 1 | 1 | reworked in S12 | normals, positions, skin weights, topology, uvs | f 0.266, m 0.229 |
| 108 | `SK_Mexico_RancheroHolster_M` | 1 | 1 | reworked in S12 | normals, positions, skin weights, topology, uvs | m 1.938, f 1.807 |
| 109 | `SK_Military_OpenShirtWithDogTag_M` | 1 | 1 | reworked in S12 | normals, positions, skin weights, topology, uvs, vertex colour | f 5.272, m 3.725 |
| 110 | `SK_Military_RiotMedievalPants_M` | 1 | 1 | reworked in S12 | normals, positions, skin weights, topology, uvs | f 4.512, m 1.913 |
| 111 | `SK_Military_WaistPouches_M` | 1 | 1 | reworked in S12 | bones, normals, skin weights | f 0.687 |
| 112 | `SK_Ninja_ShinobiPants_M` | 1 | 1 | reworked in S12 | normals, positions, skin weights, topology, uvs | m 2.799, f 4.166 |
| 113 | `SK_Pirate_CaptainHat_M` | 1 | 1 | reworked in S12 | normals, uvs | m 0.2, f 0.159 |
| 114 | `SK_Pirate_PirateBandolier_M` | 1 | 1 | reworked in S12 | normals, uvs | f 3.205, m 0.977 |
| 115 | `SK_Pirate_PoetShirtWithVest_M` | 1 | 1 | reworked in S12 | normals, positions, skin weights, topology, uvs, vertex colour | f 4.242, m 2.471 |
| 116 | `SK_Robots_ConicalHatSciFi_M` | 1 | 1 | reworked in S12 | normals, positions, skin weights, topology, uvs | f 0.07, m 0.185 |
| 117 | `SK_Robots_DiscoBotGloves_M` | 1 | 1 | reworked in S12 | normals, positions, skin weights, topology, uvs | m 0.647, f 0.603 |
| 118 | `SK_Robots_DiscoKeychain_M` | 1 | 1 | reworked in S12 | normals, positions, skin weights, topology, uvs, vertex colour | f 1.905, m 2.348 |
| 119 | `SK_Robots_DiscoNecklace_M` | 1 | 1 | reworked in S12 | normals, positions, skin weights, topology, uvs | f 0.999, m 1.519 |
| 120 | `SK_Samurai_ClothTop_M` | 1 | 1 | reworked in S12 | bones, normals, positions, skin weights, topology, uvs, vertex colour | m 3.147, f 3.209 |
| 121 | `SK_SciFi_CyberBoots_M` | 1 | 1 | reworked in S12 | bones, skin weights | f 0.354 |
| 122 | `SK_SciFi_Gloves_M` | 1 | 1 | reworked in S12 | skin weights | m 0.019, f 0.016 |
| 123 | `SK_Space_AstronautSuit_M` | 1 | 1 | reworked in S12 | normals, positions, skin weights, topology, uvs, vertex colour | f 2.887, m 3.36 |
| 124 | `SK_Space_BountyHunterPants_M` | 1 | 1 | reworked in S12 | normals, positions, skin weights, topology, uvs, vertex colour | f 1.99, m 1.832 |
| 125 | `SK_Space_PioneerTechConsole_M` | 1 | 1 | reworked in S12 | normals, uvs | f 4.287, m 0.0 |
| 126 | `SK_Space_SpaceBrain_M` | 1 | 1 | reworked in S12 | normals, uvs | m 0.249, f 0.257 |
| 127 | `SK_Space_SpaceCombatPouches_M` | 1 | 1 | reworked in S12 | uvs | m 0.055, f 0.893 |
| 128 | `SK_Space_SpaceCombatTorso_M` | 1 | 1 | reworked in S12 | normals, positions, skin weights, topology, uvs, vertex colour | f 4.464, m 3.728 |
| 129 | `SK_Space_SpaceSuitPantsUltimate_M` | 1 | 1 | reworked in S12 | bones, skin weights, uvs | m 0.307, f 1.254 |
| 130 | `SK_Space_SpaceSuitPants_M` | 1 | 1 | reworked in S12 | normals, positions, skin weights, topology, uvs | m 2.774, f 2.967 |
| 131 | `SK_Space_SpaceTopVest_M` | 1 | 1 | reworked in S12 | normals, positions, skin weights, topology, uvs, vertex colour | f 5.593, m 4.13 |
| 132 | `SK_Sport_FencerGlove_M` | 1 | 1 | reworked in S12 | morph set, normals, positions, skin weights, topology, uvs |  |
| 133 | `SK_Streetwear_BoilerSuitPants_M` | 1 | 1 | reworked in S12 | skin weights | m 0.468, f 1.385 |
| 134 | `SK_Streetwear_BraidedBraceletSet_M` | 1 | 1 | reworked in S12 | normals, uvs | m 0.243, f 0.254 |
| 135 | `SK_Streetwear_ChromeJacket_M` | 1 | 1 | reworked in S12 | attribute set, bones, normals, topology, uvs | m 0.004, f 3.315 |
| 136 | `SK_Streetwear_CropTopHoodie_M` | 1 | 1 | reworked in S12 | skin weights | f 3.184, m 1.384 |
| 137 | `SK_Streetwear_Crown_M` | 1 | 1 | reworked in S12 | normals, positions, topology, uvs | f 0.459, m 0.468 |
| 138 | `SK_Streetwear_CrystalHeadband_M` | 1 | 1 | reworked in S12 | uvs | m 0.252, f 0.23 |
| 139 | `SK_Streetwear_KandiBracelet_M` | 1 | 1 | reworked in S12 | normals, positions, skin weights, topology, uvs | m 0.621, f 0.423 |
| 140 | `SK_Streetwear_OpenJacket_M` | 1 | 1 | reworked in S12 | bones, normals, positions, skin weights, topology, uvs, vertex colour | m 5.12, f 5.313 |
| 141 | `SK_Streetwear_PopBraceletSet_M` | 1 | 1 | reworked in S12 | attribute set, skin weights, uvs | f 0.251, m 0.219 |
| 142 | `SK_Streetwear_PopGothShoes_M` | 1 | 1 | reworked in S12 | normals, positions, skin weights, topology, uvs | f 2.173, m 1.336 |
| 143 | `SK_Streetwear_ShoulderBag_M` | 1 | 1 | reworked in S12 | normals, positions, skin weights, topology, uvs | f 4.904, m 3.118 |
| 144 | `SK_Streetwear_SmartWatch_M` | 1 | 1 | reworked in S12 | normals, positions, skin weights, topology, uvs | m 0.795, f 0.736 |
| 145 | `SK_Streetwear_TwistedBraceletSet_M` | 1 | 1 | reworked in S12 | normals | f 0.275, m 0.253 |
| 146 | `SK_Traditional_CloudBag_M` | 1 | 1 | reworked in S12 | normals, positions, skin weights, topology, uvs | f 3.183, m 4.066 |
| 147 | `SK_Traditional_LunarBracelet_M` | 1 | 1 | reworked in S12 | normals, positions, skin weights, topology, uvs, vertex colour |  |
| 148 | `SK_Traditional_RabbitMask_M` | 1 | 1 | reworked in S12 | bones | m 0.25, f 0.303 |
| 149 | `SK_Winter_HoodWrap_M` | 1 | 1 | reworked in S12 | normals, uvs | f 0.239, m 0.207 |
| 150 | `SK_Streetwear_Hoodie_M` | 0 | 37 | reworked in S12 | attribute set, uvs | f 3.681, m 0.001 |
| 151 | `SK_Socks_Quarter_M` | 0 | 21 | reworked in S12 | attribute set, uvs | m 0.16, f 0.207 |
| 152 | `SK_Streetwear_TrackSuitPants_M` | 0 | 13 | reworked in S12 | skin weights | m 0.001, f 1.385 |
| 153 | `SK_Streetwear_HeistTorso_M` | 0 | 12 | reworked in S12 | bones, skin weights | m 1.189, f 3.234 |
| 154 | `SK_Streetwear_UtilityBelt_M` | 0 | 12 | reworked in S12 | bones, normals, positions, skin weights, topology, uvs | m 2.995, f 2.789 |
| 155 | `SK_Winter_SkiPants_M` | 0 | 12 | reworked in S12 | skin weights | m 0.0, f 1.334 |
| 156 | `SK_Casual_ShortDress_M` | 0 | 10 | reworked in S12 | bones, skin weights | m 0.0, f 3.19 |
| 157 | `SK_Military_DoubleHolsterPants_M` | 0 | 10 | reworked in S12 | morph set, normals, positions, skin weights, topology, uvs |  |
| 158 | `SK_Sport_Cleats_M` | 0 | 10 | reworked in S12 | morph set |  |
| 159 | `SK_Streetwear_TightTechPants_M` | 0 | 10 | reworked in S12 | normals, positions, skin weights, topology, uvs | m 3.28, f 4.453 |
| 160 | `SK_Military_CombatVest_M` | 0 | 8 | reworked in S12 | bones, skin weights | m 1.409, f 3.605 |
| 161 | `SK_Socks_ThighHigh_M` | 0 | 8 | reworked in S12 | attribute set, uvs | f 0.538 |
| 162 | `SK_Streetwear_ChainNecklace_M` | 0 | 8 | no pre-S12 copy | skin weights | f 0.457, m 0.635 |
| 163 | `SK_Casual_LongCoat_M` | 0 | 7 | reworked in S12 | skin weights | f 2.063 |
| 164 | `SK_FancyDress_DressShoes_M` | 0 | 6 | reworked in S12 | normals, positions, skin weights, topology, uvs | f 0.378, m 0.337 |
| 165 | `SK_Streetwear_ClosedRainJacket_M` | 0 | 6 | reworked in S12 | bones, normals, skin weights | m 1.417, f 3.269 |
| 166 | `SK_Municipal_RescueHarness_M` | 0 | 5 | reworked in S12 | normals, positions, skin weights, topology, uvs | m 2.211, f 1.542 |
| 167 | `SK_Streetwear_DadJeans_M` | 0 | 5 | reworked in S12 | skin weights | f 1.79, m 1.59 |
| 168 | `SK_Streetwear_PufferVest_M` | 0 | 5 | reworked in S12 | normals, skin weights, uvs | f 3.25, m 1.346 |
| 169 | `SK_Military_SWATVest_M` | 0 | 3 | reworked in S12 | normals, positions, skin weights, topology, uvs | f 5.542, m 5.023 |
| 170 | `SK_WorkUniforms_ShirtRolledUpSleeves_M` | 0 | 3 | reworked in S12 | morph set, normals, positions, skin weights, topology, uvs, vertex colour |  |
| 171 | `SK_WorkUniforms_Tie_M` | 0 | 3 | reworked in S12 | normals | m 0.141, f 3.143 |
| 172 | `SK_Casual_BikerVestDetailsPunk_M` | 0 | 2 | no pre-S12 copy | skin weights | f 3.487 |
| 173 | `SK_Casual_SleeveDetailsPunk_M` | 0 | 2 | no pre-S12 copy | skin weights | f 0.721, m 0.0 |
| 174 | `SK_FromTencent_AsianSpiritJacket_M` | 0 | 2 | reworked in S12 | rest pose | f 3.189 |
| 175 | `SK_FromTencent_AsianSpiritWraps01_M` | 0 | 2 | reworked in S12 | normals, positions, skin weights, topology, uvs, vertex colour |  |
| 176 | `SK_Hologram_VaiiyaVestHologram_M` | 0 | 2 | reworked in S12 | bones, morph set, normals, positions, skin weights, topology, uvs, vertex colour |  |
| 177 | `SK_Medieval_DemonPants_M` | 0 | 2 | no pre-S12 copy | skin weights | f 1.258 |
| 178 | `SK_Medieval_TacticalKnightBracers_M` | 0 | 2 | no pre-S12 copy | bones, skin weights | m 0.0, f 0.556 |
| 179 | `SK_Medieval_TacticalKnightTop_M` | 0 | 2 | no pre-S12 copy | normals, positions, skin weights, topology, uvs, vertex colour | f 4.587, m 3.631 |
| 180 | `SK_Mexico_AncientArmDetails_M` | 0 | 2 | reworked in S12 | normals, positions, skin weights, topology, uvs | m 1.333, f 0.78 |
| 181 | `SK_Military_TacticalHarness_M` | 0 | 2 | reworked in S12 | normals, positions, skin weights, topology, uvs | m 5.071, f 5.752 |
| 182 | `SK_Ninja_ShinobiJacket_M` | 0 | 2 | reworked in S12 | normals, positions, skin weights, topology, uvs, vertex colour | m 4.31, f 4.565 |
| 183 | `SK_Robots_CordBelt_M` | 0 | 2 | reworked in S12 | bones, skin weights | f 1.067 |
| 184 | `SK_Space_AstroPilotGun_M` | 0 | 2 | reworked in S12 | normals, positions, skin weights, topology, uvs | f 1.541, m 2.16 |
| 185 | `SK_Space_AstroPilotPants_M` | 0 | 2 | reworked in S12 | normals, positions, skin weights, topology, uvs | m 2.68, f 3.8 |
| 186 | `SK_Streetwear_BikerJacket_M` | 0 | 2 | reworked in S12 | attribute set, skin weights, uvs | f 3.683, m 0.0 |
| 187 | `SK_Streetwear_HeistVest_M` | 0 | 2 | reworked in S12 | bones, skin weights | m 1.683, f 3.608 |
| 188 | `SK_Streetwear_PopLanyardArmbandRight_M` | 0 | 2 | no pre-S12 copy | skin weights | f 0.241, m 0.245 |
| 189 | `SK_Streetwear_ShortDressSleeves_M` | 0 | 2 | no pre-S12 copy | skin weights | f 1.867, m 1.166 |
| 190 | `SK_Historic_AnubisJewelry_M` | 0 | 1 | reworked in S12 | vertex colour | f 0.6 |
| 191 | `SK_Hologram_BackHologram01_M` | 0 | 1 | no pre-S12 copy | bones, skin weights | f 0.974 |
| 192 | `SK_Hologram_EngimoJacketHologram02_M` | 0 | 1 | reworked in S12 | bones, skin weights | f 0.799 |
| 193 | `SK_Hologram_EngimoJacketHologram_M` | 0 | 1 | reworked in S12 | bones, normals, positions, skin weights, topology, uvs, vertex colour | f 4.547, m 3.339 |
| 194 | `SK_Hologram_IseultPantsHologram_M` | 0 | 1 | reworked in S12 | bones, normals, positions, skin weights, topology, uvs | f 4.122, m 2.042 |
| 195 | `SK_Medieval_TacticalKnightBelt_M` | 0 | 1 | no pre-S12 copy | normals, positions, skin weights, topology, uvs | f 3.371, m 2.772 |
| 196 | `SK_Military_AssaultPantsNoKneepad_M` | 0 | 1 | reworked in S12 | normals, positions, skin weights, topology, uvs | m 0.74, f 1.357 |
| 197 | `SK_Military_CardboardCombatVest_M` | 0 | 1 | reworked in S12 | bones, normals, positions, skin weights | f 3.298, m 0.588 |
| 198 | `SK_Military_CardboardPants_M` | 0 | 1 | reworked in S12 | bones, normals, positions, skin weights, topology, uvs, vertex colour |  |
| 199 | `SK_Robots_RobotWarriorTop_M` | 0 | 1 | reworked in S12 | morph set, normals, positions, skin weights, topology, uvs |  |
| 200 | `SK_Robots_RobotWristCovers_M` | 0 | 1 | reworked in S12 | skin weights | f 0.018 |
| 201 | `SK_Socks_KneeHigh_M` | 0 | 1 | reworked in S12 | attribute set, normals, positions, skin weights, topology, uvs | m 0.321, f 0.557 |
| 202 | `SK_Streetwear_CroppedTshirtOversize_M` | 0 | 1 | no pre-S12 copy | bones, skin weights | m 1.283, f 3.124 |
| 203 | `SK_Streetwear_PopLanyardArmbandLeft_M` | 0 | 1 | no pre-S12 copy | skin weights | m 0.226, f 0.25 |
| 204 | `SK_Streetwear_TechCropTopArmPouch_M` | 0 | 1 | reworked in S12 | bones, skin weights | f 1.035, m 1.109 |
| 205 | `SK_Streetwear_TechCropTopNoBags_M` | 0 | 1 | reworked in S12 | bones, normals, positions, skin weights, topology, uvs, vertex colour | f 3.497, m 3.064 |
| 206 | `SK_Streetwear_UncappedPleatedSkirt_M` | 0 | 1 | reworked in S12 | bones, skin weights | m 1.257, f 1.899 |
| 207 | `SK_Historic_AnubisMask_M` | 0 | 0 | no pre-S12 copy | morph set, normals, positions, topology, uvs |  |
| 208 | `SK_Traditional_CloudBagMirrored_M` | 0 | 0 | no pre-S12 copy | normals, positions, topology, uvs | f 3.122, m 3.348 |
| 209 | `SK_Traditional_LunarBoleroShortSleeve_M` | 0 | 0 | no pre-S12 copy | skin weights | f 2.108, m 0.815 |
| 210 | `SK_Traditional_LunarCape_M` | 0 | 0 | no pre-S12 copy | bones, skin weights | f 1.349, m 0.857 |
| 211 | `SK_Traditional_LunarDressTop_M` | 0 | 0 | no pre-S12 copy | morph set, skin weights |  |
| 212 | `SK_Traditional_LunarDress_M` | 0 | 0 | no pre-S12 copy | normals, positions, skin weights, topology, uvs | f 3.292, m 2.546 |
| 213 | `SK_Traditional_LunarLegCover_M` | 0 | 0 | no pre-S12 copy | bones, normals, positions, skin weights, topology, uvs | f 3.765, m 2.866 |

## Not blocking: live GLB already carries the S12 morphs (29 meshes)

Same vertices as the S12 rebuild and no morph delta changed, so they stay live in this batch. Season 12 changed something else about them, listed here for the refresh route.

| Mesh | Shows | Class | S12 changed |
|---|---:|---|---|
| `SK_BeardAnchorHalf_M` | 7 | live-derived | none beyond our processing |
| `SK_BeardFull_M` | 7 | live-derived | none beyond our processing |
| `SK_Casual_FrontTieCropTopSleeves_M` | 1 | no pre-S12 copy | skin weights |
| `SK_Casual_WaterproofGloves_M` | 3 | reworked in S12 | normals, uvs |
| `SK_Casual_WinterScarf_M` | 1 | reworked in S12 | normals, skin weights |
| `SK_Cowboy_CasualPants_M` | 5 | reworked in S12 | attribute set, uvs |
| `SK_Cowboy_Coat_M` | 2 | no pre-S12 copy | skin weights |
| `SK_Cowboy_DusterCoat_M` | 2 | no pre-S12 copy | attribute set, skin weights |
| `SK_Cowboy_Poncho_M` | 2 | live-derived | none beyond our processing |
| `SK_DivingHelmet_01_A_M` | 1 | live-derived | none beyond our processing |
| `SK_FancyDress_Harness_M` | 1 | no pre-S12 copy | skin weights |
| `SK_Head_Face_14_Base` | 0 | live-derived | none beyond our processing |
| `SK_Head_Face_15_Base` | 0 | live-derived | none beyond our processing |
| `SK_Head_Face_18_Base` | 0 | live-derived | none beyond our processing |
| `SK_Head_Face_30_Base` | 0 | no pre-S12 copy | attribute set |
| `SK_Historic_EasternEmperorCape_M` | 1 | no pre-S12 copy | skin weights |
| `SK_Historic_EasternEmperorUpperBodyUltimate_M` | 1 | no pre-S12 copy | attribute set, skin weights |
| `SK_Historic_VikingCloak_M` | 4 | live-derived | none beyond our processing |
| `SK_Medieval_JesterTornNeckCape_M` | 1 | live-derived | none beyond our processing |
| `SK_Medieval_KnightArmCloths_M` | 1 | reworked in S12 | vertex colour |
| `SK_Military_TigerWarriorArmour_M` | 3 | no pre-S12 copy | skin weights |
| `SK_MulletShort_M` | 2 | live-derived | none beyond our processing |
| `SK_MulletWavy_M` | 6 | live-derived | none beyond our processing |
| `SK_Pirate_CaptainCape_M` | 1 | reworked in S12 | normals, skin weights, topology, uvs, vertex colour |
| `SK_SciFi_TigerRobotBomberJacketStraps_M` | 1 | no pre-S12 copy | skin weights |
| `SK_SciFi_UrbanTechVest_M` | 1 | no pre-S12 copy | skin weights |
| `SK_Space_SpaceCape_M` | 1 | no pre-S12 copy | skin weights |
| `SK_WorkUniforms_Apron_M` | 1 | no pre-S12 copy | attribute set, skin weights |
| `SK_WorkUniforms_CuteDressTop_M` | 1 | no pre-S12 copy | attribute set, skin weights |
