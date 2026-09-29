/**
 * SessionEvaluator 单元测试（不依赖 LLM）
 *
 * 覆盖目标：
 *   1) 空对话降级路径：history.length === 0 时不调 LLM，返回降级结果
 *   2) buildSystemPrompt / buildUserPrompt 拼装结构（含/不含 criteria、含/不含 sessionGoalDefault）
 *   3) parseEvaluationResult 解析路径：合法 JSON 正常返回；非法 JSON 抛错
 *
 * 不测：LLMGateway.chat 的真实网络调用（在 poc-runner 中由真实 LLM 覆盖）
 */

import assert from 'node:assert/strict';
import { SessionEvaluator } from '../../src/evaluator.js';
import { PERSONAS } from '../../src/personas.js';
import { SCENE_PERFORMANCE_REVIEW } from '../../src/scenes.js';
import { createInitialState } from '../../src/state-machine.js';
import type { Persona, Scene, EmployeeState, DialogueTurn, LLMConfig } from '../../src/types.js';

// 不连真实 LLM：apiKey 给空串，所有路径走空 history 短路或 parseEvaluationResult 直测
const fakeLlmConfig: LLMConfig = {
  apiKey: '',
  baseUrl: 'http://localhost:0/v1', // 不真实调用
  model: 'qwen-plus',
  temperature: 0.2,
  maxTokens: 1000,
};

const persona: Persona = PERSONAS.zhang_jun;
const scene: Scene = SCENE_PERFORMANCE_REVIEW;
const state: EmployeeState = createInitialState(scene);

// ============== 测试 1: 空对话降级 ==============

async function testEmptyHistoryDegrades() {
  const evaluator = new SessionEvaluator(fakeLlmConfig, false);
  const result = await evaluator.evaluate([], persona, scene, state, undefined);
  assert.equal(result.totalScore, 0, '空对话 totalScore 应为 0');
  assert.equal(result.dimensions.length, 0, '空对话 dimensions 应为空数组');
  assert.ok(
    result.feedback.includes('对话不足以评价'),
    `空对话 feedback 应含降级提示，实际: "${result.feedback}"`
  );
  assert.equal(result.strengths.length, 0);
  assert.equal(result.improvements.length, 0);
  console.log('✓ 测试 1 通过: 空对话降级');
}

// ============== 测试 2: parseEvaluationResult 解析合法 JSON ==============

function testParseValidJson() {
  const evaluator = new SessionEvaluator(fakeLlmConfig, false);
  // 通过反射访问私有方法（测试专用，不暴露 prod API）
  const parse = (evaluator as unknown as {
    parseEvaluationResult: (raw: string) => ReturnType<SessionEvaluator['evaluate']>;
  }).parseEvaluationResult.bind(evaluator);

  const raw = JSON.stringify({
    totalScore: 78,
    dimensions: [
      { key: 'goal_attainment', label: '目标达成', score: 80, comment: '第3轮触及目标' },
      { key: 'trust_building', label: '信任建立', score: 70, comment: '前期共情偏少' },
    ],
    feedback: '整体沟通节奏稳定，建议前期更多共情。',
    strengths: ['第2轮用数据回应，符合 C 型风格', '第4轮主动确认发展意愿'],
    improvements: ['第1轮开场偏说教', '第5轮被情绪带走'],
  });

  const result = parse(raw);
  assert.equal(result.totalScore, 78);
  assert.equal(result.dimensions.length, 2);
  assert.equal(result.dimensions[0].key, 'goal_attainment');
  assert.equal(result.dimensions[0].score, 80);
  assert.equal(result.feedback, '整体沟通节奏稳定，建议前期更多共情。');
  assert.equal(result.strengths.length, 2);
  assert.equal(result.improvements.length, 2);
  console.log('✓ 测试 2 通过: 合法 JSON 解析');
}

// ============== 测试 3: totalScore 越界被夹紧到 [0,100] ==============

