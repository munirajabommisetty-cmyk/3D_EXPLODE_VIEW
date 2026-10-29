/**
 * Voice layer tests (Task V2) — no network, no microphone.
 * 1. Part lexicon built from the loaded model
 * 2. Phrase parser: English, Telugu, Hindi and code-mixed commands
 * 3. Voice turns through the REAL V1 dispatcher + viewer executor + gearbox model
 * 4. Replies, recorder helpers and voice client error handling
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { modelRegistry } from '../src/models/registry';
import { PLANETARY_GEARBOX_MODEL_ID } from '../src/models/mechanical/planetaryGearboxModel';
import { WARREN_TRUSS_MODEL_ID } from '../src/models/civil/warrenTrussBridgeModel';
import { buildPartLexicon } from '../src/services/voice/partLexicon';
import { parseVoiceCommand, type ParseContext, type ParseOutcome } from '../src/services/voice/phraseParser';
import { foreignPartsFor, handleVoiceTurn, lexiconFor } from '../src/services/voice/voiceSession';
import { REPLY_KEYS, REPLY_TABLES, reply, replyLanguage } from '../src/services/voice/voiceReplies';
import { SpeechEndDetector, encodeWav, classifyMicError, rms } from '../src/services/voice/recorder';
import { getVoiceHealth, synthesize, transcribe, VoiceServiceError } from '../src/services/voice/voiceClient';
import { SceneCommandDispatcher } from '../src/services/commands/sceneCommandDispatcher';
import { ViewerCommandExecutor } from '../src/services/commands/viewerCommandExecutor';
import { CameraController } from '../src/components/scene/CameraController';
import { ModelLifecycleManager } from '../src/services/models/modelLifecycle';

const gearbox = modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID)!;
const bridge = modelRegistry.getModel(WARREN_TRUSS_MODEL_ID)!;
const ALL = modelRegistry.getAllModels();

function ctxFor(model = gearbox, extra: Partial<ParseContext> = {}): ParseContext {
  return {
    lexicon: lexiconFor(model),
    foreignParts: foreignPartsFor(model, ALL),
    selectedComponentId: null,
    lessonActive: false,
    ...extra,
  };
}

const parse = (text: string, extra: Partial<ParseContext> = {}, model = gearbox) => parseVoiceCommand(text, ctxFor(model, extra));
const cmds = (o: ParseOutcome) => (o.kind === 'commands' ? o.commands : null);

/* ------------------------------ 1. lexicon ------------------------------ */
describe('Part lexicon is built from the loaded model', () => {
  it('covers every gearbox component with English and native-script names', () => {
    const lex = buildPartLexicon(gearbox);
    assert.deepEqual(lex.map((e) => e.componentId).sort(), [...gearbox.getAllComponentIds()].sort());
    const sun = lex.find((e) => e.componentId === 'sun_gear')!;
    assert.ok(sun.phrases.includes('sun gear'));
    assert.ok(sun.phrases.includes('సన్ గేర్'));
    assert.ok(sun.phrases.includes('सन गियर'));
    const ring = lex.find((e) => e.componentId === 'ring_gear')!;
    assert.ok(ring.phrases.includes('ring gear') && ring.phrases.includes('outer annulus'));
  });

  it('keeps single words only when they identify exactly one part', () => {
    const lex = buildPartLexicon(gearbox);
    const owners = lex.filter((e) => e.phrases.includes('gear'));
    assert.equal(owners.length, 0, '"gear" alone is ambiguous and must not be a part name');
    assert.ok(lex.find((e) => e.componentId === 'central_shaft')!.phrases.includes('shaft'));
  });

  it('works for a different model (bridge) with no gearbox assumptions', () => {
    const lex = buildPartLexicon(bridge);
    assert.deepEqual(lex.map((e) => e.componentId).sort(), [...bridge.getAllComponentIds()].sort());
    assert.ok(lex.find((e) => e.componentId === 'bridge_deck')!.phrases.some((p) => p.includes('deck')));
  });
});

