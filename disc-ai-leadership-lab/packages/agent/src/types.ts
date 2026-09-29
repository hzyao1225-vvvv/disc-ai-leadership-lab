/**
 * DISC × AI 镜像实验室 - 核心类型定义
 * 商业地产咨询行业 · AI 员工 Agent
 */

// ============== DISC 性格类型 ==============

export type DISCType = 'D' | 'I' | 'S' | 'C';

export interface DISCTrait {
  type: DISCType;
  /** 该角色在 D/I/S/C 四象限上的强度（0-100） */
  scores: { D: number; I: number; S: number; C: number };
}

// ============== 隐藏信息分层 ==============

export type HiddenLayer = 1 | 2 | 3;

export interface HiddenInfo {
  id: string;
  layer: HiddenLayer;
  /** 触发该信息释放所需的最低 trust 值（0-100） */
  trustThreshold: number;
  content: string;
  /** 额外触发条件描述（用于 LLM 判断） */
  trigger?: string;
}

// ============== 语音画像 ==============

export interface VoiceProfile {
  /** 语速 slow | medium | fast */
  pace: 'slow' | 'medium' | 'fast';
  /** 音调 low | mid | high */
  pitch: 'low' | 'mid' | 'high';
  /** 音色描述（供 TTS 选型） */
  timbre: string;
  /** 标志性口头禅 */
  catchphrase?: string;
}

// ============== Persona（员工人设） ==============

/** 人设级初始状态覆盖（合并到场景基线之上） */
export type PersonaInitialState = Partial<
  Pick<
    EmployeeState,
    'trust' | 'acceptance' | 'resistance' | 'recognition' | 'attritionRisk' | 'disclosure'
  >
>;

/** 分阶段行为脚本（如：试探 → 挑战 → 对抗 → 开放） */
export interface PersonaStage {
  /** 阶段序号，从 1 开始 */
  stage: number;
  /** 阶段名（如「试探」） */
  name: string;
  /** 进入/停留该阶段的条件（领导做了什么/没做什么） */
  trigger: string;
  /** 该阶段的行为要求 */
  behaviors: string[];
  /** 该阶段的示例台词 */
  sampleLines: string[];
}

/** 隐藏变量变化规则（指导 LLM 每轮 state_delta 的方向与幅度） */
export interface VariableRule {
  /** 触发情境（领导的具体行为） */
  when: string;
  /** 领导话术示例 */
  example?: string;
  /** 各变量变化（自由文本，如「recognition +20, trust +10」；落盘时按 -3~+3/轮 折算） */
  delta: string;
}

export interface Persona {
  id: string;
  name: string;
  disc: DISCType;
  age: number;
  title: string;
  /** 人才盘点标签 */
  talentRole: string;
  industryBackground: string;
  personality: string[];
  /** 典型行为模式（供 LLM 模仿） */
  behaviorPatterns: string[];
  /** 价值观与雷区 */
  values: string[];
  landmines: string[];
  /** 初始状态：入职 6 个月的真实处境 */
  backgroundStory: string;
  /** 隐瞒或未主动透露的信息（分层释放） */
  hiddenInfo: HiddenInfo[];
  voice: VoiceProfile;
  /** DISC 四象限强度（供差异化分析） */
  discScores: { D: number; I: number; S: number; C: number };
  /** 人设级初始状态覆盖（如高绩效明星 trust 50 / defense 70） */
  initialState?: PersonaInitialState;
  /** 会话第一句固定开场白（无则由 LLM 自由开场） */
  openingLine?: string;
  /** 分阶段行为脚本（按对话推进与领导行为在阶段间迁移） */
  stages?: PersonaStage[];
  /** 隐藏变量变化规则 */
  variableRules?: VariableRule[];
}

// ============== Scene（沟通场景） ==============

export type SceneType =
  | 'performance_review'   // 绩效面谈
  | 'goal_setting'          // 目标设定
  | 'conflict_resolution'   // 冲突调解
  | 'career_coaching';      // 职业发展辅导

export interface Scene {
  id: string;
  type: SceneType;
  title: string;
  description: string;
  /** 场景中的压力源 */
  stressors: string[];
  /** 领导者目标 */
  leaderGoals: string[];
  /** 员工初始情绪 */
  initialEmotion: string;
  /** 难度 1-5 */
  difficulty: number;
  /** 本次会话发生的背景（详细上下文，供 prompt 注入；学员可在前端覆盖编辑） */
  sessionBackgroundDefault?: string;
  /** 本次会话要达成的具体目标（供 prompt 注入；学员可在前端覆盖编辑） */
  sessionGoalDefault?: string;
  /** 场景绑定的评价标准（维度/权重/通关标准/复盘章节）；评价器缺省回退到此配置 */
  evaluationCriteria?: EvaluationCriteria;
}

// ============== 会话上下文（学员在前端可编辑的 bg/goal，运行期覆盖 scene 默认值） ==============

export interface SessionContext {
  /** 学员编辑后的会话背景；空串/undefined 表示走 scene.sessionBackgroundDefault */
  sessionBackground?: string;
  /** 学员编辑后的会话目标；空串/undefined 表示走 scene.sessionGoalDefault */
  sessionGoal?: string;
}

// ============== 员工状态机 ==============