function testParseScoreClamped() {
  const evaluator = new SessionEvaluator(fakeLlmConfig, false);
  const parse = (evaluator as unknown as {
    parseEvaluationResult: (raw: string) => ReturnType<SessionEvaluator['evaluate']>;
  }).parseEvaluationResult.bind(evaluator);

  const raw = JSON.stringify({
    totalScore: 150, // 越界
    dimensions: [],
    feedback: '',
    strengths: [],
    improvements: [],
  });
  const result = parse(raw);
  assert.equal(result.totalScore, 100, 'totalScore > 100 应夹紧到 100');

  const raw2 = JSON.stringify({
    totalScore: -10, // 越界
    dimensions: [],
    feedback: '',
    strengths: [],
    improvements: [],
  });
  const result2 = parse(raw2);
  assert.equal(result2.totalScore, 0, 'totalScore < 0 应夹紧到 0');
  console.log('✓ 测试 3 通过: totalScore 越界夹紧');
}

// ============== 测试 4: 非法 JSON 抛错 ==============

function testParseInvalidJsonThrows() {
  const evaluator = new SessionEvaluator(fakeLlmConfig, false);
  const parse = (evaluator as unknown as {
    parseEvaluationResult: (raw: string) => ReturnType<SessionEvaluator['evaluate']>;
  }).parseEvaluationResult.bind(evaluator);

  // 缺 totalScore 字段
  let threw = false;
  try {
    parse(JSON.stringify({ dimensions: [], feedback: '' }));
  } catch (err) {
    threw = true;
    assert.ok(
      (err as Error).message.includes('totalScore'),
      `应报 totalScore 错，实际: ${(err as Error).message}`
    );
  }
  assert.ok(threw, '缺 totalScore 应抛错');

  // 非法 JSON 字符串
  threw = false;
  try {
    parse('not a json at all');
  } catch (err) {
    threw = true;
    assert.ok(
      (err as Error).message.includes('解析失败'),
      `应报解析失败，实际: ${(err as Error).message}`
    );
  }
  assert.ok(threw, '非法 JSON 应抛错');
  console.log('✓ 测试 4 通过: 非法 JSON 抛错');
}

// ============== 测试 5: 非空 history + mock LLM 验证完整 evaluate 流程 ==============

async function testEvaluateWithMockLlm() {
  // 构造一个最小 mock LLM：通过 monkey-patch LLMGateway.chat
  const evaluator = new SessionEvaluator(fakeLlmConfig, false);
  // 直接覆盖内部 llm.chat（绕过网络）
  const llmField = evaluator as unknown as { llm: { chat: () => Promise<string> } };
  llmField.llm.chat = async () =>
    JSON.stringify({
      totalScore: 65,
      dimensions: [
        { key: 'goal_attainment', label: '目标达成', score: 60, comment: '第2轮触及' },
        { key: 'trust_building', label: '信任建立', score: 70, comment: 'trust 上升' },
        { key: 'communication_skill', label: '沟通技巧', score: 65, comment: '提问清晰' },
        { key: 'emotion_handling', label: '情绪处理', score: 65, comment: '情绪稳定' },
      ],
      feedback: '沟通整体可接受，仍有提升空间。',
      strengths: ['第2轮主动倾听', '第3轮给出具体反馈'],
      improvements: ['第1轮开场偏急', '第4轮可更深挖'],
    });

  const history: DialogueTurn[] = [
    { round: 1, role: 'leader', content: '今天想了解你最近的状态。', timestamp: Date.now() },
    { round: 1, role: 'employee', content: '都还行。', timestamp: Date.now() },
    { round: 2, role: 'leader', content: '具体说说，最近哪个项目让你最投入？', timestamp: Date.now() },
    { round: 2, role: 'employee', content: '是那个产业园区选址。', timestamp: Date.now() },
  ];

  const result = await evaluator.evaluate(history, persona, scene, state, undefined);
  assert.equal(result.totalScore, 65);
  assert.equal(result.dimensions.length, 4, '应返回 4 个默认维度');
  assert.equal(result.dimensions[0].key, 'goal_attainment');
  assert.equal(result.strengths.length, 2);
  console.log('✓ 测试 5 通过: 完整 evaluate 流程（mock LLM）');
}

// ============== 测试 6: 注入 EvaluationCriteria 时维度按用户传入 ==============