/* ------------------------------ 2. parser ------------------------------ */
describe('Phrase parser — English', () => {
  const cases: [string, unknown][] = [
    ['Zoom in', [{ type: 'camera.zoom', direction: 'in' }]],
    ['zoom out please', [{ type: 'camera.zoom', direction: 'out' }]],
    ['Move left', [{ type: 'camera.pan', direction: 'left' }]],
    ['move the view up', [{ type: 'camera.pan', direction: 'up' }]],
    ['Rotate left', [{ type: 'camera.orbit', yawDeg: 30, pitchDeg: 0 }]],
    ['rotate the gearbox', [{ type: 'camera.orbit', yawDeg: -30, pitchDeg: 0 }]],
    ['Show me the back', [{ type: 'camera.view', view: 'back' }]],
    ['top view', [{ type: 'camera.view', view: 'top' }]],
    ['show the left side', [{ type: 'camera.view', view: 'left' }]],
    ['Restore the original view', [{ type: 'camera.reset' }]],
    ['Explode the assembly', [{ type: 'assembly.explode', factor: 0.75 }]],
    ['Restore the assembly', [{ type: 'assembly.restore' }]],
    ['put everything back together', [{ type: 'assembly.restore' }]],
    ['Pause the animation', [{ type: 'animation.pause' }]],
    ['play the animation', [{ type: 'animation.play' }]],
    ['slow down the animation', [{ type: 'animation.setSpeed', speed: 0.5 }]],
    ['show all parts', [{ type: 'component.showAll' }]],
    ['start the lesson', [{ type: 'lesson.start' }]],
    ['go home', [{ type: 'workspace.goHome' }]],
  ];
  for (const [text, expected] of cases) {
    it(`"${text}"`, () => assert.deepEqual(cmds(parse(text)), expected));
  }

  it('"Select the sun gear" selects the real component', () => {
    assert.deepEqual(cmds(parse('Select the sun gear')), [{ type: 'component.select', componentId: 'sun_gear' }]);
  });

  it('"Separate this part" isolates the selected part (select + isolate + focus)', () => {
    assert.deepEqual(cmds(parse('Separate this part', { selectedComponentId: 'planet_carrier' })), [
      { type: 'component.select', componentId: 'planet_carrier' },
      { type: 'component.isolate', componentId: 'planet_carrier' },
      { type: 'component.focus', componentId: 'planet_carrier' },
    ]);
  });

  it('"Separate this part" with nothing selected asks for a selection', () => {
    assert.equal(parse('Separate this part').kind, 'needsSelection');
  });

  it('"hide the ring gear" and "focus on the shaft"', () => {
    assert.deepEqual(cmds(parse('hide the ring gear')), [{ type: 'component.visibility', componentIds: ['ring_gear'], visible: false }]);
    assert.deepEqual(cmds(parse('focus on the shaft')), [
      { type: 'component.select', componentId: 'central_shaft' },
      { type: 'component.focus', componentId: 'central_shaft' },
    ]);
  });

  it('"select the planet gear" is ambiguous (three planet gears)', () => {
    const o = parse('select the planet gear');
    assert.equal(o.kind, 'ambiguous');
    assert.deepEqual(o.kind === 'ambiguous' && o.options.sort(), ['planet_gear_1', 'planet_gear_2', 'planet_gear_3']);
  });

  it('"select planet gear B" picks exactly one', () => {
    assert.deepEqual(cmds(parse('select planet gear b')), [{ type: 'component.select', componentId: 'planet_gear_2' }]);
  });

  it('rejects a piston on the gearbox instead of inventing it', () => {
    const o = parse('select the piston');
    assert.equal(o.kind, 'unknownPart');
    assert.equal(o.kind === 'unknownPart' && o.spoken, 'piston');
  });

  it('a crankshaft is not mistaken for the gearbox shaft', () => {
    assert.equal(parse('focus on the crankshaft').kind, 'unknownPart');
  });

  it('a bridge part on the gearbox is reported as belonging to the bridge', () => {
    const o = parse('select the bridge deck');
    assert.ok(o.kind === 'unknownPart' && o.belongsTo === bridge.name);
  });

  it('lesson navigation only when a lesson is running', () => {
    assert.deepEqual(cmds(parse('next step', { lessonActive: true })), [{ type: 'lesson.next' }]);
    assert.notDeepEqual(cmds(parse('next step')), [{ type: 'lesson.next' }]);
  });

  it('unrelated speech is not turned into an action', () => {
    assert.equal(parse('what is the weather today').kind, 'noMatch');
    assert.equal(parse('').kind, 'noMatch');
  });
});

