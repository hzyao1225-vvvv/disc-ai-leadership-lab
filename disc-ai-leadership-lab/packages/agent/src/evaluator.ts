/**
 * SessionEvaluator —— 1:1 会话评价器
 *
 * 设计目标：
 *   - 接收整段对话历史 + persona/scene/state 上下文 + 可选评价标准
 *   - 调 LLMGateway（qwen-plus）输出结构化 EvaluationResult
 *     （总分 + 维度分 + 附加指数 + 反馈 + 优点/改进 + 通关判定 + 多章节复盘报告）
 *   - 评价标准优先级：调用方传入 criteria > scene.evaluationCriteria > 内置默认 4 维骨架
 *   - 空对话时短路返回降级结果，不调 LLM
 *
 * 依赖：LLMGateway（agent 包内）、agent 类型（types.ts）
 */

import type {
  DialogueTurn,
  Persona,
  Scene,
  EmployeeState,
  EvaluationCriteria,
  EvaluationResult,
  ScoreDimension,
  ReportSection,
  LLMConfig,
} from './types.js';
import { LLMGateway } from './llm-gateway.js';
import { extractJSON } from './prompt-builder.js';

/** 默认 4 维度骨架（场景与调用方都未提供 criteria 时使用） */
const DEFAULT_DIMENSIONS = [
  {
    key: 'goal_attainment',
    label: '目标达成',
    description:
      '领导是否推动会话朝本次会话目标推进，最终是否识别/触及了目标中的关键事项',
  },
  {
    key: 'trust_building',
    label: '信任建立',
    description:
      '领导是否通过倾听、共情、认可等方式让员工逐步打开，避免触发雷区导致 trust 显著下降',
  },
  {
    key: 'communication_skill',
    label: '沟通技巧',
    description:
      '提问、反馈、复述、总结等基本技巧是否到位；是否避免说教、压制、跑题',
  },
  {
    key: 'emotion_handling',
    label: '情绪处理',
    description:
      '面对员工的情绪（抗拒/激动/回避）是否先降温再推进；是否被情绪裹挟或忽视情绪',
  },
];

/**
 * 截断 JSON 修复：LLM 输出被 maxTokens 截断时，按未闭合括号补齐尾部，
 * 并砍掉最后一个不完整的数组元素/对象属性，尽量 salvage 已完整的部分。
 * 修复失败返回 null（调用方抛原始解析错误）。
 */
function repairTruncatedJson(text: string): string | null {
  if (!text) return null;
  // 栈记录未闭合括号（忽略字符串内部的括号）
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }
  if (stack.length === 0) return null; // 括号平衡，不是截断问题

  // 从尾部往前裁掉不完整的最后一个元素：
  // 截到最后一个完整闭合的 '}' / ']'，或上一个逗号/冒号边界
  let trimmed = text.trimEnd();
  // 若末尾是未闭合字符串（奇数引号），先回退到该字符串起点之前
  if (inString) {
    const lastQuote = trimmed.lastIndexOf('"');
    if (lastQuote === -1) return null;
    trimmed = trimmed.slice(0, lastQuote).trimEnd();
  }
  // 回退到最近的完整结构边界（'}' / ']'），途中清掉不完整元素
  let guard = 0;
  while (trimmed.length > 0 && guard++ < 200) {
    const last = trimmed[trimmed.length - 1];
    if (last === '}' || last === ']') break; // 已到完整元素边界
    if (last === ',') {
      // 尾部逗号：删掉即回到完整边界
      trimmed = trimmed.slice(0, -1).trimEnd();
      break;
    }
    if (last === ':' || last === '{' || last === '[') {
      trimmed = trimmed.slice(0, -1).trimEnd(); // 删冒号/开括号
      trimmed = trimmed.replace(/"[^"]*"$/, '').trimEnd(); // 连同前面的 "key" 一起删
      continue; // 继续清理（可能又暴露冒号/逗号/开括号）
    }
    // 其他字符（孤立值片段）：逐字符回退
    trimmed = trimmed.slice(0, -1).trimEnd();
  }
  if (!trimmed || trimmed === '{' || trimmed === '[') return null;

  // 重新统计 trimmed 后的未闭合括号并补齐
  const stack2: string[] = [];
  let inStr2 = false;
  let esc2 = false;
  for (const ch of trimmed) {
    if (esc2) { esc2 = false; continue; }
    if (ch === '\\' && inStr2) { esc2 = true; continue; }
    if (ch === '"') { inStr2 = !inStr2; continue; }
    if (inStr2) continue;
    if (ch === '{' || ch === '[') stack2.push(ch);
    else if (ch === '}' || ch === ']') stack2.pop();
  }
  let repaired = trimmed;
  for (let i = stack2.length - 1; i >= 0; i--) {
    repaired += stack2[i] === '{' ? '}' : ']';
  }
  // 校验修复产物可被解析
  try {
    JSON.parse(repaired);
    return repaired;
  } catch {
    return null;
  }
}

