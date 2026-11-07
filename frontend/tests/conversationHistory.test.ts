/**
 * Conversation history (Gemini follow-ups). The sequence from the bug report, through the real
 * parser, reference resolver, teaching controller, plan validation and player. The LLM is
 * SIMULATED (requestPlan returns a valid plan); no network. Checks what the request body sends.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { modelRegistry } from '../src/models/registry';
import { PLANETARY_GEARBOX_MODEL_ID } from '../src/models/mechanical/planetaryGearboxModel';
import { getSceneSnapshot } from '../src/services/scene/sceneSnapshot';
import { handleVoiceTurn } from '../src/services/voice/voiceSession';
import { buildComponentBrief } from '../src/services/teaching/componentBrief';
import { TeachingPlanPlayer, type NarrationClip, type Narrator } from '../src/services/teaching/planPlayer';
import { TeachingController } from '../src/services/teaching/teachingController';
import { LlmAvailability } from '../src/services/teaching/llmAvailability';
import type { TeachRequestBody } from '../src/services/teaching/teachingClient';
import { makeWorkspace } from './sceneContext.test';

const gearbox = modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID)!;
const ALL = modelRegistry.getCatalogueModels();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function narrator(): Narrator {
  return {
    prepare(): NarrationClip {
      let resolve!: (v: 'ended' | 'failed' | 'stopped') => void;
      const done = new Promise<'ended' | 'failed' | 'stopped'>((r) => (resolve = r));
      return { done, play() { setTimeout(() => resolve('ended'), 2); }, pause() {}, resume() {}, stop() { resolve('stopped'); } };
    },
  };
}

function setup() {
  const w = makeWorkspace(gearbox);
  w.dispatcher.dispatch({ type: 'component.select', componentId: 'sun_gear' }, 'ui');
  const loop = setInterval(() => w.tick(16), 4);
  loop.unref?.();
  const player = new TeachingPlanPlayer({ dispatcher: w.dispatcher, getSnapshot: () => getSceneSnapshot(w.dispatcher, gearbox), narrator: narrator(), pollMs: 4, settleTimeoutMs: 200 });
  const detach = player.attach();
  const bodies: TeachRequestBody[] = [];
  let n = 0;
  const controller = new TeachingController({
    dispatcher: w.dispatcher, player, getModel: () => gearbox, getLanguage: () => 'en-IN', availability: new LlmAvailability(),
    // Simulated Gemini: a valid plan whose explanation is recognisable in later history
    requestPlan: async (body) => {
      bodies.push(body);
      n += 1;
      const plan = buildComponentBrief(gearbox, getSceneSnapshot(w.dispatcher, gearbox), body.targetComponentId, body.questionType ?? 'explain') as Record<string, unknown>;
      return { ...plan, explanation: `ANSWER-${n}: the sun gear meshes with the three planet gears.`, source: 'llm' };
    },
  });
  const memory: { last: { modelId: string; componentId: string } | null } = { last: null };
  const ask = (text: string) => {
    const r = handleVoiceTurn({ transcript: text, language: 'en-IN', dispatcher: w.dispatcher, model: gearbox, allModels: ALL, lastDiscussed: memory.last, teachingAvailable: true });
    if (r.discussedComponentId) memory.last = { modelId: gearbox.id, componentId: r.discussedComponentId };
    return r;
  };
  const finish = async () => {
    const t0 = Date.now();
    while (player.isActive() && Date.now() - t0 < 5000) await sleep(5);
  };
  return { w, controller, bodies, ask, finish, close: () => { controller.cancel(); detach(); clearInterval(loop); } };
}

describe('Conversation history reaches the teacher (follow-up questions)', () => {
  it('"What is this component?" → "What is its purpose?" → "How does it work?" → a question about an earlier answer', async () => {
    const t = setup();
    try {
      // 1. Identify: answered at once from the model data (no LLM call needed)
      const q1 = t.ask('What is this component?');
      assert.equal(q1.status, 'answered');
      assert.ok(q1.caption.includes('Sun Gear'));

      // 2. "its" = the selected sun gear
      const q2 = t.ask('What is its purpose?');
      assert.equal(q2.status, 'teach');
      assert.deepEqual([q2.teach!.questionType, q2.teach!.targetComponentId], ['purpose', 'sun_gear']);
      await t.controller.ask(q2.teach!);
      await t.finish();

      // 3. "it" = still the sun gear; history carries question 2 AND what the tutor answered
      const q3 = t.ask('How does it work?');
      assert.equal(q3.teach!.targetComponentId, 'sun_gear');
      await t.controller.ask(q3.teach!);
      await t.finish();
      const b3 = t.bodies[1];
      assert.equal(b3.history.length, 1);
      assert.equal(b3.history[0].question, 'What is its purpose?');
      assert.equal(b3.history[0].targetComponentId, 'sun_gear');
      assert.ok(b3.history[0].answer?.includes('ANSWER-1'), 'the earlier answer is sent, not only its title');

      // 4. Refers to information given earlier
      const q4 = t.ask('Earlier you said it meshes with other gears. Explain that again more simply.');
      assert.equal(q4.status, 'teach');
      await t.controller.ask(q4.teach!);
      await t.finish();
      const b4 = t.bodies[2];
      assert.deepEqual(b4.history.map((h) => h.answer?.slice(0, 8)), ['ANSWER-1', 'ANSWER-2']);
      assert.equal(b4.facts.scene.selectedComponentId, 'sun_gear', 'current model/component context is sent');
      assert.equal(b4.facts.modelId, gearbox.id);
      assert.ok(b4.history.every((h) => (h.answer ?? '').length <= 300), 'answers are kept short in the history');
    } finally {
      t.close();
    }
  });

  it('history is per model: switching models starts a fresh conversation', async () => {
    const t = setup();
    try {
      const q = t.ask('What is its purpose?');
      await t.controller.ask(q.teach!);
      await t.finish();
      assert.equal(t.controller.getHistory().length, 1);
      t.controller.modelChanged(null);
      assert.equal(t.controller.getHistory().length, 0);
    } finally {
      t.close();
    }
  });
});