describe('Phrase parser — Telugu (incl. Telugu-English code-mixing)', () => {
  const cases: [string, unknown][] = [
    ['జూమ్ ఇన్ చెయ్యి', [{ type: 'camera.zoom', direction: 'in' }]],
    ['జూమ్ అవుట్ చేయండి', [{ type: 'camera.zoom', direction: 'out' }]],
    ['దగ్గరగా చూపించు జూమ్', [{ type: 'camera.zoom', direction: 'in' }]],
    ['ఎడమ వైపు జరుపు', [{ type: 'camera.pan', direction: 'left' }]],
    ['కుడికి తిప్పు', [{ type: 'camera.orbit', yawDeg: -30, pitchDeg: 0 }]],
    ['వెనుక వైపు చూపించు', [{ type: 'camera.view', view: 'back' }]],
    ['భాగాలను విడదీయి', [{ type: 'assembly.explode', factor: 0.75 }]],
    ['మళ్లీ కలుపు', [{ type: 'assembly.restore' }]],
    ['యానిమేషన్ ఆపు', [{ type: 'animation.pause' }]],
    ['రీసెట్ చేయి', [{ type: 'camera.reset' }]],
    ['zoom in చెయ్యి', [{ type: 'camera.zoom', direction: 'in' }]],
    ['left కి move చేయి', [{ type: 'camera.pan', direction: 'left' }]],
  ];
  for (const [text, expected] of cases) {
    it(`"${text}"`, () => assert.deepEqual(cmds(parse(text)), expected));
  }

  it('"సన్ గేర్ ని సెలెక్ట్ చెయ్యి" (Telugu script) selects the sun gear', () => {
    assert.deepEqual(cmds(parse('సన్ గేర్ ని సెలెక్ట్ చెయ్యి')), [{ type: 'component.select', componentId: 'sun_gear' }]);
  });

  it('"sun gear ని select చెయ్యి" (mixed script) selects the sun gear', () => {
    assert.deepEqual(cmds(parse('sun gear ని select చెయ్యి')), [{ type: 'component.select', componentId: 'sun_gear' }]);
  });

  it('"దీన్ని వేరుగా చూపించు" isolates the selected part', () => {
    const o = cmds(parse('దీన్ని వేరుగా చూపించు', { selectedComponentId: 'ring_gear' }));
    assert.deepEqual(o?.[1], { type: 'component.isolate', componentId: 'ring_gear' });
  });

  it('"పిస్టన్ చూపించు" is rejected on the gearbox', () => {
    assert.equal(parse('పిస్టన్ చూపించు').kind, 'unknownPart');
  });
});

describe('Phrase parser — Hindi (incl. Hindi-English code-mixing)', () => {
  const cases: [string, unknown][] = [
    ['ज़ूम इन करो', [{ type: 'camera.zoom', direction: 'in' }]],
    ['जूम आउट कीजिए', [{ type: 'camera.zoom', direction: 'out' }]],
    ['बाएं खिसकाओ', [{ type: 'camera.pan', direction: 'left' }]],
    ['दाएं घुमाओ', [{ type: 'camera.orbit', yawDeg: -30, pitchDeg: 0 }]],
    ['पीछे से दिखाइये', [{ type: 'camera.view', view: 'back' }]],
    ['ऊपर से दिखाओ', [{ type: 'camera.view', view: 'top' }]],
    ['सब जोड़ दो', [{ type: 'assembly.restore' }]],
    ['एनिमेशन रोको', [{ type: 'animation.pause' }]],
    ['एक्सप्लोड करो', [{ type: 'assembly.explode', factor: 0.75 }]],
    ['zoom in करो', [{ type: 'camera.zoom', direction: 'in' }]],
  ];
  for (const [text, expected] of cases) {
    it(`"${text}"`, () => assert.deepEqual(cmds(parse(text)), expected));
  }

  it('"सन गियर सेलेक्ट करो" selects the sun gear', () => {
    assert.deepEqual(cmds(parse('सन गियर सेलेक्ट करो')), [{ type: 'component.select', componentId: 'sun_gear' }]);
  });

  it('"इसे अलग करो" isolates the selected part', () => {
    const o = cmds(parse('इसे अलग करो', { selectedComponentId: 'sun_gear' }));
    assert.deepEqual(o?.[1], { type: 'component.isolate', componentId: 'sun_gear' });
  });

  it('"पिस्टन दिखाओ" is rejected on the gearbox', () => {
    assert.equal(parse('पिस्टन दिखाओ').kind, 'unknownPart');
  });
});

/* Real transcripts returned by Gnani Prisma in the live smoke test (backend/scripts/smoke_gnani.py,
   26 Oct 2026), including its mis-hearings. A mis-heard part must never act on a different part. */