export class SessionEvaluator {
  private llm: LLMGateway;
  private debug: boolean;

  constructor(llmConfig: LLMConfig, debug = false) {
    this.llm = new LLMGateway(llmConfig);
    this.debug = debug;
  }

  /**
   * 评价当前会话
   *
   * @param history  DialogueTurn[]（按时间序，leader/employee 交替）
   * @param persona  被评价的员工人设
   * @param scene    会话场景（可携带 evaluationCriteria）
   * @param state    当前 EmployeeState（信任/接受度/防御/认可/离职风险/释放层级，客观佐证）
   * @param criteria 可选评价标准；不传则回退 scene.evaluationCriteria，再回退默认 4 维骨架
   */
  async evaluate(
    history: ReadonlyArray<DialogueTurn>,
    persona: Persona,
    scene: Scene,
    state: EmployeeState,
    criteria?: EvaluationCriteria
  ): Promise<EvaluationResult> {
    // 空对话降级：不调 LLM
    if (!history || history.length === 0) {
      return {
        totalScore: 0,
        dimensions: [],
        feedback: '对话不足以评价：尚无对话轮次。',
        strengths: [],
        improvements: [],
        passLevel: 'unknown',
      };
    }

    const effectiveCriteria = criteria ?? scene.evaluationCriteria;
    const systemPrompt = this.buildSystemPrompt(persona, scene, effectiveCriteria);
    const userPrompt = this.buildUserPrompt(history, state);

    if (this.debug) {
      console.log('--- EVAL SYSTEM PROMPT ---');
      console.log(systemPrompt);
      console.log('--- EVAL USER PROMPT ---');
      console.log(userPrompt);
    }

    const rawOutput = await this.llm.chat(systemPrompt, userPrompt);

    if (this.debug) {
      console.log('--- EVAL RAW OUTPUT ---');
      console.log(rawOutput);
    }

    return this.parseEvaluationResult(rawOutput);
  }

  // ============== Prompt 构造 ==============

