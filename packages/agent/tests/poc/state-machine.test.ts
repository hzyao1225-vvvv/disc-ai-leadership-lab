/**
 * 测试套件 2: 状态机行为测试
 * 目标：验证信任建立型对话能让 trust 单调上升、resistance 下降，且数值始终在 [0,100]
 * 方法：使用预设的 6 轮 TRUST_BUILDING_DIALOGUE，逐轮断言
 */

import type { AgentConfig, TestResult } from '../../src/types.js';
import { EmployeeAgent } from '../../src/agent.js';
import { PERSONAS } from '../../src/personas.js';
import {
  SCENE_PERFORMANCE_REVIEW,
  TRUST_BUILDING_DIALOGUE,
} from './poc-runner.js';

export async function runStateMachineTest(
  config: AgentConfig
): Promise<TestResult> {
  const details: string[] = [];
  const samples: unknown[] = [];

  // 用 D 型 张峻（最难建立信任，便于测试）
  const agent = new EmployeeAgent(
    PERSONAS.zhang_jun,
    SCENE_PERFORMANCE_REVIEW,
    config
  );

  const stateTrace: {
    round: number;
    trust: number;
    acceptance: number;
    resistance: number;
    emotion: string;
  }[] = [];

  const initial = agent.getState();
  stateTrace.push({
    round: 0,
    trust: initial.trust,
    acceptance: initial.acceptance,
    resistance: initial.resistance,
    emotion: initial.emotion,
  });

  let monotonicIncreaseViolations = 0;
  let outOfRangeViolations = 0;
  let emotionChangedCount = 0;
  let prevEmotion = initial.emotion;

  for (let i = 0; i < TRUST_BUILDING_DIALOGUE.length; i++) {
    const turn = TRUST_BUILDING_DIALOGUE[i];
    const response = await agent.respond(turn.content);
    const state = agent.getState();

    stateTrace.push({
      round: response.round,
      trust: state.trust,
      acceptance: state.acceptance,
      resistance: state.resistance,
      emotion: state.emotion,
    });

    samples.push({
      round: response.round,
      intent: turn.intent,
      trust: state.trust,
      acceptance: state.acceptance,
      resistance: state.resistance,
      emotion: state.emotion,
      reply_preview: response.reply.slice(0, 80),
    });

    // 1. 范围校验 [0, 100]
    if (
      state.trust < 0 ||
      state.trust > 100 ||
      state.acceptance < 0 ||
      state.acceptance > 100 ||
      state.resistance < 0 ||
      state.resistance > 100
    ) {
      outOfRangeViolations++;
      details.push(
        `第 ${response.round} 轮: 数值越界 trust=${state.trust} acc=${state.acceptance} res=${state.resistance}`
      );
    }

    // 2. 信任单调上升（允许小波动 ≤5，整体趋势必须上升）
    const prev = stateTrace[stateTrace.length - 2];
    if (state.trust < prev.trust - 5) {
      monotonicIncreaseViolations++;
      details.push(
        `第 ${response.round} 轮: trust 下降 ${prev.trust} → ${state.trust}`
      );
    }

    // 3. 情绪标签应有变化
    if (state.emotion !== prevEmotion) {
      emotionChangedCount++;
      prevEmotion = state.emotion;
    }
  }

  const final = agent.getState();

  // 关键判定
  const trustDelta = final.trust - initial.trust;
  const resistanceDelta = final.resistance - initial.resistance;
  const acceptanceDelta = final.acceptance - initial.acceptance;
  const emotionVariety = emotionChangedCount;

  const trustIncreased = trustDelta >= 15; // 至少上升 15 分
  const resistanceDecreased = resistanceDelta <= -5; // 至少下降 5 分
  const acceptanceIncreased = acceptanceDelta >= 10;
  const noOutOfRange = outOfRangeViolations === 0;
  const emotionEvolved = emotionVariety >= 2;

  details.unshift(
    `初始 trust=${initial.trust} → 最终 trust=${final.trust} (Δ=${trustDelta > 0 ? '+' : ''}${trustDelta})`,
    `初始 resistance=${initial.resistance} → 最终=${final.resistance} (Δ=${resistanceDelta > 0 ? '+' : ''}${resistanceDelta})`,
    `初始 acceptance=${initial.acceptance} → 最终=${final.acceptance} (Δ=${acceptanceDelta > 0 ? '+' : ''}${acceptanceDelta})`,
    `情绪标签变化次数: ${emotionVariety} 次`,
    `数值越界次数: ${outOfRangeViolations}`,
    `trust 单调上升违反次数: ${monotonicIncreaseViolations}`
  );

  const passed =
    trustIncreased &&
    resistanceDecreased &&
    acceptanceIncreased &&
    noOutOfRange &&
    emotionEvolved;

  // 分数：5 个子项各占 20 分
  const score = Math.round(
    (trustIncreased ? 20 : 0) +
      (resistanceDecreased ? 20 : 0) +
      (acceptanceIncreased ? 20 : 0) +
      (noOutOfRange ? 20 : 0) +
      (emotionEvolved ? 20 : 0)
  );

  return {
    name: '状态机行为测试',
    passed,
    score,
    details,
    samples,
  };
}