describe('Phrase parser — live Prisma transcripts', () => {
  const partIds = (o: ParseOutcome) =>
    o.kind === 'commands'
      ? o.commands.flatMap((c) => ('componentIds' in c ? c.componentIds : 'componentId' in c ? [c.componentId] : []))
      : [];
  const executes: [string, string, string | null][] = [
    // transcript, first command type, part (if any)
    ['zoom in', 'camera.zoom', null],
    ['show the sun gear', 'component.select', 'sun_gear'],
    ['rotate left', 'camera.orbit', null],
    ['isolate the ring gear', 'component.select', 'ring_gear'],
    ['జూమ్ ఇన్ చేయండి', 'camera.zoom', null],
    ['ఎడమ వైపు తిప్పు', 'camera.orbit', null],
    ['రింగ్ ఎయిర్ ని ఐసొలేట్ చేయండి', 'component.select', 'ring_gear'],
    ['ప్లానెట్ క్యారియర్ ని దాచు', 'component.visibility', 'planet_carrier'],
    ['ज़ूम इन करो।', 'camera.zoom', null],
    ['सन गियर दिखाओ।', 'component.select', 'sun_gear'],
    ['बाएं घुमाओ', 'camera.orbit', null],
    ['रिंग इयर को आइसोलेट करो।', 'component.select', 'ring_gear'],
    ['प्लानेट कैरियर को छुपाओ।', 'component.visibility', 'planet_carrier'],
  ];
  for (const [text, type, part] of executes) {
    it(`"${text}" -> ${type}${part ? ` (${part})` : ''}`, () => {
      const o = parse(text);
      assert.equal(o.kind, 'commands', JSON.stringify(o));
      if (o.kind !== 'commands') return;
      assert.equal(o.commands[0].type, type);
      if (part) assert.ok(partIds(o).every((id) => id === part), JSON.stringify(o.commands));
    });
  }

  it('"show me the piston" is rejected as a part the gearbox does not have', () => {
    assert.equal(parse('show me the piston').kind, 'unknownPart');
  });

  it('"సంగీత చూపించు" (Prisma mis-heard "సన్ గేర్") does not act on any part', () => {
    const o = parse('సంగీత చూపించు');
    assert.notEqual(o.kind, 'commands', JSON.stringify(o));
  });
});

/* ------------------------------ 3. through the real V1 channel ------------------------------ */
function createMockDom(): HTMLElement {
  const doc = { addEventListener: () => {}, removeEventListener: () => {} };
  return { addEventListener: () => {}, removeEventListener: () => {}, ownerDocument: doc, getRootNode: () => doc, style: {} } as unknown as HTMLElement;
}

function makeChannel(opts: { handSteering?: () => boolean; selected?: string | null; model?: typeof gearbox } = {}) {
  const model = opts.model ?? gearbox;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  const controller = new CameraController(camera, createMockDom(), { enableDamping: false, autoRotate: false });
  const lifecycle = new ModelLifecycleManager({ scene, camera, cameraController: controller });
  lifecycle.loadModel(model.id);
  let clock = 0;
  const anim = { playing: true };
  const dispatcher = new SceneCommandDispatcher();
  // Same wiring as ViewerCanvas: deferred outcomes are reported back to the dispatcher
  const executor = new ViewerCommandExecutor({
    camera: controller, lifecycle,
    isGestureInteracting: opts.handSteering ?? (() => false),
    animation: { setPlaying: (p) => (anim.playing = p), setSpeed: () => {} },
    setAutoOrbit: () => {},
    now: () => clock,
  }, (cmd, src, status, detail) => dispatcher.reportDeferredOutcome(cmd, src, status, detail));
  const state = { selected: opts.selected ?? null as string | null, exploded: 0 };
  dispatcher.registerContextProvider('workspace', () => ({
    modelId: model.id,
    componentIds: new Set(model.getAllComponentIds()),
    animationIds: (model.animations ?? []).map((a) => a.id),
    registeredModelIds: new Set(ALL.map((m) => m.id)),
    selectedComponentId: state.selected,
  }));
  dispatcher.registerContextProvider('viewer', executor.contextProvider);
  dispatcher.registerHandler(executor);
  dispatcher.registerHandler({
    id: 'workspace',
    canHandle: (t) => t === 'component.select' || t.startsWith('assembly.'),
    execute: (cmd) => {
      if (cmd.type === 'component.select') state.selected = cmd.componentId;
      if (cmd.type === 'assembly.explode') state.exploded = cmd.factor;
      if (cmd.type === 'assembly.restore') state.exploded = 0;
      return { status: 'executed' };
    },
  });
  const turn = (transcript: string, language = 'en-IN', speakConfirmations = false) =>
    handleVoiceTurn({ transcript, language, dispatcher, model, allModels: ALL, speakConfirmations });
  return { dispatcher, executor, controller, lifecycle, state, anim, turn, tick: (ms: number) => { clock += ms; controller.update(clock); } };
}

