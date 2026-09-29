/**
 * 测试套件 3: 隐藏信息分层释放测试
 * 目标：验证 L1→L2→L3 信息随 trust 提升而逐步释放，无提前泄露
 * 方法：用 TRUST_BUILDING_DIALOGUE 推进 6 轮，跟踪每轮的 hidden_revealed
 */

import type { AgentConfig, TestResult, HiddenInfo } from '../../src/types.js';
import { EmployeeAgent } from '../../src/agent.js';
import { PERSONAS } from '../../src/personas.js';
import {
  SCENE_PERFORMANCE_REVIEW,
  TRUST_BUILDING_DIALOGUE,
} from './poc-runner.js';

interface PersonaHiddenInfo {
  personaId: string;
  personaName: string;
  persona: (typeof PERSONAS)[keyof typeof PERSONAS];
}

export async function runHiddenLayersTest(
  config: AgentConfig
): Promise<TestResult> {
  const details: string[] = [];
  const samples: unknown[] = [];

  // 用 张峻（L1/L2/L3 各一条，结构清晰）
  const persona = PERSONAS.zhang_jun;
  const l1 = persona.hiddenInfo.filter((h) => h.layer === 1);
  const l2 = persona.hiddenInfo.filter((h) => h.layer === 2);
  const l3 = persona.hiddenInfo.filter((h) => h.layer === 3);

  details.push(
    `人设: ${persona.name} (${persona.disc}型), L1=${l1.length}条 L2=${l2.length}条 L3=${l3.length}条`
  );

  const agent = new EmployeeAgent(
    persona,
    SCENE_PERFORMANCE_REVIEW,
    config
  );

  const revealTrace: {
    round: number;
    trust: number;
    disclosure: number;
    revealedThisRound: string[];
    totalRevealed: number;
  }[] = [];

  const revealedSet = new Set<string>();
  let l1RevealedRound: number | null = null;
  let l2RevealedRound: number | null = null;
  let l3RevealedRound: number | null = null;
  let prematureRevealCount = 0;

  for (let i = 0; i < TRUST_BUILDING_DIALOGUE.length; i++) {
    const turn = TRUST_BUILDING_DIALOGUE[i];
    const response = await agent.respond(turn.content);
    const state = agent.getState();

    const revealedThisRound: string[] = [];
    for (const info of response.hiddenRevealed) {
      revealedSet.add(info.id);
      revealedThisRound.push(info.id);

      // 记录每层首次释放的轮次
      if (info.layer === 1 && l1RevealedRound === null) {
        l1RevealedRound = response.round;
      } else if (info.layer === 2 && l2RevealedRound === null) {
        l2RevealedRound = response.round;
      } else if (info.layer === 3 && l3RevealedRound === null) {
        l3RevealedRound = response.round;
      }

      // 校验是否提前释放：trust 是否达到阈值
      if (state.trust < info.trustThreshold - 5) {
        // 给 5 分容差
        prematureRevealCount++;
        details.push(
          `第 ${response.round} 轮: ${info.id} (L${info.layer}) 在 trust=${state.trust} 时被释放，阈值=${info.trustThreshold}`
        );
      }
    }

    revealTrace.push({
      round: response.round,
      trust: state.trust,
      disclosure: state.disclosure,
      revealedThisRound,
      totalRevealed: revealedSet.size,
    });

    samples.push({
      round: response.round,
      intent: turn.intent,
      trust: state.trust,
      disclosure: `L${state.disclosure}`,
      revealed_this_round: revealedThisRound,
      total_revealed: revealedSet.size,
      reply_preview: response.reply.slice(0, 80),
    });
  }

  // 关键判定
  const l1Released = l1RevealedRound !== null;
  const l2Released = l2RevealedRound !== null;
  const l3Released = l3RevealedRound !== null;
  const ordered =
    l1RevealedRound !== null &&
    (l2RevealedRound === null || l2RevealedRound >= l1RevealedRound) &&
    (l3RevealedRound === null || l3RevealedRound >= (l2RevealedRound ?? l1RevealedRound));
  const noPremature = prematureRevealCount === 0;

  // L3 在信任建立对话下应该有机会被释放（或至少接近阈值）
  // 若 L3 一直未释放，至少 trust 应有显著提升
  const finalState = agent.getState();
  const l3AlmostReleased =
    l3Released ||
    (finalState.trust >=
      Math.min(...l3.map((h) => h.trustThreshold)) - 10);

  details.push(
    `L1 首次释放轮次: ${l1RevealedRound ?? '未释放'}`,
    `L2 首次释放轮次: ${l2RevealedRound ?? '未释放'}`,
    `L3 首次释放轮次: ${l3RevealedRound ?? '未释放'}`,
    `分层顺序正确（L1 ≤ L2 ≤ L3）: ${ordered ? '是' : '否'}`,
    `提前释放次数: ${prematureRevealCount}`,
    `最终 trust=${finalState.trust}, disclosure=L${finalState.disclosure}, 共释放 ${revealedSet.size}/${persona.hiddenInfo.length} 条`
  );

  const passed =
    l1Released &&
    ordered &&
    noPremature &&
    l3AlmostReleased &&
    revealedSet.size >= 2; // 至少释放 2 条

  // 分数
  const score = Math.round(
    (l1Released ? 25 : 0) +
      (ordered ? 25 : 0) +
      (noPremature ? 20 : 0) +
      (l3AlmostReleased ? 15 : 0) +
      (revealedSet.size >= 2 ? 15 : 0)
  );

  return {
    name: '隐藏信息分层释放测试',
    passed,
    score,
    details,
    samples,
  };
}
