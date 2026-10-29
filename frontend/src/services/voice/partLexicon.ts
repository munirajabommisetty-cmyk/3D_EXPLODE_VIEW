/**
 * Part lexicon (Task V2): spoken names for the components of the CURRENTLY LOADED model.
 *
 * Built generically from each model's own data — component IDs, assembly-tree names and
 * metadata names — never from a hard-coded gearbox list. For each English name we add:
 *   - parenthesised alternatives ("Outer Annulus (Ring Gear)" -> "outer annulus", "ring gear")
 *   - singular/plural and short forms ("upper compression chords" -> "compression chord", "chords")
 *   - Telugu- and Hindi-script spellings of English engineering terms, because Prisma writes
 *     English loanwords in the native script for te-IN / hi-IN ("సన్ గేర్", "सन गियर").
 * Single-word forms are kept only when they identify exactly one component.
 */

import type { AssemblyTreeNode, EngineeringModelDefinition } from '../../types/models';

export interface LexiconEntry {
  componentId: string;
  /** Display name used in replies (English technical name). */
  displayName: string;
  /** Normalised phrases that refer to this component. */
  phrases: string[];
}

/** English engineering words -> spellings Prisma produces in Telugu / Hindi script. */
export const LOANWORD_SPELLINGS: Record<string, { te: string[]; hi: string[]; bn?: string[] }> = {
  sun: { te: ['సన్'], hi: ['सन'] },
  // bn (Stage 2): Prisma-verified spelling only ("গিয়ারটা সিলেক্ট করো"); other Bengali names not verified yet
  gear: { te: ['గేర్', 'గియర్'], hi: ['गियर', 'गेयर'], bn: ['গিয়ার'] },
  gears: { te: ['గేర్లు', 'గేర్స్'], hi: ['गियर्स', 'गियरों'] },
  planet: { te: ['ప్లానెట్', 'ప్లానెట'], hi: ['प्लैनेट', 'प्लेनेट'] },
  ring: { te: ['రింగ్'], hi: ['रिंग'] },
  carrier: { te: ['క్యారియర్', 'కారియర్'], hi: ['कैरियर', 'कैरीयर'] },
  plate: { te: ['ప్లేట్'], hi: ['प्लेट'] },
  plates: { te: ['ప్లేట్లు', 'ప్లేట్స్'], hi: ['प्लेट्स'] },
  shaft: { te: ['షాఫ్ట్'], hi: ['शाफ्ट', 'शाफ़्ट'] },
  drive: { te: ['డ్రైవ్'], hi: ['ड्राइव'] },
  central: { te: ['సెంట్రల్'], hi: ['सेंट्रल'] },
  outer: { te: ['ఔటర్'], hi: ['आउटर'] },
  annulus: { te: ['అన్యులస్'], hi: ['एनुलस'] },
  primary: { te: ['ప్రైమరీ'], hi: ['प्राइमरी'] },
  top: { te: ['టాప్'], hi: ['टॉप'] },
  bottom: { te: ['బాటమ్'], hi: ['बॉटम'] },
  upper: { te: ['అప్పర్'], hi: ['अपर'] },
  lower: { te: ['లోయర్'], hi: ['लोअर'] },
  chord: { te: ['కార్డ్'], hi: ['कॉर्ड'] },
  chords: { te: ['కార్డ్స్', 'కార్డులు'], hi: ['कॉर्ड्स'] },
  diagonal: { te: ['డయాగనల్'], hi: ['डायगोनल', 'डायगनल'] },
  member: { te: ['మెంబర్'], hi: ['मेंबर'] },
  members: { te: ['మెంబర్స్'], hi: ['मेंबर्स'] },
  vertical: { te: ['వర్టికల్'], hi: ['वर्टिकल'] },
  strut: { te: ['స్ట్రట్'], hi: ['स्ट्रट'] },
  struts: { te: ['స్ట్రట్స్'], hi: ['स्ट्रट्स'] },
  gusset: { te: ['గస్సెట్', 'గసెట్'], hi: ['गसेट'] },
  end: { te: ['ఎండ్'], hi: ['एंड'] },
  portal: { te: ['పోర్టల్'], hi: ['पोर्टल'] },
  portals: { te: ['పోర్టల్స్'], hi: ['पोर्टल्स'] },
  bridge: { te: ['బ్రిడ్జ్', 'బ్రిడ్జి'], hi: ['ब्रिज'] },
  deck: { te: ['డెక్'], hi: ['डेक'] },
  support: { te: ['సపోర్ట్'], hi: ['सपोर्ट'] },
  pier: { te: ['పియర్'], hi: ['पियर'] },
  piers: { te: ['పియర్స్'], hi: ['पियर्स'] },
  // Reinforced concrete frame (as Prisma writes these loanwords in te / hi / bn script)
  slab: { te: ['స్లాబ్', 'స్లాబు'], hi: ['स्लैब', 'स्लेब'], bn: ['স্ল্যাব', 'স্লাব'] },
  slabs: { te: ['స్లాబ్స్', 'స్లాబులు'], hi: ['स्लैब्स'] },
  column: { te: ['కాలమ్', 'కాలమ్మ్'], hi: ['कॉलम', 'कालम'], bn: ['কলাম'] },
  columns: { te: ['కాలమ్స్', 'కాలములు', 'కాలమ్లు'], hi: ['कॉलम्स', 'कॉलमों', 'कालम्स'], bn: ['কলামগুলো'] },
  beam: { te: ['బీమ్', 'బీం'], hi: ['बीम'], bn: ['বিম'] },
  beams: { te: ['బీమ్స్', 'బీములు'], hi: ['बीम्स', 'बीमों'], bn: ['বিমগুলো'] },
  footing: { te: ['ఫుటింగ్'], hi: ['फुटिंग'] },
  footings: { te: ['ఫుటింగ్స్', 'ఫుటింగులు'], hi: ['फुटिंग्स'] },
  joint: { te: ['జాయింట్'], hi: ['जॉइंट', 'ज्वाइंट'] },
  joints: { te: ['జాయింట్స్', 'జాయింట్లు'], hi: ['जॉइंट्स', 'ज्वाइंट्स'] },
  a: { te: ['ఏ'], hi: ['ए'] },
  b: { te: ['బీ', 'బి'], hi: ['बी'] },
  c: { te: ['సీ', 'సి'], hi: ['सी'] },
};