describe('Voice turns go through the V1 SceneCommandDispatcher', () => {
  it('records every voice command with source "voice" and executes it', () => {
    const ch = makeChannel();
    const before = ch.controller.getDistance();
    const res = ch.turn('zoom in');
    assert.equal(res.status, 'executed');
    assert.equal(res.caption, 'Zooming in.');
    assert.equal(res.speak, false, 'quick confirmations are caption-only by default');
    assert.equal(ch.dispatcher.getHistory().at(-1)!.source, 'voice');
    ch.tick(400);
    assert.ok(ch.controller.getDistance() < before);
  });

  it('Telugu turn executes and replies in Telugu', () => {
    const ch = makeChannel();
    const res = ch.turn('సన్ గేర్ ని సెలెక్ట్ చెయ్యి', 'te-IN');
    assert.equal(res.status, 'executed');
    assert.equal(ch.state.selected, 'sun_gear');
    assert.match(res.caption, /Sun Gear ఎంచుకున్నాను/);
  });

  it('Hindi turn executes and replies in Hindi', () => {
    const ch = makeChannel();
    const res = ch.turn('एक्सप्लोड करो', 'hi-IN');
    assert.equal(res.status, 'executed');
    assert.equal(ch.state.exploded, 0.75);
    assert.match(res.caption, /अलग/);
  });

  it('a nonexistent part leaves the scene untouched and explains why (spoken)', () => {
    const ch = makeChannel();
    const historyBefore = ch.dispatcher.getHistory().length;
    const camBefore = ch.controller.camera.position.clone();
    const res = ch.turn('select the piston');
    assert.equal(res.status, 'rejected');
    assert.equal(res.speak, true);
    // The Steam Engine Explorer (milestone 2026-10-28) has a piston, so the reply now names it
    assert.equal(res.caption, 'Piston belongs to the Steam Engine Explorer, not the Epicyclic Planetary Gearbox.');
    assert.equal(ch.dispatcher.getHistory().length, historyBefore, 'nothing was dispatched');
    assert.ok(ch.controller.camera.position.equals(camBefore));
    assert.equal(ch.state.selected, null);
  });

  it('V1 validation still applies: animation on the bridge is rejected with a spoken reason', () => {
    const ch = makeChannel({ model: bridge });
    const res = ch.turn('play the animation');
    assert.equal(res.status, 'rejected');
    assert.equal(res.records.at(-1)!.code, 'UNSUPPORTED_ANIMATION');
    assert.match(res.caption, /no animation/);
  });

  it('a camera command while the hand is steering is deferred, then runs on release', () => {
    let steering = true;
    const ch = makeChannel({ handSteering: () => steering });
    const res = ch.turn('show me the back');
    assert.equal(res.status, 'deferred');
    assert.equal(res.speak, true);
    assert.equal(res.records[0].status, 'deferred');
    steering = false;
    const outcomes: string[] = [];
    ch.dispatcher.subscribe((r) => outcomes.push(`${r.source}:${r.status}`));
    ch.executor.tick(1); // in the app the render loop calls tick every frame
    assert.deepEqual(outcomes, ['voice:executed']);
  });

  it('"separate this part" isolates the selected component on the real model', () => {
    const ch = makeChannel({ selected: 'sun_gear' });
    const res = ch.turn('separate this part');
    assert.equal(res.status, 'executed');
    assert.equal(ch.lifecycle.getIsolatedComponentId(), 'sun_gear');
    assert.equal(res.caption, 'Showing only Sun Gear.');
  });

  it('"speak all replies" makes confirmations spoken', () => {
    assert.equal(makeChannel().turn('zoom out', 'en-IN', true).speak, true);
  });
});

/* ------------------------------ 4. replies, recorder, client ------------------------------ */
describe('Voice replies', () => {
  it('English, Telugu and Hindi define every reply', () => {
    for (const lang of ['en-IN', 'te-IN', 'hi-IN'] as const) {
      for (const key of REPLY_KEYS) assert.ok(REPLY_TABLES[lang][key], `${lang}.${key}`);
    }
  });

  it('beta languages fall back to English replies', () => {
    assert.equal(replyLanguage('ta-IN'), 'en-IN');
    assert.equal(reply('zoomIn', 'kn-IN'), 'Zooming in.');
  });

  it('fills placeholders and leaves none behind', () => {
    const text = reply('unknownPartOtherModel', 'te-IN', { part: 'Bridge Deck', other: 'Warren Truss Bridge', model: 'Gearbox' });
    assert.ok(!/[{}]/.test(text));
    assert.match(reply('view', 'hi-IN', { view: 'left' }), /बाईं/);
  });
});

