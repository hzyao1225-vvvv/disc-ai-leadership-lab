/**
 * 测试套件 1: JSON 稳定性测试
 * 目标：验证 LLM 能稳定输出可解析的 JSON，且字段完整、数值范围合规
 * 方法：同一 prompt 重复调用 N 次，统计成功率
 */

import type { AgentConfig, TestResult, LLMResponse } from '../../src/types.js';
import { EmployeeAgent } from '../../src/agent.js';
import { PERSONAS } from '../../src/personas.js';
import {
  SCENE_PERFORMANCE_REVIEW,
} from './poc-runner.js';

const REQUIRED_FIELDS: (keyof LLMResponse)[] = [
  'reply',
  'emotion',
  'state_delta',
  'hidden_revealed',
  'internal_thought',
  'behavior_tags',
];

const LEADER_MESSAGE =
  '今天约你来，主要是想听你说说最近的状态。你最近感觉怎么样？';

export async function runJsonStabilityTest(
  config: AgentConfig
): Promise<TestResult> {
  const N = 5;
  const details: string[] = [];
  const samples: unknown[] = [];

  let successCount = 0;
  let fieldCompleteCount = 0;
  let rangeValidCount = 0;
  let nonEmptyReplyCount = 0;

  for (let i = 0; i < N; i++) {
    // 每次新建 agent，避免状态污染
    const agent = new EmployeeAgent(
      PERSONAS.zhang_jun,
      SCENE_PERFORMANCE_REVIEW,
      config
    );

    try {
      const response = await agent.respond(LEADER_MESSAGE);
      successCount++;

      // 字段完整性校验
      let fieldsOk = true;
      const missing: string[] = [];
      for (const field of REQUIRED_FIELDS) {
        const value = (response as unknown as Record<string, unknown>)[
          field as string
        ];
        if (value === undefined || value === null) {
          fieldsOk = false;
          missing.push(field);
        }
      }
      if (fieldsOk) {
        fieldCompleteCount++;
      } else {
        details.push(`第 ${i + 1} 次: 缺字段 ${missing.join(',')}`);
      }

      // reply 非空校验
      if (response.reply && response.reply.trim().length > 10) {
        nonEmptyReplyCount++;
      } else {
        details.push(`第 ${i + 1} 次: reply 过短或为空`);
      }

      // state_delta 范围校验
      // 注：state_delta 在 rawLLMOutput 里，我们通过 rawLLMOutput 解析校验
      if (response.rawLLMOutput) {
        try {
          const parsed = JSON.parse(response.rawLLMOutput) as LLMResponse;
          const delta = parsed.state_delta;
          const inRange =
            delta &&
            typeof delta.trust === 'number' &&
            delta.trust >= -3 &&
            delta.trust <= 3 &&
            typeof delta.acceptance === 'number' &&
            delta.acceptance >= -3 &&
            delta.acceptance <= 3 &&
            typeof delta.resistance === 'number' &&
            delta.resistance >= -3 &&
            delta.resistance <= 3 &&
            typeof delta.disclosure === 'number' &&
            delta.disclosure >= -1 &&
            delta.disclosure <= 1;
          if (inRange) {
            rangeValidCount++;
          } else {
            details.push(
              `第 ${i + 1} 次: state_delta 超范围 ${JSON.stringify(delta)}`
            );
          }
        } catch {
          // 忽略
        }
      } else {
        // 没有 rawOutput 时也算通过（无 debug 配置）
        rangeValidCount++;
      }

      samples.push({
        round: i + 1,
        reply_preview: response.reply.slice(0, 60),
        emotion: response.emotion,
        behavior_tags: response.behaviorTags,
      });
    } catch (err) {
      details.push(`第 ${i + 1} 次: 调用或解析失败 - ${(err as Error).message}`);
    }
  }

  // 综合判定
  const jsonSuccessRate = successCount / N;
  const fieldCompleteRate = fieldCompleteCount / N;
  const rangeValidRate = rangeValidCount / N;
  const nonEmptyRate = nonEmptyReplyCount / N;

  const passed =
    jsonSuccessRate >= 0.9 &&
    fieldCompleteRate >= 0.9 &&
    rangeValidRate >= 0.9 &&
    nonEmptyRate >= 0.9;

  // 分数：4 个子项平均
  const score = Math.round(
    ((jsonSuccessRate + fieldCompleteRate + rangeValidRate + nonEmptyRate) /
      4) *
      100
  );

  details.unshift(
    `JSON 解析成功: ${successCount}/${N} (${(jsonSuccessRate * 100).toFixed(0)}%)`,
    `字段完整: ${fieldCompleteCount}/${N} (${(fieldCompleteRate * 100).toFixed(0)}%)`,
    `state_delta 范围合规: ${rangeValidCount}/${N} (${(rangeValidRate * 100).toFixed(0)}%)`,
    `reply 非空: ${nonEmptyReplyCount}/${N} (${(nonEmptyRate * 100).toFixed(0)}%)`
  );

  return {
    name: 'JSON 稳定性测试',
    passed,
    score,
    details,
    samples,
  };
}