  private buildSystemPrompt(
    persona: Persona,
    scene: Scene,
    criteria?: EvaluationCriteria
  ): string {
    const dims: NonNullable<EvaluationCriteria['dimensions']> =
      criteria?.dimensions?.length ? criteria.dimensions : DEFAULT_DIMENSIONS;
    const totalWeight = dims.reduce(
      (sum, d) => sum + (d.weight ?? 0),
      0
    );

    const criteriaSection = dims
      .map(
        (d, i) =>
          `  ${i + 1}. [${d.key}] ${d.label}${d.weight ? `(权重 ${d.weight}%)` : ''}: ${d.description}`
      )
      .join('\n');

    const extraMetricsSection = criteria?.extraMetrics?.length
      ? `\n【附加指数】（单独打分，不计入 totalScore）\n${criteria.extraMetrics
          .map(
            (m, i) =>
              `  ${i + 1}. [${m.key}] ${m.label}: ${m.description}`
          )
          .join('\n')}\n`
      : '';

    const passStandardsSection = criteria?.passStandards
      ? this.buildPassStandardsSection(criteria)
      : '';

    const reportSectionsBlock = criteria?.reportSections?.length
      ? `\n【复盘报告章节】（必须按以下标题与顺序，在 reportSections 中逐节输出，title 用原标题，content 每节 80-200 字）\n${criteria.reportSections
          .map((s, i) => `  ${i + 1}. ${s}`)
          .join('\n')}\n`
      : '';

    const notesLine = criteria?.notes?.trim()
      ? `\n【附加说明】\n${criteria.notes.trim()}\n`
      : '';

    const weightingLine =
      totalWeight > 0
        ? `\n各维度权重合计 ${totalWeight}%；totalScore 必须等于各维度 score 按权重加权平均后的整数（四舍五入）。`
      : '';

    const passLevelField = criteria?.passStandards
      ? `\n  "passLevel": "excellent 或 qualified 或 fail（严格依据通关标准阈值判定）",`
      : '';

    const extraMetricsJson = criteria?.extraMetrics?.length
      ? `,\n  "extraMetrics": [
    { "key": "...", "label": "...", "score": 数字(0-100), "comment": "该指数的具体判断依据（80字内）" }
  ]`
      : '';

    const reportSectionsJson = criteria?.reportSections?.length
      ? `,\n  "reportSections": [
    { "title": "章节标题（用规定的原标题）", "content": "该章节正文（80-200字）" }
  ]`
      : '';

    return `你是一名 DISC 沟通训练评价官。根据以下信息对"领导"（即学员）的本次 1:1 会话表现给出结构化评价。

【员工人设】
- 姓名: ${persona.name}
- DISC 型: ${persona.disc}（高D辅I，D=${persona.discScores.D} I=${persona.discScores.I} S=${persona.discScores.S} C=${persona.discScores.C}）
- 职位: ${persona.title}
- 人才标签: ${persona.talentRole}
- 性格关键词: ${persona.personality.join('、')}
- 雷区: ${persona.landmines.join(' | ')}

【场景】
- 类型: ${scene.type}（${scene.title}）
- 描述: ${scene.description}
- 压力源: ${scene.stressors.join('、')}
- 领导者任务目标:
${scene.leaderGoals.map((g) => `  · ${g}`).join('\n')}

【评价维度】（每维度 0-100 分，comment 必须引用具体某轮某句的发言作为依据）
${criteriaSection}${weightingLine}
${extraMetricsSection}${passStandardsSection}${reportSectionsBlock}${notesLine}
【评价原则】
1. 基于对话事实评价，不用空话套话；每条 comment 必须引用具体某轮某句。
2. strengths 和 improvements 各至少 2 条，每条同样要具体到某轮某句。
3. 不允许无依据的满分/零分；反馈要面向"领导如何提升"，而非"员工表现如何"。
4. 若提供了通关标准与状态快照，passLevel 必须严格按阈值判定，并在复盘章节中说明判定依据。
5. "示范版最佳对话参考"章节要给出 5-8 句可直接使用的示范话术（领导视角）。

【输出格式 - 必须是严格的 JSON】
仅输出 JSON，不要 markdown 包裹，不要任何前后缀文字：
{
  "totalScore": 数字(0-100，加权平均),${passLevelField}
  "dimensions": [
    { "key": "...", "label": "...", "score": 数字(0-100), "comment": "具体反馈（80字内，引用某轮某句）" }
  ]${extraMetricsJson},
  "feedback": "整体叙述反馈（200字内，含通关判定结论）",
  "strengths": ["..."],
  "improvements": ["..."]${reportSectionsJson}
}`;
  }

  /** 通关标准段落 */
  private buildPassStandardsSection(criteria: EvaluationCriteria): string {
    const p = criteria.passStandards!;
    const fmt = (
      label: string,
      block: { criteria: string; indicators: string[] }
    ) =>
      `  · ${label}（${block.criteria}）\n    员工表现信号: ${block.indicators.join('；')}`;
    return `\n【通关标准】（结合最终状态快照与末轮员工表达判定）\n${fmt(
      '优秀通关 excellent',
      p.excellent
    )}\n${fmt('合格通关 qualified', p.qualified)}\n${fmt(
      '失败 fail',
      p.fail
    )}\n`;
  }

