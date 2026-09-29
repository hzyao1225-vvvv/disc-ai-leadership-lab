/**
 * prompt-builder 单元测试（不依赖 LLM）
 *
 * 覆盖目标：
 *   1) buildSystemPrompt 不传 sessionContext 时输出不含【本次会话背景】【本次会话目标】段（向后兼容）
 *   2) buildSystemPrompt 传 sessionContext 时输出含编辑后的 bg/goal 文本
 *   3) buildSystemPrompt 仅传 bg 时只输出【本次会话背景】段
 *   4) buildSystemPrompt 传空串时回退到 scene.sessionBackgroundDefault
 *   5) Scene 有 default 但 sessionContext 不传时输出含 scene 默认值（覆盖默认行为）
 */

import assert from 'node:assert/strict';
import { buildSystemPrompt } from '../../src/prompt-builder.js';
import { PERSONAS } from '../../src/personas.js';
import { SCENE_PERFORMANCE_REVIEW, SCENE_GOAL_SETTING } from '../../src/scenes.js';
import { createInitialState } from '../../src/state-machine.js';
import type { Persona, Scene, EmployeeState, SessionContext } from '../../src/types.js';

const persona: Persona = PERSONAS.zhang_jun;
const sceneWithDefaults: Scene = SCENE_PERFORMANCE_REVIEW; // 有 sessionBackgroundDefault/goalDefault
const sceneWithoutDefaults: Scene = SCENE_GOAL_SETTING; // 同样已补默认值（实际所有 4 个场景都已补）
const state: EmployeeState = createInitialState(sceneWithDefaults);

// ============== 测试 1: 不传 sessionContext → 含 scene 默认值（注入优先级：sessionContext 缺省时走 scene） ==============

function testDefaultsFromScene() {
  const prompt = buildSystemPrompt(persona, sceneWithDefaults, state, undefined);
  assert.ok(
    prompt.includes('【本次会话背景】'),
    '无 sessionContext 但 scene 有 default 时应含【本次会话背景】段'
  );
  assert.ok(
    prompt.includes('【本次会话目标】'),
    '无 sessionContext 但 scene 有 default 时应含【本次会话目标】段'
  );
  // 应包含 scene.sessionBackgroundDefault 的实际文本（截前 20 字）
  const expectedBgPrefix = (sceneWithDefaults.sessionBackgroundDefault ?? '').slice(0, 20);
  assert.ok(
    prompt.includes(expectedBgPrefix),
    `应含 scene.sessionBackgroundDefault 文本前缀: "${expectedBgPrefix}"`
  );
  console.log('✓ 测试 1 通过: 不传 sessionContext 时注入 scene 默认值');
}

// ============== 测试 2: 传 sessionContext 覆盖 scene 默认值 ==============

function testSessionContextOverridesScene() {
  const ctx: SessionContext = {
    sessionBackground: '【测试背景】这是学员编辑后的特殊背景',
    sessionGoal: '【测试目标】学员自定义的本次目标',
  };
  const prompt = buildSystemPrompt(persona, sceneWithDefaults, state, ctx);
  assert.ok(
    prompt.includes('【测试背景】这是学员编辑后的特殊背景'),
    '应含学员编辑后的背景文本'
  );
  assert.ok(
    prompt.includes('【测试目标】学员自定义的本次目标'),
    '应含学员编辑后的目标文本'
  );
  // 应不含 scene 默认值（被覆盖）
  const sceneDefaultBg = (sceneWithDefaults.sessionBackgroundDefault ?? '').slice(0, 20);
  assert.ok(
    !prompt.includes(sceneDefaultBg),
    '应不含 scene 默认背景（被 sessionContext 覆盖）'
  );
  console.log('✓ 测试 2 通过: sessionContext 覆盖 scene 默认值');
}

// ============== 测试 3: 仅传 bg → 只输出【背景】段，不输出【目标】段（除非 scene 有 default） ==============

