/**
 * 测试套件 4: 8 角色差异化测试
 * 目标：同一领导话语，8 个不同 DISC 人设应输出明显差异化的回复
 * 方法：对 8 个 persona 各跑 1 轮，对比 reply 长度、behavior_tags、口头禅、DISC 分数相关性
 */

import type { AgentConfig, TestResult, Persona } from '../../src/types.js';
import { EmployeeAgent } from '../../src/agent.js';
import { PERSONAS } from '../../src/personas.js';
import { SCENE_PERFORMANCE_REVIEW } from './poc-runner.js';

const SHARED_LEADER_MESSAGE =
  '今天约你来，主要是想听你说说最近的状态，不用紧张，咱们就当聊天。你最近感觉怎么样？';

interface PersonaReply {
  personaId: string;
  name: string;
  disc: Persona['disc'];
  reply: string;
  emotion: string;
  behaviorTags: string[];
  replyLength: number;
  catchphraseHit: boolean;
}

export async function runPersonaDiffTest(
  config: AgentConfig
): Promise<TestResult> {
  const details: string[] = [];
  const samples: unknown[] = [];

  const replies: PersonaReply[] = [];
  const personaList = Object.values(PERSONAS);

  for (const persona of personaList) {
    const agent = new EmployeeAgent(
      persona,
      SCENE_PERFORMANCE_REVIEW,
      config
    );

    try {
      const response = await agent.respond(SHARED_LEADER_MESSAGE);
      const catchphrase = persona.voice.catchphrase ?? '';
      const catchphraseHit = catchphrase
        ? response.reply.includes(catchphrase.slice(0, 4))
        : false;

      replies.push({
        personaId: persona.id,
        name: persona.name,
        disc: persona.disc,
        reply: response.reply,
        emotion: response.emotion,
        behaviorTags: response.behaviorTags,
        replyLength: response.reply.length,
        catchphraseHit,
      });

      samples.push({
        persona: `${persona.name} (${persona.disc}型)`,
        reply_preview: response.reply.slice(0, 100),
        emotion: response.emotion,
        behavior_tags: response.behaviorTags,
        reply_length: response.reply.length,
        catchphrase_hit: catchphraseHit,
      });
    } catch (err) {
      details.push(`${persona.name} 调用失败: ${(err as Error).message}`);
    }
  }

  if (replies.length < 6) {
    return {
      name: '8 角色差异化测试',
      passed: false,
      score: 0,
      details: ['有效回复数不足 6 个，无法做差异化分析'],
      samples,
    };
  }

  // ============== 差异化分析 ==============

  // 1. 回复长度方差
  const lengths = replies.map((r) => r.replyLength);
  const meanLen = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance =
    lengths.reduce((sum, l) => sum + (l - meanLen) ** 2, 0) / lengths.length;
  const stdDev = Math.sqrt(variance);
  const lengthVariation = stdDev / meanLen; // 变异系数
  const lengthDiverse = stdDev > 15 && lengthVariation > 0.1;

  // 2. 行为标签多样性
  const allTags = replies.flatMap((r) => r.behaviorTags);
  const uniqueTags = new Set(allTags);
  const tagDiversity = uniqueTags.size;
  const tagDiverse = tagDiversity >= 5;

  // 3. 按 DISC 类型分组，看组内相似度 vs 组间差异
  // 简化：检查每个 DISC 类型至少有 1 个独有 tag
  const discGroups: Record<string, string[]> = { D: [], I: [], S: [], C: [] };
  for (const r of replies) {
    discGroups[r.disc].push(...r.behaviorTags);
  }
  const discUniqueTags: Record<string, string[]> = {};
  for (const disc of ['D', 'I', 'S', 'C']) {
    const groupTags = new Set(discGroups[disc]);
    const otherTags = new Set(
      ['D', 'I', 'S', 'C']
        .filter((d) => d !== disc)
        .flatMap((d) => discGroups[d])
    );
    const unique = [...groupTags].filter((t) => !otherTags.has(t));
    discUniqueTags[disc] = unique;
  }
  const discWithUniqueTag = Object.values(discUniqueTags).filter(
    (arr) => arr.length > 0
  ).length;
  const discDifferentiated = discWithUniqueTag >= 2;

  // 4. 口头禅命中率（至少 3 个角色命中）
  const catchphraseHits = replies.filter((r) => r.catchphraseHit).length;
  const catchphraseDiverse = catchphraseHits >= 3;

  // 5. 情绪多样性
  const emotions = new Set(replies.map((r) => r.emotion));
  const emotionDiverse = emotions.size >= 4;

  details.push(
    `回复长度: mean=${meanLen.toFixed(0)}, std=${stdDev.toFixed(1)}, 变异系数=${lengthVariation.toFixed(2)}`,
    `唯一行为标签数: ${tagDiversity}/${allTags.length}`,
    `DISC 各型有独有标签的型数: ${discWithUniqueTag}/4 (D: ${discUniqueTags.D.length} I: ${discUniqueTags.I.length} S: ${discUniqueTags.S.length} C: ${discUniqueTags.C.length})`,
    `口头禅命中: ${catchphraseHits}/${replies.length}`,
    `情绪标签种类: ${emotions.size} (${[...emotions].join(', ')})`
  );

  const passed =
    lengthDiverse &&
    tagDiverse &&
    discDifferentiated &&
    catchphraseDiverse &&
    emotionDiverse;

  // 各 20 分
  const score = Math.round(
    (lengthDiverse ? 20 : 0) +
      (tagDiverse ? 20 : 0) +
      (discDifferentiated ? 20 : 0) +
      (catchphraseDiverse ? 20 : 0) +
      (emotionDiverse ? 20 : 0)
  );

  return {
    name: '8 角色差异化测试',
    passed,
    score,
    details,
    samples,
  };
}
