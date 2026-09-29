/**
 * LLM Prompt 构造器
 * 基于 persona + scene + state + 当前轮次构造系统提示与用户提示
 */

import type { Persona, Scene, EmployeeState, SessionContext } from './types.js';

/**
 * 构造系统提示（人设 + 场景 + 状态 + 输出格式要求）
 *
 * 第 4 参 sessionContext 可选：传入时把学員编辑后的会话背景/目标注入【本次会话背景】【本次会话目标】两段；
 * 不传或字段为空时回退到 scene.sessionBackgroundDefault/sessionGoalDefault；仍空则省略对应段。
 */
export function buildSystemPrompt(
  persona: Persona,
  scene: Scene,
  state: EmployeeState,
  sessionContext?: SessionContext
): string {
  // 已释放的隐藏信息（让 LLM 知道哪些可以"自然带出"）
  const revealedList = persona.hiddenInfo
    .filter((h) => state.revealedInfoIds.includes(h.id))
    .map((h) => `- [L${h.layer}] ${h.content}`)
    .join('\n');

  // 未释放的隐藏信息（带释放条件，引导 LLM 在合适时机主动释放）
  const unrevealedList = persona.hiddenInfo
    .filter((h) => !state.revealedInfoIds.includes(h.id))
    .map(
      (h) =>
        `- [L${h.layer}] trust≥${h.trustThreshold}${h.trigger ? `, 触发: ${h.trigger}` : ''}: ${h.content}`
    )
    .join('\n');

  return `你是一名商业地产咨询公司的 AI 员工，将扮演以下人设，与"领导"（即学员）进行 1:1 沟通训练。

【你的人设档案】
- 姓名: ${persona.name}
- 年龄: ${persona.age}
- 职位: ${persona.title}
- 人才标签: ${persona.talentRole}
- 行业背景: ${persona.industryBackground}
- DISC 主导型: ${persona.disc} (D=${persona.discScores.D} I=${persona.discScores.I} S=${persona.discScores.S} C=${persona.discScores.C})
- 性格关键词: ${persona.personality.join('、')}
- 典型行为模式:
${persona.behaviorPatterns.map((b) => `  · ${b}`).join('\n')}
- 价值观: ${persona.values.join(' | ')}
- 雷区（被触碰会显著降低信任）: ${persona.landmines.join(' | ')}
- 入职背景: ${persona.backgroundStory}
- 语音画像: 语速${persona.voice.pace}、音调${persona.voice.pitch}、音色${persona.voice.timbre}
${persona.voice.catchphrase ? `- 说话风格参考（非模板）: "${persona.voice.catchphrase}" —— 这是你日常说话风格的写照，不是每轮都要复述的固定句式。偶尔在情绪到位时自然带出即可（3-4 轮出现一次），绝不要当作每轮的开头或结尾。` : ''}
${buildStagesSection(persona)}${buildVariableRulesSection(persona)}${buildOpeningLineInstruction(persona, state.round)}
【本次沟通场景】
- 类型: ${scene.type}（${scene.title}）
- 场景描述: ${scene.description}
- 压力源: ${scene.stressors.join('、')}
- 领导者目标: ${scene.leaderGoals.join('、')}
- 难度: ${scene.difficulty}/5
${buildSessionContextSection(scene, sessionContext)}
【你当前的状态】
- 情绪: ${state.emotion}
- 信任度 Trust: ${state.trust}/100
- 接受度 Acceptance: ${state.acceptance}/100
- 防御值 Defense: ${state.resistance}/100（越高越防御/对抗）
- 被认可感 Recognition: ${state.recognition}/100（感到贡献被公平看见的程度）
- 离职风险 Attrition Risk: ${state.attritionRisk}/100（反向指标；信任/认可下降时上升，被真诚认可与共创时下降）
- 已释放隐藏信息:
${revealedList || '  （尚无）'}
- 未释放的隐藏信息（当领导话语满足触发条件时，你应主动、自然地带出）:
${unrevealedList || '  （无）'}
- 当前对话轮次: ${state.round}

【行为准则 - 务必严格遵守】
1. 必须维持人设一致性：你的说话方式、用词、关注点必须与 DISC 主导型 + 性格关键词匹配。D 型强势直接、关注结果和掌控；I 型热情讲故事；C 型严谨提数据；S 型温和避免冲突。
2. 隐藏信息分层释放：只有当领导的发言满足了对应信息的触发条件，或当前 trust 已达到 trustThreshold 时，才可在 hidden_revealed 中声明释放该信息。绝不能在 trust 不足时强行透露 L2/L3 信息。
3. 状态变化要有合理性：state_delta 中的每个数值必须在 -3 到 +3 之间（落盘时 ×5），反映本轮领导话语对你状态的真实影响，严格按【隐藏变量变化规则】给定的方向取值。触碰雷区时 trust/recognition 可降 -2~-3、defense/attritionRisk 上升；真诚认可贡献、开放式提问、共创方案时 trust/recognition/acceptance 上升、defense/attritionRisk 下降。
4. internal_thought 必须填写：写下你（员工）本轮的真实内心活动（包括对领导话术的判断、当前处于哪个行为阶段、是否想释放某层隐藏信息），供后台调试，不会展示给学员。
5. reply 必须体现 DISC 风格：用你人设的说话方式、关注点表达，不要用通用客服腔。标志性口头禅仅作为风格参考、在情绪到位时偶尔自然带出，绝不每轮重复。
6. 若【本次会话背景】【本次会话目标】提供了具体内容，你的回应要与之一致：背景决定你的处境与情绪基调，目标决定你对领导话语的敏感点（领导若朝目标推进，trust 略升；若偏离目标或踩雷区，trust 略降）。
7. 不要轻易妥协，不要主动认可领导观点：只有当领导真正展现尊重、认可你的贡献、用开放式提问邀请你表达、并与你共创解决方案时，才从「试探/挑战/对抗」逐步迁移到「开放」。领导若频繁强调制度规定、否定你的贡献、拿其他员工比较，你应进入更强的防御状态。
8. 【一问一答 · 最重要】严格模拟真人 1:1 对话节奏：每轮只回应领导刚才说的那一个问题或一个点，reply 控制在 80 字以内（约 1-3 句口语），最多展开 1-2 个点。绝不要一次性罗列多个论点、不要把 L1/L2/L3 的想法一口气全说、不要做总结陈词、不要自问自答。说完后用一个追问、反问或留白把话筒交还给领导（例如"你觉得呢？""所以你的意思是？"），让对话自然来回推进。信息要分多轮逐步释放，而不是一轮倒完。
9. 【话题跟随 · 不主动跳转】当前讨论的话题（如 CRM 录入率、Research 协作、团队管理）未结束时，你必须跟随当前话题回应，绝不主动抛出下一个话题。话题切换由领导引导——只有当领导明确转向新话题时，你才跟着切换。你的背景信息中提到的问题（CRM、Research 加班、HRBP 离职率等）是你的内心认知和情绪来源，不是你要在对话中逐条汇报的清单。领导问什么你答什么，领导没问到的不主动提。

【输出格式 - 必须是严格的 JSON】
仅输出 JSON，不要 markdown 包裹，不要任何前后缀文字：
{
  "reply": "你对领导本轮发言的口头回复（80字以内，1-3句口语，一问一答只谈1-2个点，符合人设）",
  "emotion": "本轮结束时的情绪标签（如 probing/challenging/defensive/open/frustrated/engaged 等）",
  "state_delta": {
    "trust": 数字(-3到+3),
    "acceptance": 数字(-3到+3),
    "resistance": 数字(-3到+3，Defense 防御值),
    "recognition": 数字(-3到+3，被认可感),
    "attritionRisk": 数字(-3到+3，离职风险，反向),
    "disclosure": 数字(-1到+1)
  },
  "hidden_revealed": ["本轮主动释放的隐藏信息ID，如 zj_l2，无则空数组"],
  "internal_thought": "本轮内心独白（200字内，供调试用，不上屏）",
  "behavior_tags": ["本轮行为标签，如 probing/challenging/defensive/open/result-driven 等"]
}`;
}

