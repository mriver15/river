// "Hands and Fire": the first rungs of making, from stone and bone to a smelted blade. Everything follows the engine's rules: a thing can do what its materials and
// shape allow and nothing its name claims, parts are matched by capability, and the hard steps (firing, smelting) happen beside a fire.
import type { ContentPack } from "./index.ts";

export const handwork: ContentPack = {
  id: "handwork",
  title: "Hands and Fire",
  inspiration: ["Robinson Crusoe and Cast Away: making do with what the shore gives", "Hatchet: a knife is the difference between surviving and not", "Primitive Technology: clay, charcoal and a furnace built from the ground up", "the Stone, Bronze and Iron ages as a ladder where each tool makes the next possible"],
  materials: {
    reed: { look: [0xb9b46a, 1, 0], density: 120, retention: 0.1, traits: ["burns"], fuel: { burnSecondsPerKg: 150, heatC: 250 }, flammability: 0.7, flexible: true },
    ore: { look: [0x6d6a62, 0.95, 0], density: 4000, retention: 0.6, traits: ["hard", "ore"], flammability: 0 },
    copper: { look: [0xdc8a50, 0.45, 0.25], density: 8900, retention: 0.7, traits: ["hard"], flammability: 0 },
  },
  items: [
    { id: "reed", aliases: ["reed", "reeds"], name: "reed", desc: "A long, supple green reed, hollow inside. It bends double without breaking.", dims: { l: 0.9, w: 0.025, h: 0.025 }, massKg: 0.01, parts: [{ material: "reed", fraction: 1 }], tags: ["strip", "long"], fungible: true, visual: "strip" },
    { id: "copper_ore", aliases: ["copper ore", "ore", "green stone"], name: "green-streaked stone", desc: "A heavy stone shot through with green and a dull orange. It is far heavier than a stone of its size should be.", dims: { l: 0.1, w: 0.08, h: 0.07 }, massKg: 0.9, parts: [{ material: "ore", fraction: 1 }], tags: [], fungible: true, visual: "lump" },
    { id: "copper_ingot", aliases: ["copper ingot", "ingot"], name: "copper ingot", desc: "A small bar of soft, bright, reddish metal, still faintly pitted from the fire.", dims: { l: 0.1, w: 0.04, h: 0.02 }, massKg: 0.4, parts: [{ material: "copper", fraction: 1 }], tags: [], fungible: true, visual: "ingot" },
    { id: "stone_knife", aliases: ["stone knife", "knife"], name: "stone knife", dims: { l: 0.22, w: 0.04, h: 0.03 }, massKg: 0.25, parts: [{ material: "stone", fraction: 0.5 }, { material: "wood", fraction: 0.5 }], tags: ["edge", "long"], fungible: false, worn: true, visual: "knife" },
    { id: "stone_axe", aliases: ["stone axe", "axe", "hand axe"], name: "stone axe", dims: { l: 0.5, w: 0.1, h: 0.04 }, massKg: 1.0, parts: [{ material: "stone", fraction: 0.4 }, { material: "wood", fraction: 0.6 }], tags: ["edge", "long"], fungible: false, worn: true, visual: "axe" },
    { id: "copper_knife", aliases: ["copper knife"], name: "copper knife", dims: { l: 0.25, w: 0.04, h: 0.02 }, massKg: 0.35, parts: [{ material: "copper", fraction: 0.6 }, { material: "wood", fraction: 0.4 }], tags: ["edge", "long"], fungible: false, worn: true, visual: "knife" },
    { id: "reed_basket", aliases: ["reed basket"], name: "reed basket", dims: { l: 0.4, w: 0.35, h: 0.3 }, massKg: 0.25, parts: [{ material: "reed", fraction: 1 }], tags: ["hollow"], fungible: false, container: { capacityKg: 6, volumeL: 14 }, worn: true, visual: "basket" },
    { id: "clay_pot", aliases: ["clay pot", "pot"], name: "fired clay pot", dims: { l: 0.22, w: 0.22, h: 0.2 }, massKg: 1.4, parts: [{ material: "clay", fraction: 1 }], tags: ["hollow"], fungible: false, container: { capacityKg: 3, volumeL: 3 }, worn: true, visual: "pot" },
  ],
  deposits: [
    { name: "copper seam", kind: "rock", count: 3, height: [2.4, 9], props: { stock: 3, max: 4, yields: ["copper_ore"], desc: "A seam in the rock where the stone turns green and orange, heavy and streaked. It is slow to give anything up." } },
    { name: "reed bed", kind: "bush", count: 4, height: [0.25, 0.9], props: { stock: 4, max: 6, yields: ["reed"], desc: "A thick stand of tall reeds, rustling at the water's edge." } },
  ],
  recipes: [
    { id: "stone_knife", version: "1", name: "stone knife", summary: "Lash a sharp-edged stone to a short handle with something that binds.", durationMs: 5000, energy: 3, qualityFrom: "parts",
      roles: [{ role: "blade", needs: ["cuts"], qty: 1, consumed: true }, { role: "handle", needs: ["shaft"], qty: 1, consumed: true }, { role: "binding", needs: ["binds"], qty: 1, consumed: true }],
      limits: { massKg: 2, connections: 2 },
      output: { def: "stone_knife", qty: 1, name: "stone knife", desc: "A flaked stone lashed to a short wooden handle. It cuts cleanly and can be used again and again.", kind: "weapon", stats: { dmg: 8, reach: 1.3 } } },
    { id: "stone_axe", version: "1", name: "stone axe", summary: "Lash a heavy sharp-edged stone to a long haft with something that binds.", durationMs: 7000, energy: 4, qualityFrom: "parts",
      roles: [{ role: "head", needs: ["cuts"], qty: 1, consumed: true }, { role: "haft", needs: ["shaft"], qty: 1, consumed: true }, { role: "binding", needs: ["binds"], qty: 2, consumed: true }],
      limits: { massKg: 3, connections: 3 },
      output: { def: "stone_axe", qty: 1, name: "stone axe", desc: "A heavy stone head bound tight to a long haft. It hits hard and reaches a little farther than a knife.", kind: "weapon", stats: { dmg: 13, reach: 1.7 } } },
    { id: "reed_basket", version: "1", name: "reed basket", summary: "Weave reeds into a deep basket that holds a good load.", durationMs: 9000, energy: 4, qualityFrom: "none",
      roles: [{ role: "weave", needs: ["binds"], qty: 5, consumed: true }],
      output: { def: "reed_basket", qty: 1, name: "reed basket", desc: "A deep basket of woven reed, light and tight. It holds several kilos.", kind: "basket" } },
    { id: "clay_pot", version: "1", name: "fired clay pot", summary: "Shape a good deal of clay into a pot and fire it beside a fire.", durationMs: 12000, energy: 4, qualityFrom: "none", place: "fire",
      roles: [{ role: "clay", needs: ["moldable"], qty: 4, consumed: true }],
      output: { def: "clay_pot", qty: 1, name: "fired clay pot", desc: "A round, fired pot with a narrow neck. It holds a good deal and it is heavy.", kind: "bowl" } },
    { id: "copper_ingot", version: "1", name: "copper ingot", summary: "Heat green-streaked ore with fuel beside a fire until the metal runs out of it.", durationMs: 14000, energy: 4, qualityFrom: "none", place: "fire",
      roles: [{ role: "ore", needs: ["ore"], qty: 3, consumed: true }, { role: "fuel", needs: ["fuel"], qty: 2, consumed: true }],
      output: { def: "copper_ingot", qty: 1, name: "copper ingot", desc: "A small bar of soft, bright, reddish metal.", kind: "copper_ingot" } },
    { id: "copper_knife", version: "1", name: "copper knife", summary: "Hammer a copper ingot to an edge and bind it into a short handle.", durationMs: 8000, energy: 4, qualityFrom: "parts",
      roles: [{ role: "blade", needs: [], def: "copper_ingot", qty: 1, consumed: true }, { role: "handle", needs: ["shaft"], qty: 1, consumed: true }, { role: "binding", needs: ["binds"], qty: 1, consumed: true }, { role: "hammer", needs: ["hard"], qty: 1, consumed: false }],
      limits: { massKg: 2, connections: 3 },
      output: { def: "copper_knife", qty: 1, name: "copper knife", desc: "A bright blade of beaten copper in a wooden handle. It takes an edge better than stone, and it keeps it.", kind: "weapon", stats: { dmg: 12, reach: 1.3 } } },
  ],
};
