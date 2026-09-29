/**
 * W4 测试套件 3: 跨角色差异化测试
 * 目标：4 场景 × 8 角色 = 32 个跑通测试，校验稳定性和差异化
 * 方法：每个组合只跑第 1 轮（控制 LLM 调用次数），统计差异化指标
 */

import type { AgentConfig, TestResult } from '../../src/types.js';
import { EmployeeAgent } from '../../src/agent.js';
import { PERSONAS } from '../../src/personas.js';
import {
  ALL_PERSONA_IDS_FOR_MATRIX_TEST,
  getScriptForPersona,
} from '../../src/dialogue-scripts.js';
import { ALL_SCENES } from '../../src/scenes.js';

export async function runCrossPersonaDiffTest(
  config: AgentConfig
): Promise<TestResult> {
  const details: string[] = [];
  const samples: unknown[] = [];

  let passCount = 0;
  let jsonFailCount = 0;
  let rejectedRevealsCount = 0;

  const replyLengths: number[] = [];
  const behaviorTags = new Set<string>();
  const emotions = new Set<string>();
  const catchphraseHits: string[] = [];

  const totalCases = ALL_SCENES.length * ALL_PERSONA_IDS_FOR_MATRIX_TEST.length; // 4 * 8 = 32

  for (const scene of ALL_SCENES) {
    for (const personaId of ALL_PERSONA_IDS_FOR_MATRIX_TEST) {
      const persona = PERSONAS[personaId];
      const script = getScriptForPersona(scene.type, personaId, persona.disc);
      const turn = script.script[0]; // 只跑第 1 轮

      const agent = new EmployeeAgent(persona, scene, {
        ...config,
        debugResponse: false,
      });

      try {
        const response = await agent.respond(turn.content);

        replyLengths.push(response.reply.length);
        response.behaviorTags.forEach((t) => behaviorTags.add(t));
        emotions.add(response.emotion);

        // 口头禅命中率
        if (persona.voice.catchphrase) {
          const hit = response.reply.includes(persona.voice.catchphrase.slice(0, 6));
          catchphraseHits.push(hit ? personaId : '');
        }

        passCount++;

        samples.push({
          scene_type: scene.type,
          persona_id: personaId,
          disc_type: persona.disc,
          reply_preview: response.reply.slice(0, 60),
          reply_length: response.reply.length,
          emotion: response.emotion,
          behavior_tags: response.behaviorTags,
          trust_after: response.stateAfter.trust,
        });
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes('JSON') || msg.includes('解析')) jsonFailCount++;
        details.push(`✗ ${scene.type} × ${personaId}: ${msg.slice(0, 80)}`);
      }
    }
  }

  // 差异化指标
  const meanLen =
    replyLengths.length > 0
      ? replyLengths.reduce((a, b) => a + b, 0) / replyLengths.length
      : 0;
  const variance =
    replyLengths.length > 0
      ? Math.sqrt(
          replyLengths.reduce((s, l) => s + (l - meanLen) ** 2, 0) /
            replyLengths.length
        )
      : 0;
  const uniqueTags = behaviorTags.size;
  const uniqueEmotions = emotions.size;
  const catchphraseHitCount = catchphraseHits.filter((s) => s).length;

  // 通过标准：32/32 跑通
  const passed = passCount === totalCases;
  // 分数：稳定性 60 分 + 标签丰富度 15 分 + 情绪丰富度 15 分 + 口头禅命中 10 分
  const tagScore = Math.min(uniqueTags, 20);
  const emotionScore = Math.min(uniqueEmotions * 3, 15);
  const catchphraseScore = Math.round((catchphraseHitCount / 8) * 10);
  const score = Math.round(
    (passCount / totalCases) * 60 + tagScore + emotionScore + catchphraseScore
  );

  details.unshift(
    `跑通: ${passCount}/${totalCases}`,
    `JSON 失败: ${jsonFailCount}`,
    `reply 长度: mean=${meanLen.toFixed(1)}, std=${variance.toFixed(1)}`,
    `唯一行为标签数: ${uniqueTags} (≥20 满分)`,
    `情绪标签种类: ${uniqueEmotions} (${[...emotions].join(', ')})`,
    `口头禅命中: ${catchphraseHitCount}/8`
  );

  return {
    name: 'W4 跨角色差异化测试',
    passed,
    score,
    details,
    samples,
  };
}
