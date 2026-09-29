/**
 * W4 测试套件 1: 场景引擎测试
 * 目标：验证 createInitialState 按 scene.type 差异化返回正确的初始状态
 * 方法：纯状态机断言，不调 LLM
 */

import type { TestResult } from '../../src/types.js';
import { createInitialState } from '../../src/state-machine.js';
import {
  SCENE_PERFORMANCE_REVIEW,
  SCENE_GOAL_SETTING,
  SCENE_CONFLICT_RESOLUTION,
  SCENE_CAREER_COACHING,
} from '../../src/scenes.js';

interface SceneExpectation {
  sceneName: string;
  scene: typeof SCENE_PERFORMANCE_REVIEW;
  expected: {
    trust: number;
    acceptance: number;
    resistance: number;
    disclosure: number;
    emotion: string;
  };
}

export async function runSceneEngineTest(): Promise<TestResult> {
  const details: string[] = [];

  const cases: SceneExpectation[] = [
    {
      sceneName: '绩效面谈',
      scene: SCENE_PERFORMANCE_REVIEW,
      expected: { trust: 30, acceptance: 40, resistance: 35, disclosure: 1, emotion: 'guarded' },
    },
    {
      sceneName: '目标设定',
      scene: SCENE_GOAL_SETTING,
      expected: { trust: 35, acceptance: 45, resistance: 25, disclosure: 1, emotion: 'cautious' },
    },
    {
      sceneName: '冲突调解',
      scene: SCENE_CONFLICT_RESOLUTION,
      expected: { trust: 20, acceptance: 30, resistance: 55, disclosure: 1, emotion: 'frustrated' },
    },
    {
      sceneName: '职业辅导',
      scene: SCENE_CAREER_COACHING,
      expected: { trust: 40, acceptance: 50, resistance: 20, disclosure: 1, emotion: 'reflective' },
    },
  ];

  let passCount = 0;

  for (const c of cases) {
    const state = createInitialState(c.scene);

    const ok =
      state.trust === c.expected.trust &&
      state.acceptance === c.expected.acceptance &&
      state.resistance === c.expected.resistance &&
      state.disclosure === c.expected.disclosure &&
      state.emotion === c.expected.emotion &&
      state.round === 0 &&
      state.revealedInfoIds.length === 0 &&
      state.behaviorTags.length === 0;

    if (ok) {
      passCount++;
      details.push(
        `✓ ${c.sceneName} (${c.scene.type}): trust=${state.trust} accept=${state.acceptance} resist=${state.resistance} disclosure=L${state.disclosure} emotion=${state.emotion}`
      );
    } else {
      details.push(
        `✗ ${c.sceneName} (${c.scene.type}): 期望 trust=${c.expected.trust} accept=${c.expected.acceptance} resist=${c.expected.resistance} disclosure=L${c.expected.disclosure} emotion=${c.expected.emotion}，实际 trust=${state.trust} accept=${state.acceptance} resist=${state.resistance} disclosure=L${state.disclosure} emotion=${state.emotion}`
      );
    }
  }

  // 额外校验：scene 缺省时回退默认值
  const defaultState = createInitialState();
  const defaultOk =
    defaultState.trust === 30 &&
    defaultState.acceptance === 40 &&
    defaultState.resistance === 35;
  if (defaultOk) passCount++;

  const totalCases = cases.length + 1;
  const passed = passCount === totalCases;
  const score = Math.round((passCount / totalCases) * 100);

  details.unshift(
    `场景初始状态校验: ${passCount}/${totalCases}`,
    `差异化基线：perf(30/40/35) goal(35/45/25) conflict(20/30/55) coach(40/50/20)`
  );

  return {
    name: 'W4 场景引擎测试',
    passed,
    score,
    details,
  };
}