/** Lower-case, strip punctuation, Devanagari nukta and zero-width joiners, collapse spaces. */
export function normalise(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[़‌‍]/g, '')
    .replace(/[.,!?;:"'()[\]{}|/\\\-–—_&।॥]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const singular = (w: string) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
const STOP_WORDS = new Set(['and', 'the', 'of', 'cluster', 'assembly', 'system', 'stage']);

/** English phrase variants of one name. */
function englishVariants(name: string): string[] {
  const parts = name.split(/[()&,]/).map((p) => normalise(p)).filter(Boolean);
  const out = new Set<string>();
  for (const p of parts) {
    const words = p.split(' ').filter((w) => !STOP_WORDS.has(w));
    if (words.length === 0) continue;
    out.add(words.join(' '));
    out.add(words.map(singular).join(' '));
    // drop a trailing single letter / digit ("planet gear a" -> "planet gear")
    if (words.length > 1 && /^([a-z]|\d+)$/.test(words[words.length - 1])) {
      out.add(words.slice(0, -1).join(' '));
    }
    // trailing two-word form ("upper compression chords" -> "compression chords")
    if (words.length > 2) {
      out.add(words.slice(-2).join(' '));
      out.add(words.slice(-2).map(singular).join(' '));
    }
    // single words (filtered for uniqueness later)
    for (const w of words) {
      if (w.length > 3) {
        out.add(w);
        out.add(singular(w));
      }
    }
  }
  return [...out];
}

/** Telugu / Hindi spellings of an English phrase, only when every word has a known spelling. */
function scriptVariants(phrase: string): string[] {
  const words = phrase.split(' ');
  const out: string[] = [];
  for (const script of ['te', 'hi', 'bn'] as const) {
    let combos: string[] = [''];
    for (const w of words) {
      const spellings = LOANWORD_SPELLINGS[w]?.[script];
      if (!spellings) {
        combos = [];
        break;
      }
      combos = combos.flatMap((c) => spellings.map((s) => (c ? `${c} ${s}` : s)));
    }
    out.push(...combos.map(normalise));
  }
  return out;
}

function collectTreeNames(node: AssemblyTreeNode, into: Map<string, string[]>): void {
  if (node.componentId) {
    const list = into.get(node.componentId) ?? [];
    list.push(node.name);
    into.set(node.componentId, list);
  }
  node.children?.forEach((c) => collectTreeNames(c, into));
}

export function buildPartLexicon(model: EngineeringModelDefinition): LexiconEntry[] {
  const treeNames = new Map<string, string[]>();
  collectTreeNames(model.getAssemblyTree(), treeNames);

  const raw = model.getAllComponentIds().map((componentId) => {
    const meta = model.getComponentMetadata(componentId);
    const names = [
      componentId.replace(/_/g, ' ').replace(/\s\d+$/, ''),
      ...(treeNames.get(componentId) ?? []),
      ...(meta?.name ? [meta.name] : []),
    ];
    const english = new Set(names.flatMap(englishVariants));
    const phrases = new Set<string>(english);
    english.forEach((p) => scriptVariants(p).forEach((v) => phrases.add(v)));
    return {
      componentId,
      displayName: treeNames.get(componentId)?.[0] ?? meta?.name ?? componentId,
      phrases,
    };
  });

  // Single-word phrases must identify exactly one component; multi-word ones may be shared
  // (e.g. "planet gear" -> A, B and C, resolved later as an ambiguity).
  const singleWordOwners = new Map<string, Set<string>>();
  for (const e of raw) {
    for (const p of e.phrases) {
      if (!p.includes(' ')) {
        const owners = singleWordOwners.get(p) ?? new Set();
        owners.add(e.componentId);
        singleWordOwners.set(p, owners);
      }
    }
  }
  // Words of the model's own name ("bridge", "truss", "gearbox") refer to the whole model, so they
  // are never single-word aliases of one part (Task V4: "explain the bridge" is a model question).
  const modelWords = new Set<string>();
  for (const w of normalise(model.name).split(' ')) {
    modelWords.add(w);
    modelWords.add(singular(w));
    scriptVariants(w).forEach((v) => modelWords.add(v));
  }
  // Context-only components (e.g. the brain's untaught "other atlas regions") keep only their full
  // multi-word names: common single words such as "other" must not name a part.
  const context = new Set(model.contextComponentIds ?? []);
  // A shared single word still names the part whose WHOLE name it is ("column" -> Columns, not
  // Column ties or Column longitudinal bars; "piston" -> Piston, not Piston rod)
  const wholeName = new Map<string, string>();
  for (const id of model.getAllComponentIds()) {
    const n = normalise(model.getComponentMetadata(id)?.name ?? '').replace(/\s*\(.*$/, '');
    // (also its Telugu / Hindi / Bengali spellings: "స్లాబ్" is the Slab, not Slab reinforcement)
    if (n && !n.includes(' ')) for (const v of [n, singular(n), ...scriptVariants(n), ...scriptVariants(singular(n))]) wholeName.set(v, id);
  }
  const owns = (p: string, id: string) => singleWordOwners.get(p)!.size === 1 || wholeName.get(p) === id;
  return raw.map((e) => ({
    componentId: e.componentId,
    displayName: e.displayName,
    phrases: [...e.phrases].filter((p) => (p.includes(' ') && (!context.has(e.componentId) || p.split(' ').length > 2))
      || (!context.has(e.componentId) && owns(p, e.componentId) && !modelWords.has(p))),
  }));
}