export interface EmployeeState {
  /** 情绪标签（如 frustrated / engaged / defensive） */
  emotion: string;
  /** 信任度 Trust 0-100 */
  trust: number;
  /** 接受度 Acceptance 0-100（对领导建议的接受程度） */
  acceptance: number;
  /** 抗拒/防御值 Defense 0-100（反向指标；高D 明星员工初始偏高） */
  resistance: number;
  /** 被认可感 Recognition 0-100（员工感到自己的贡献被公平看见的程度） */
  recognition: number;
  /** 离职风险 Attrition Risk 0-100（反向指标；信任/认可下降时上升） */
  attritionRisk: number;
  /** 隐含信息释放层级 0-3 */
  disclosure: number;
  /** 已释放的隐藏信息 ID 列表 */
  revealedInfoIds: string[];
  /** 行为标签 */
  behaviorTags: string[];
  /** 累计对话轮数 */
  round: number;
}

// ============== 对话轮次 ==============

export interface DialogueTurn {
  round: number;
  role: 'leader' | 'employee';
  content: string;
  /** 员工的内心独白（不展示给学员，供 PoC 调试） */
  internalThought?: string;
  timestamp: number;
}

// ============== LLM 响应结构 ==============

export interface LLMResponse {
  /** 员工对领导的口头回复 */
  reply: string;
  /** 当前情绪标签 */
  emotion: string;
  /** 状态增量（每项 -3 到 +3，落盘时 ×5 折算；recognition/attritionRisk 可选以向后兼容） */
  state_delta: {
    trust: number;
    acceptance: number;
    resistance: number;
    disclosure: number;
    recognition?: number;
    attritionRisk?: number;
  };
  /** 本轮解锁的隐藏信息 ID 列表 */
  hidden_revealed: string[];
  /** 内心独白（不展示给学员） */
  internal_thought: string;
  /** 行为标签 */
  behavior_tags: string[];
}

// ============== Agent 响应 ==============

export interface AgentResponse {
  reply: string;
  emotion: string;
  stateBefore: EmployeeState;
  stateAfter: EmployeeState;
  hiddenRevealed: HiddenInfo[];
  internalThought: string;
  behaviorTags: string[];
  round: number;
  /** 原始 LLM 输出（供调试） */
  rawLLMOutput?: string;
}

// ============== Agent 配置 ==============

export interface LLMConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AgentConfig {
  llm: LLMConfig;
  debugPrompt?: boolean;
  debugResponse?: boolean;
  /** 本次会话上下文（背景/目标），用于覆盖 scene 默认值并注入 system prompt */
  sessionContext?: SessionContext;
}

// ============== 评价体系（骨架） ==============

/** 单个评价维度的打分 */
export interface ScoreDimension {
  /** 维度 key（如 goal_attainment） */
  key: string;
  /** 维度展示名（如「目标达成」） */
  label: string;
  /** 该维度得分 0-100 */
  score: number;
  /** 该维度的具体反馈 */
  comment: string;
}

/** 复盘报告章节（如「心理变化过程」「离职风险分析」「示范对话参考」） */
export interface ReportSection {
  /** 章节标题 */
  title: string;
  /** 章节正文 */
  content: string;
}

/** 评价结果（SessionEvaluator.evaluate 返回） */
export interface EvaluationResult {
  /** 总分 0-100 */
  totalScore: number;
  /** 多维度打分 */
  dimensions: ScoreDimension[];
  /** 不计入总分的附加指数（如高绩效人才管理指数 HPM Index） */
  extraMetrics?: ScoreDimension[];
  /** 整体叙述反馈（200 字内） */
  feedback: string;
  /** 优点列表（至少 2 条） */
  strengths: string[];
  /** 改进点列表（至少 2 条） */
  improvements: string[];
  /** 多章节复盘报告（通关判定、心理变化、风险分析、示范对话等） */
  reportSections?: ReportSection[];
  /** 通关判定（依据场景 passStandards；无标准时缺省） */
  passLevel?: 'excellent' | 'qualified' | 'fail' | 'unknown';
}

/** 通关标准（优秀 / 合格 / 失败的阈值与员工表现描述） */
export interface PassStandards {
  excellent: {
    /** 阈值条件（自由文本，如「Trust≥80, Acceptance≥70, Defense≤30, Attrition Risk≤20」） */
    criteria: string;
    /** 员工应有的表达/状态 */
    indicators: string[];
  };
  qualified: {
    criteria: string;
    indicators: string[];
  };
  fail: {
    criteria: string;
    indicators: string[];
  };
}

/** 评价标准（可绑定在 Scene 上；评价器缺省回退到 scene.evaluationCriteria，再回退默认 4 维骨架） */
export interface EvaluationCriteria {
  /** 维度 key → 该维度的评分描述与权重（权重为百分比数字，如 20 表示 20%） */
  dimensions?: Array<{
    key: string;
    label: string;
    description: string;
    /** 权重（百分比，如 20 = 20%）；全部维度权重之和应为 100 */
    weight?: number;
  }>;
  /** 不计入总分的附加指数（如高绩效人才管理指数） */
  extraMetrics?: Array<{
    key: string;
    label: string;
    description: string;
  }>;
  /** 通关标准（优秀/合格/失败） */
  passStandards?: PassStandards;
  /** 复盘报告需要输出的章节标题（按顺序） */
  reportSections?: string[];
  /** 自由文本附加说明 */
  notes?: string;
}

// ============== PoC 验证报告 ==============

export interface TestResult {
  name: string;
  passed: boolean;
  score: number;
  details: string[];
  samples?: unknown[];
}

export interface PocReport {
  timestamp: string;
  model: string;
  suites: {
    jsonStability?: TestResult;
    stateMachine?: TestResult;
    hiddenLayers?: TestResult;
    personaDiff?: TestResult;
  };
  overallPassed: boolean;
  summary: string;
}
