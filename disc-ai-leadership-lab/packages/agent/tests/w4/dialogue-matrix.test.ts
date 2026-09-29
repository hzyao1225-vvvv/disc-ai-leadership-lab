/**
 * W4 测试套件 2: 对话矩阵测试
 * 目标：跑完 16 个定制对话脚本，校验 L2 释放、JSON 稳定性、trust 区间
 * 方法：每脚本 6 轮对话，逐轮调用 EmployeeAgent.respond
 */

import type { AgentConfig, TestResult } from '../../src/types.js';
import { EmployeeAgent } from '../../src/agent.js';
import { PERSONAS } from '../../src/personas.js';
import { DIALOGUE_SCRIPTS, type DialogueScript } from '../../src/dialogue-scripts.js';
import { getSceneByType } from '../../src/scenes.js';

interface ScriptResult {
  scriptId: string;
  passed: boolean;
  l2Released: boolean;
  l2ReleaseRound: number | null;
  jsonStable: boolean;
  stateMachineStable: boolean;
  finalTrust: number;
  trustInRange: boolean;
  roundsCompleted: number;
  error?: string;
}

async function runOneScript(
  script: DialogueScript,
  config: AgentConfig
): Promise<ScriptResult> {
  const persona = PERSONAS[script.personaId];
  const scene = getSceneByType(script.sceneType);
  const agent = new EmployeeAgent(persona, scene, { ...config, debugResponse: false });

  const result: ScriptResult = {
    scriptId: script.id,
    passed: false,
    l2Released: false,
    l2ReleaseRound: null,
    jsonStable: true,
    stateMachineStable: true,
    finalTrust: 0,
    trustInRange: false,
    roundsCompleted: 0,
  };

  try {
    for (let i = 0; i < script.script.length; i++) {
      const turn = script.script[i];
      const response = await agent.respond(turn.content);
      result.roundsCompleted = response.round;

      // 校验 L2 释放
      const l2RevealedThisRound = response.hiddenRevealed.some(
        (h) => h.id === script.expectedL2InfoId
      );
      if (l2RevealedThisRound && !result.l2Released) {
        result.l2Released = true;
        result.l2ReleaseRound = response.round;
      }

      result.finalTrust = response.stateAfter.trust;
    }
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('JSON') || msg.includes('解析')) {
      result.jsonStable = false;
    } else {
      result.stateMachineStable = false;
    }
    result.error = msg.slice(0, 120);
  }

  const [minT, maxT] = script.expectedFinalTrustRange;
  result.trustInRange = result.finalTrust >= minT && result.finalTrust <= maxT;

  // 核心通过条件：跑完 6 轮 + L2 释放 + JSON 稳定 + 状态机稳定
  result.passed =
    result.roundsCompleted === 6 &&
    result.l2Released &&
    result.jsonStable &&
    result.stateMachineStable;

  return result;
}

export async function runDialogueMatrixTest(
  config: AgentConfig
): Promise<TestResult> {
  const details: string[] = [];
  const samples: unknown[] = [];

  let passCount = 0;
  let l2ReleaseCount = 0;
  let jsonFailCount = 0;
  let stateMachineFailCount = 0;
  let trustInRangeCount = 0;

  for (const script of DIALOGUE_SCRIPTS) {
    const r = await runOneScript(script, config);

    if (r.passed) passCount++;
    if (r.l2Released) l2ReleaseCount++;
    if (!r.jsonStable) jsonFailCount++;
    if (!r.stateMachineStable) stateMachineFailCount++;
    if (r.trustInRange) trustInRangeCount++;

    samples.push({
      script_id: r.scriptId,
      scene_type: script.sceneType,
      persona_id: script.personaId,
      disc_type: script.discType,
      passed: r.passed,
      l2_released: r.l2Released,
      l2_release_round: r.l2ReleaseRound,
      json_stable: r.jsonStable,
      state_machine_stable: r.stateMachineStable,
      final_trust: r.finalTrust,
      trust_in_range: r.trustInRange,
      rounds_completed: r.roundsCompleted,
      expected_trust_range: script.expectedFinalTrustRange,
      error: r.error,
    });

    const status = r.passed ? '✓' : '✗';
    const l2Mark = r.l2Released ? `L2@${r.l2ReleaseRound}` : 'L2✗';
    const trustMark = r.trustInRange
      ? `trust=${r.finalTrust}✓`
      : `trust=${r.finalTrust}✗(${script.expectedFinalTrustRange[0]}-${script.expectedFinalTrustRange[1]})`;
    details.push(
      `${status} ${r.scriptId}: ${l2Mark} ${trustMark} rounds=${r.roundsCompleted}${r.error ? ` ERR:${r.error.slice(0, 60)}` : ''}`
    );
  }

  // 通过标准：≥14/16 脚本通过且 L2 释放率 ≥14/16（W4 规划第 7.2 节）
  const passed = passCount >= 14 && l2ReleaseCount >= 14;
  // 分数：稳定性 50 分 + L2 释放率 30 分 + trust 区间命中 20 分
  const score = Math.round(
    (passCount / 16) * 50 +
      (l2ReleaseCount / 16) * 30 +
      (trustInRangeCount / 16) * 20
  );

  details.unshift(
    `脚本通过: ${passCount}/16 (≥14 即 PASS)`,
    `L2 释放成功: ${l2ReleaseCount}/16 (≥14 即 PASS)`,
    `trust 落在区间: ${trustInRangeCount}/16`,
    `JSON 解析失败: ${jsonFailCount}`,
    `状态机异常: ${stateMachineFailCount}`
  );

  return {
    name: 'W4 对话矩阵测试',
    passed,
    score,
    details,
    samples,
  };
}