function testOnlyBackground() {
  // 用一个无 default 的 scene 来测试：构造一个 stripped scene
  const strippedScene: Scene = {
    ...sceneWithDefaults,
    sessionBackgroundDefault: undefined,
    sessionGoalDefault: undefined,
  };
  const ctx: SessionContext = {
    sessionBackground: '只有背景的测试',
    // sessionGoal 不传
  };
  const prompt = buildSystemPrompt(persona, strippedScene, state, ctx);
  assert.ok(prompt.includes('【本次会话背景】'), '应含【本次会话背景】段');
  assert.ok(prompt.includes('只有背景的测试'), '应含背景文本');
  // 不应出现【本次会话目标】作为段标题（行为准则第 6 行的提示文本不算）
  const goalSectionMatches = prompt.match(/^【本次会话目标】$/gm);
  assert.equal(
    goalSectionMatches,
    null,
    'bg 未提供且 scene.sessionGoalDefault 未定义时不应出现【本次会话目标】段标题'
  );
  console.log('✓ 测试 3 通过: 仅传 bg 时只输出背景段');
}

// ============== 测试 4: sessionContext 字段为空串 → 回退到 scene 默认值 ==============

function testEmptyStringFallsBackToSceneDefault() {
  const ctx: SessionContext = {
    sessionBackground: '',   // 空串
    sessionGoal: '   ',     // 全空格 trim 后为空
  };
  const prompt = buildSystemPrompt(persona, sceneWithDefaults, state, ctx);
  // 应回退到 scene 默认值
  const expectedBgPrefix = (sceneWithDefaults.sessionBackgroundDefault ?? '').slice(0, 20);
  assert.ok(
    prompt.includes(expectedBgPrefix),
    'sessionContext.sessionBackground 为空串时应回退到 scene 默认值'
  );
  const expectedGoalPrefix = (sceneWithDefaults.sessionGoalDefault ?? '').slice(0, 20);
  assert.ok(
    prompt.includes(expectedGoalPrefix),
    'sessionContext.sessionGoal 为空格时应回退到 scene 默认值'
  );
  console.log('✓ 测试 4 通过: sessionContext 空串回退到 scene 默认值');
}

// ============== 测试 5: 行为准则第 6 条已加入（让 LLM 知道 bg/goal 的重要性） ==============

function testBehaviorRuleAboutSessionContext() {
  const prompt = buildSystemPrompt(
    persona,
    sceneWithDefaults,
    state,
    { sessionBackground: 'bg', sessionGoal: 'goal' }
  );
  assert.ok(
    prompt.includes('若【本次会话背景】【本次会话目标】提供了具体内容'),
    '行为准则应含第 6 条提示 LLM bg/goal 的重要性'
  );
  console.log('✓ 测试 5 通过: 行为准则含 bg/goal 提示');
}

// ============== 测试 6: 一问一答节奏约束（每轮 1-2 个点、80 字内） ==============

function testTurnTakingBrevityRule() {
  const prompt = buildSystemPrompt(persona, sceneWithDefaults, state, undefined);
  assert.ok(
    prompt.includes('一问一答'),
    '行为准则应含一问一答规则'
  );
  assert.ok(
    prompt.includes('80字以内'),
    'reply 输出格式应限制 80 字以内'
  );
  console.log('✓ 测试 6 通过: 一问一答节奏约束已注入');
}

// ============== runner ==============

(async () => {
  console.log('═══════════════════════════════════════════════');
  console.log('  prompt-builder 单元测试（不依赖 LLM）');
  console.log('═══════════════════════════════════════════════');
  let passed = 0;
  let failed = 0;
  const tests = [
    { name: 'scene 默认值注入', fn: testDefaultsFromScene },
    { name: 'sessionContext 覆盖 scene', fn: testSessionContextOverridesScene },
    { name: '仅传 bg 只输出背景段', fn: testOnlyBackground },
    { name: '空串回退到 scene 默认值', fn: testEmptyStringFallsBackToSceneDefault },
    { name: '行为准则含 bg/goal 提示', fn: testBehaviorRuleAboutSessionContext },
    { name: '一问一答节奏约束', fn: testTurnTakingBrevityRule },
  ];
  for (const t of tests) {
    try {
      t.fn();
      passed++;
    } catch (err) {
      failed++;
      console.error(`✗ 测试失败 [${t.name}]:`, (err as Error).message);
      console.error((err as Error).stack);
    }
  }
  console.log('───────────────────────────────────────────────');
  console.log(`  结果: ${passed}/${tests.length} 通过`);
  if (failed > 0) process.exit(1);
})().catch((err) => {
  console.error('Runner error:', err);
  process.exit(1);
});