describe('Recorder helpers', () => {
  it('encodes a valid 16 kHz mono WAV with downsampling', () => {
    const wav = encodeWav([new Float32Array(48000).fill(0.5)], 48000);
    const v = new DataView(wav.buffer);
    assert.equal(String.fromCharCode(...wav.slice(0, 4)), 'RIFF');
    assert.equal(v.getUint32(24, true), 16000);
    assert.equal(v.getUint32(40, true), 16000 * 2, '1 s of audio');
    assert.ok(Math.abs(v.getInt16(44, true) - 0.5 * 0x7fff) < 2);
  });

  it('detects end of speech after silence, adapting to background noise', () => {
    const d = new SpeechEndDetector();
    const frame = 43;
    for (let i = 0; i < 6; i++) assert.equal(d.push(0.02, frame), null); // noisy background
    for (let i = 0; i < 10; i++) assert.equal(d.push(0.2, frame), null); // speech
    assert.equal(d.speechStarted, true);
    let end = null;
    for (let i = 0; i < 40 && !end; i++) end = d.push(0.02, frame); // back to background
    assert.equal(end, 'silence');
  });

  it('gives up when nobody speaks, and enforces the 25 s cap', () => {
    const quiet = new SpeechEndDetector();
    let end = null;
    for (let i = 0; i < 300 && !end; i++) end = quiet.push(0.004, 43);
    assert.equal(end, 'nospeech');
    const talker = new SpeechEndDetector();
    end = null;
    for (let i = 0; i < 6; i++) talker.push(0.004, 43);
    for (let i = 0; i < 1000 && !end; i++) end = talker.push(0.3, 43);
    assert.equal(end, 'max');
  });

  it('maps microphone errors to clear codes', () => {
    assert.equal(classifyMicError({ name: 'NotAllowedError' }).code, 'MIC_DENIED');
    assert.equal(classifyMicError({ name: 'NotFoundError' }).code, 'MIC_NOT_FOUND');
    assert.equal(classifyMicError({ name: 'NotReadableError' }).code, 'MIC_BUSY');
    assert.equal(rms(new Float32Array([0.5, -0.5])), 0.5);
  });
});

describe('Voice client error handling', () => {
  const jsonResponse = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it('surfaces backend error codes (no credits / rate limit / key missing)', async () => {
    for (const code of ['GNANI_FORBIDDEN', 'GNANI_RATE_LIMIT', 'KEY_MISSING']) {
      const fake = async () => jsonResponse(502, { error: { code, message: 'x' } });
      await assert.rejects(transcribe(new Blob(['x']), 'en-IN', undefined, fake as typeof fetch),
        (e: unknown) => e instanceof VoiceServiceError && e.code === code);
    }
  });

  it('reports the backend as unavailable when the proxy returns a non-JSON 5xx or the fetch fails', async () => {
    const proxyDown = async () => new Response('Bad Gateway', { status: 502 });
    await assert.rejects(getVoiceHealth(undefined, proxyDown as typeof fetch), (e: unknown) => (e as VoiceServiceError).code === 'BACKEND_UNAVAILABLE');
    const offline = async () => { throw new TypeError('Failed to fetch'); };
    await assert.rejects(synthesize('hi', 'en-IN', undefined, offline as typeof fetch), (e: unknown) => (e as VoiceServiceError).code === 'BACKEND_UNAVAILABLE');
  });

  it('cancellation yields CANCELLED, so stale results are never used', async () => {
    const controller = new AbortController();
    const slow = (_: unknown, init?: RequestInit) => new Promise<Response>((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    });
    const pending = transcribe(new Blob(['x']), 'te-IN', controller.signal, slow as typeof fetch);
    controller.abort();
    await assert.rejects(pending, (e: unknown) => (e as VoiceServiceError).code === 'CANCELLED');
  });

  it('returns the transcript on success', async () => {
    const ok = async () => jsonResponse(200, { transcript: 'zoom in', language: 'en-IN' });
    assert.equal(await transcribe(new Blob(['x']), 'en-IN', undefined, ok as typeof fetch), 'zoom in');
  });
});