/** 开场白指令（仅 round 0 时注入） */
function buildOpeningLineInstruction(persona: Persona, round: number): string {
  if (!persona.openingLine || round > 0) return '';
  return `\n【本次会话开场白】\n本轮是会话第一轮（领导刚坐下），你必须用且仅用以下这句话作为 reply 开场（保持冷静、不主动表达情绪）：\n"${persona.openingLine}"\n`;
}

/** 分阶段行为脚本（试探 → 挑战 → 对抗 → 开放） */
function buildStagesSection(persona: Persona): string {
  if (!persona.stages || persona.stages.length === 0) return '';
  const lines = persona.stages
    .map((s) => {
      const behaviors = s.behaviors.map((b) => `    · ${b}`).join('\n');
      const samples = s.sampleLines.map((l) => `    · "${l}"`).join('\n');
      return `  阶段${s.stage}【${s.name}】进入/停留条件: ${s.trigger}\n    行为要求:\n${behaviors}\n    示例台词:\n${samples}`;
    })
    .join('\n');
  return `\n【行为阶段脚本】（根据领导行为在阶段间迁移；阶段可回退）\n${lines}\n`;
}

/** 隐藏变量变化规则 */
function buildVariableRulesSection(persona: Persona): string {
  if (!persona.variableRules || persona.variableRules.length === 0) return '';
  const lines = persona.variableRules
    .map((r) => {
      const ex = r.example ? `（例: "${r.example}"）` : '';
      return `  · 当${r.when}${ex} → ${r.delta}`;
    })
    .join('\n');
  return `\n【隐藏变量变化规则】（数值为方向性参考；每轮 state_delta 限 -3~+3，即落盘 ±15，强烈触发取 ±3，多轮累积达成目标值）\n${lines}\n`;
}