  private buildUserPrompt(
    history: ReadonlyArray<DialogueTurn>,
    state: EmployeeState
  ): string {
    const transcript = history
      .map((t) => {
        const role = t.role === 'leader' ? '领导' : '员工';
        const thought =
          t.role === 'employee' && t.internalThought
            ? `  [员工内心: ${t.internalThought}]`
            : '';
        return `第${t.round}轮 ${role}: ${t.content}${thought}`;
      })
      .join('\n');

    return `【对话实录】
${transcript}

【最终员工状态快照】（客观佐证，用于信任建立/情绪处理/通关判定等维度）
- 情绪: ${state.emotion}
- 信任度 Trust: ${state.trust}/100
- 接受度 Acceptance: ${state.acceptance}/100
- 防御值 Defense: ${state.resistance}/100
- 被认可感 Recognition: ${state.recognition}/100
- 离职风险 Attrition Risk: ${state.attritionRisk}/100
- 隐私释放层级: ${state.disclosure}/3
- 已释放隐藏信息: ${state.revealedInfoIds.length ? state.revealedInfoIds.join(', ') : '（无）'}

请按系统提示的 JSON 格式输出评价（含各维度分、总分、通关判定与全部复盘章节）。`;
  }

  // ============== 解析 ==============

  private parseEvaluationResult(raw: string): EvaluationResult {
    let jsonStr = extractJSON(raw);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (err) {
      // 截断兜底：LLM 输出被 maxTokens 截断时尝试修复
      const repaired = repairTruncatedJson(jsonStr);
      if (repaired) {
        console.warn('[evaluator] LLM 输出被截断，已自动修复（部分尾部内容可能缺失）');
        parsed = JSON.parse(repaired);
      } else {
        throw new Error(
          `评价 LLM 输出 JSON 解析失败: ${(err as Error).message}\n原始输出:\n${raw}`
        );
      }
    }

    const obj = parsed as Partial<EvaluationResult> & {
      totalScore?: number;
      dimensions?: unknown;
      feedback?: string;
      strengths?: unknown;
      improvements?: unknown;
      extraMetrics?: unknown;
      reportSections?: unknown;
      passLevel?: string;
    };

    if (typeof obj.totalScore !== 'number') {
      throw new Error('评价结果缺少 totalScore 字段或类型错误');
    }
    if (!Array.isArray(obj.dimensions)) {
      throw new Error('评价结果缺少 dimensions 数组');
    }

    const dimensions: ScoreDimension[] = obj.dimensions.map((d, i) => {
      const dim = d as Partial<ScoreDimension>;
      if (typeof dim.key !== 'string' || typeof dim.score !== 'number') {
        throw new Error(`dimensions[${i}] 缺少 key/score 字段`);
      }
      return {
        key: dim.key,
        label: dim.label ?? dim.key,
        score: dim.score,
        comment: dim.comment ?? '',
      };
    });

    const extraMetrics: ScoreDimension[] | undefined = Array.isArray(
      obj.extraMetrics
    )
      ? obj.extraMetrics
          .map((d) => {
            const m = d as Partial<ScoreDimension>;
            return typeof m.key === 'string' && typeof m.score === 'number'
              ? {
                  key: m.key,
                  label: m.label ?? m.key,
                  score: m.score,
                  comment: m.comment ?? '',
                }
              : null;
          })
          .filter((m): m is ScoreDimension => m !== null)
      : undefined;

    const reportSections: ReportSection[] | undefined = Array.isArray(
      obj.reportSections
    )
      ? obj.reportSections
          .map((s) => {
            const sec = s as Partial<ReportSection>;
            return typeof sec.title === 'string' && typeof sec.content === 'string'
              ? { title: sec.title, content: sec.content }
              : null;
          })
          .filter((s): s is ReportSection => s !== null)
      : undefined;

    const passLevel =
      obj.passLevel === 'excellent' ||
      obj.passLevel === 'qualified' ||
      obj.passLevel === 'fail'
        ? obj.passLevel
        : 'unknown';

    return {
      totalScore: Math.max(0, Math.min(100, Math.round(obj.totalScore))),
      dimensions,
      extraMetrics:
        extraMetrics && extraMetrics.length > 0 ? extraMetrics : undefined,
      feedback: typeof obj.feedback === 'string' ? obj.feedback : '',
      strengths: Array.isArray(obj.strengths)
        ? obj.strengths.filter((s): s is string => typeof s === 'string')
        : [],
      improvements: Array.isArray(obj.improvements)
        ? obj.improvements.filter((s): s is string => typeof s === 'string')
        : [],
      reportSections:
        reportSections && reportSections.length > 0 ? reportSections : undefined,
      passLevel,
    };
  }
}