async function testEvaluateWithCustomCriteria() {
  const evaluator = new SessionEvaluator(fakeLlmConfig, false);
  const llmField = evaluator as unknown as { llm: { chat: (sys: string, user: string) => Promise<string> } };
  let capturedSystemPrompt = '';
  llmField.llm.chat = async (sys) => {
    capturedSystemPrompt = sys;
    return JSON.stringify({
      totalScore: 70,
      dimensions: [{ key: 'custom', label: '自定义', score: 70, comment: 'ok' }],
      feedback: 'ok',
      strengths: ['s1'],
      improvements: ['i1'],
    });
  };

  const history: DialogueTurn[] = [
    { round: 1, role: 'leader', content: 'hello', timestamp: Date.now() },
    { round: 1, role: 'employee', content: 'hi', timestamp: Date.now() },
  ];

  const customCriteria = {
    dimensions: [
      { key: 'custom', label: '自定义维度', description: '用户后续注入的真实标准' },
    ],
    notes: '本期为占位',
  };
  await evaluator.evaluate(history, persona, scene, state, customCriteria);

  assert.ok(
    capturedSystemPrompt.includes('自定义维度'),
    `system prompt 应包含用户自定义维度标签，实际:\n${capturedSystemPrompt}`
  );
  assert.ok(
    capturedSystemPrompt.includes('本期为占位'),
    `system prompt 应包含 criteria.notes 内容`
  );
  console.log('✓ 测试 6 通过: EvaluationCriteria 注入');
}

// ============== 测试 7: 截断 JSON 自动修复 ==============

function testTruncatedJsonRepair() {
  const evaluator = new SessionEvaluator(fakeLlmConfig, false);
  const parse = (evaluator as unknown as {
    parseEvaluationResult: (raw: string) => ReturnType<SessionEvaluator['evaluate']>;
  }).parseEvaluationResult.bind(evaluator);

  // 场景 A：dimensions 数组第 2 个元素的字符串中间被截断（未闭合引号 + 未闭合括号）
  const truncatedA = `{
  "totalScore": 28,
  "passLevel": "fail",
  "dimensions": [
    { "key": "listening", "label": "Listening 倾听能力", "score": 10, "comment": "完整元素" },
    { "key": "questioning", "label": "Questioning 提问能力", "score": 5, "comment": "被截断的话`;
  const resultA = parse(truncatedA);
  assert.equal(resultA.totalScore, 28, '截断修复后 totalScore 应保留');
  assert.equal(resultA.dimensions.length, 1, '不完整的元素应被裁掉，只保留完整维度');
  assert.equal(resultA.dimensions[0].key, 'listening');

  // 场景 B：数组元素之间的逗号后被截断（截在干净的边界）
  const truncatedB = JSON.stringify({
    totalScore: 60,
    dimensions: [{ key: 'a', label: 'A', score: 50, comment: 'ok' }],
    feedback: '前半段完整',
    strengths: ['s1'],
    improvements: ['i1'],
  }).slice(0, 80); // 砍断在 dimensions 数组附近
  const resultB = parse(truncatedB);
  assert.equal(typeof resultB.totalScore, 'number');

  // 场景 C：完全无法修复（空串 / 纯文本）仍应抛错
  let threw = false;
  try {
    parse('{"totalScore":');
  } catch {
    threw = true;
  }
  assert.ok(threw, '无法修复的截断应抛错');
  console.log('✓ 测试 7 通过: 截断 JSON 自动修复');
}

// ============== runner ==============

(async () => {
  console.log('═══════════════════════════════════════════════');
  console.log('  SessionEvaluator 单元测试（不依赖 LLM 网络）');
  console.log('═══════════════════════════════════════════════');
  let passed = 0;
  let failed = 0;
  const tests = [
    { name: '空对话降级', fn: testEmptyHistoryDegrades },
    { name: '合法 JSON 解析', fn: testParseValidJson },
    { name: 'totalScore 越界夹紧', fn: testParseScoreClamped },
    { name: '非法 JSON 抛错', fn: testParseInvalidJsonThrows },
    { name: '完整 evaluate 流程', fn: testEvaluateWithMockLlm },
    { name: 'EvaluationCriteria 注入', fn: testEvaluateWithCustomCriteria },
    { name: '截断 JSON 自动修复', fn: testTruncatedJsonRepair },
  ];
  for (const t of tests) {
    try {
      await t.fn();
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