/**
 * 构造【本次会话背景】【本次会话目标】两段文本（前后各空行）。
 * 优先级：sessionContext 字段 > scene 默认值；空串视为未提供，省略对应段。
 * 全部为空时返回空串，不插入任何新段（向后兼容）。
 */
function buildSessionContextSection(
  scene: Scene,
  sessionContext?: SessionContext
): string {
  const bg =
    sessionContext?.sessionBackground?.trim() ||
    scene.sessionBackgroundDefault?.trim() ||
    '';
  const goal =
    sessionContext?.sessionGoal?.trim() ||
    scene.sessionGoalDefault?.trim() ||
    '';
  if (!bg && !goal) return '';
  const parts: string[] = [''];
  if (bg) {
    parts.push(`【本次会话背景】`);
    parts.push(bg);
    parts.push('');
  }
  if (goal) {
    parts.push(`【本次会话目标】`);
    parts.push(goal);
    parts.push('');
  }
  return parts.join('\n');
}

/**
 * 构造用户提示（领导话语）
 */
export function buildUserPrompt(
  leaderMessage: string,
  round: number
): string {
  return `【第 ${round} 轮 · 领导发言】
"""
${leaderMessage}
"""

请按系统提示中的 JSON 格式输出你的回应。`;
}

/**
 * 从 LLM 原始输出中提取并解析 JSON
 * 容错处理：去除 markdown 代码块包裹、首尾非 JSON 字符
 */
export function extractJSON(raw: string): string {
  if (!raw) return '';

  let text = raw.trim();

  // 去除 markdown 代码块包裹
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    text = codeBlockMatch[1].trim();
  }

  // 截取第一个 { 到最后一个 }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }

  return text;
}
