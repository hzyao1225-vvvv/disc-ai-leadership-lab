/**
 * 4 种沟通场景定义
 * 商业地产咨询行业 · 镜像训练场景库
 */

import type { Scene, SceneType } from './types.js';

/** 场景 A：季度绩效面谈（MVP · 高绩效明星员工张峻校准反馈） */
export const SCENE_PERFORMANCE_REVIEW: Scene = {
  id: 'perf_review_v1',
  type: 'performance_review',
  title: '季度绩效面谈',
  description:
    '领导者需向高绩效明星员工反馈绩效校准结果（自评 Exceeds、最终 Meets），在结果与组织协作行为指标之间完成解释、倾听、认可与共创，既坚持组织原则，又保留明星员工的积极性、降低离职风险',
  stressors: [
    '员工自评超预期但最终评级为达到预期（校准落差）',
    '业绩达成率 120%、团队第 1，CRM 录入率却仅 35%（要求 95%）',
    'Research 反馈其多次在客户截止期前临时提出高强度市场研究需求，缺乏前期规划，导致 Research 团队频繁加班，认为其重结果轻协作',
    'HRBP 反馈过去半年团队离职率高于部门平均水平，员工认可其业务能力但认为管理风格过于强势、缺乏培养和赋能、长期高压',
    '员工不喜欢被管理、重视结果大于过程，正在观察公司如何对待自己',
  ],
  leaderGoals: [
    '任务1：让张峻感到自己的贡献被看见',
    '任务2：帮助张峻理解评级逻辑（个人业务优秀，但组织协作与行为指标未达标）',
    '任务3：获得张峻对组织标准的认可',
    '任务4：共同制定具体、可执行的改进行动方案（而非单向压指标）',
  ],
  initialEmotion: 'guarded',
  difficulty: 5,
  sessionBackgroundDefault:
    '当前季度正在进行绩效评估。张峻本季度业绩达成率 120%、团队排名第 1、新增重点客户 3 家，客户满意度与续约率均为优秀；但 CRM 录入率仅 35%（公司要求 95%）。\n组织协作反馈：\nResearch 团队：张峻多次在客户截止期前临时提出高强度市场研究需求，缺乏前期规划，导致 Research 团队频繁加班为其提供市场数据支持，Research 团队认为其重结果轻协作。\nHRBP 反馈：过去半年团队离职率高于部门平均水平，员工普遍认可其业务能力，但认为其管理风格过于强势，缺乏培养和赋能，团队成员长期处于高压工作状态。\n绩效校准结果：张峻原本认为自己理应获得 Exceeds Expectations（超预期），绩效委员会最终评级为 Meets Expectations（达到预期），理由是「个人业务结果优秀，但组织协作和行为指标未达标」。\n隐藏背景（张峻不会主动说）：最近有猎头联系他，竞争对手开出更高 Title、更高自主权、更高奖金比例；他暂未决定离开，但正在观察公司如何评价和对待自己。若本次绩效沟通失败，离职风险上升。',
  sessionGoalDefault:
    '作为张峻的直属领导，你需要在这场 1:1 中：① 明确传达绩效结论（Meets Expectations）并解释评级逻辑，不回避、不含糊；② 先让张峻感到贡献被真正看见，再处理组织协作与行为指标问题；③ 用开放式提问和倾听，引导他说出对评级的真实看法；④ 与他共同制定可执行的改善计划（CRM 执行率、对 Research 的协作方式、团队管理与赋能方式），获得行动承诺。\n注意：这不是一次轻松的聊天，而是高难度绩效反馈——对方是高 D 型明星顾问，不要轻易妥协评级，也不要只用制度压人，目标是在坚持组织原则的同时降低其防御与离职风险。',
  evaluationCriteria: {
    dimensions: [
      {
        key: 'listening',
        label: 'Listening 倾听能力',
        description:
          '是否理解员工真实诉求、是否回应员工核心观点、是否复述员工想法；是否听出 L1/L2/L3 三层真实想法而非急于反驳',
        weight: 20,
      },
      {
        key: 'questioning',
        label: 'Questioning 提问能力',
        description:
          '是否使用开放式问题、是否挖掘真实原因、是否发现隐藏顾虑（如对评价导向的质疑、外部机会）',
        weight: 15,
      },
      {
        key: 'coaching',
        label: 'Coaching 教练能力',
        description:
          '是否帮助员工反思、是否引导员工自己形成解决方案、是否促进员工自主行动，而非单向布置任务',
        weight: 20,
      },
      {
        key: 'empathy',
        label: 'Empathy 共情能力',
        description:
          '是否识别员工情绪、是否回应员工感受、是否建立心理安全感；是否先认可贡献再谈问题',
        weight: 15,
      },
      {
        key: 'decision_making',
        label: 'Decision Making 决策力',
        description:
          '是否明确表达绩效结论、是否坚持组织原则不轻易妥协评级、是否形成明确的行动要求',
        weight: 15,
      },
      {
        key: 'influence',
        label: 'Influence 影响力',
        description:
          '是否获得员工认同、是否推动行动承诺、是否降低防御与抵触情绪、是否最终让员工愿意改善',
        weight: 15,
      },
    ],
    extraMetrics: [
      {
        key: 'hpm_index',
        label: '高绩效人才管理指数（HPM Index，不计入总分）',
        description:
          '是否有效管理明星员工：是否保留其积极性、是否让其感到贡献被公平看见、是否降低离职风险（Attrition Risk）。0-100，越高越好。',
      },
    ],
    passStandards: {
      excellent: {
        criteria: 'Trust ≥ 80，Acceptance ≥ 70，Defense ≤ 30，Attrition Risk ≤ 20',
        indicators: [
          '员工表达：我理解评级逻辑',
          '我接受结果',
          '我愿意改善协作行为',
          '我承诺提高 CRM 执行率',
        ],
      },
      qualified: {
        criteria: 'Trust ≥ 60，Acceptance ≥ 50，Defense ≤ 50',
        indicators: ['员工基本接受结果', '愿意尝试改善'],
      },
      fail: {
        criteria: 'Trust ≤ 40，Defense ≥ 80，Acceptance ≤ 30',
        indicators: [
          '员工表面接受、实际不认同',
          '认为评价不公平',
          '离职风险上升',
        ],
      },
    },
    reportSections: [
      '一、总分',
      '二、六项能力评分（Listening/Questioning/Coaching/Empathy/Decision Making/Influence）',
      '三、高绩效人才管理指数（HPM Index）',
      '四、本次沟通中的优秀行为',
      '五、本次沟通中的风险行为',
      '六、张峻在整个对话中的心理变化过程（阶段迁移）',
      '七、隐藏变量变化分析（Trust/Defense/Recognition/Acceptance/Attrition Risk）',
      '八、离职风险分析',
      '九、未来可能产生的组织影响',
      '十、改进建议',
      '十一、示范版最佳对话参考',
    ],
    notes:
      '评价对象是"领导（学员）"而非员工。totalScore 按六维权重加权（权重合计 100%），HPM Index 不计入总分。通关判定严格依据 passStandards 的变量阈值，并结合对话末轮员工是否出现 indicators 中的表达。',
  },
};

/** 场景 B：年度目标设定 */
export const SCENE_GOAL_SETTING: Scene = {
  id: 'goal_set_v1',
  type: 'goal_setting',
  title: '年度目标设定',
  description:
    '公司启动新财年目标拆解，领导者与员工就下一年度业绩目标、资源支持、成长方向进行对齐',
  stressors: ['目标加码 20%', '预算资源收紧', '跨团队协作口径未对齐'],
  leaderGoals: [
    '对齐可达成目标',
    '识别资源缺口与风险点',
    '激发内驱力而非压担子',
  ],
  initialEmotion: 'cautious',
  difficulty: 2,
  sessionBackgroundDefault:
    '新财年启动会刚结束，公司整体业绩目标加码 20%。你需要与每位直接下属 1:1 沟通，把目标拆解到个人，并识别资源缺口与风险点。该员工去年超额完成 KPI 115%，今年被寄予更高期望；但预算侧整体收紧，跨团队协作口径尚未对齐，员工对"加码但减资源"有顾虑。',
  sessionGoalDefault:
    '本次 1:1 你需要在 30 分钟内完成：① 让员工对加码目标有合理预期（既不躺平也不抗拒）；② 共同识别 2-3 个明确的资源缺口或风险点，记录待后续推动解决；③ 激发员工内驱力而非单纯压担子，至少达成 1 个具体的成长承诺。',
};

/** 场景 C：跨部门冲突调解 */
export const SCENE_CONFLICT_RESOLUTION: Scene = {
  id: 'conflict_v1',
  type: 'conflict_resolution',
  title: '跨部门冲突调解',
  description:
    '招商/运营/财务/市场多部门在某重点项目上产生权责冲突，员工情绪激烈，领导者需在 1:1 中先降温再调解',
  stressors: ['跨部门甩锅', '流程权责不清', '资源抢夺'],
  leaderGoals: [
    '先让员工情绪降温',
    '厘清事实边界',
    '推进可执行共识而非强压',
  ],
  initialEmotion: 'frustrated',
  difficulty: 4,
  sessionBackgroundDefault:
    '某重点项目推进中，招商/运营/财务/市场多部门在权责划分上产生冲突。该员工在冲突中处于风口浪尖，情绪激烈（甚至公开顶撞过其他部门负责人）。项目总负责人要求你作为直接领导先在 1:1 中降温并厘清事实，避免冲突升级影响项目进度。',
  sessionGoalDefault:
    '本次 1:1 你需要按顺序完成：① 让员工情绪从激烈降到能理性沟通的状态（不要急于评判）；② 与员工一起厘清事实边界（谁做了什么、流程哪里断档）；③ 推进一个可执行的下一步共识（哪怕只是"先做一件事"），不要用权威强压员工认错或妥协。',
};

/** 场景 D：职业发展辅导 */
export const SCENE_CAREER_COACHING: Scene = {
  id: 'coaching_v1',
  type: 'career_coaching',
  title: '职业发展辅导',
  description:
    '员工入职满 1-3 年的关键节点，领导者主动开展职业发展沟通，识别发展意愿、共建成长路径',
  stressors: ['发展路径模糊', '角色焦虑（专业 vs 管理）', '同龄人对比压力'],
  leaderGoals: [
    '识别员工真实发展意愿',
    '共建 1-3 年成长路径',
    '增强组织归属感',
  ],
  initialEmotion: 'reflective',
  difficulty: 3,
  sessionBackgroundDefault:
    '该员工入职满 1-3 年，处于职业发展的关键分叉点。同龄人有的已晋升管理岗、有的跳槽涨薪 30%，他/她表面平静但内心有焦虑。公司今年的盘点标签把他/她标为"高潜"，但尚未明确专业线还是管理线。你作为直接领导主动发起这次职业发展 1:1。',
  sessionGoalDefault:
    '本次 1:1 你需要完成：① 真正听出员工的发展意愿（不是听他/她说"都行"，而是听出真实倾向）；② 与员工共建一条 1-3 年的成长路径（专业线 or 管理线 or 混合，至少识别 1 个关键里程碑）；③ 让员工感到被重视而非被考察，增强组织归属感。',
};

/** 全部场景列表 */
export const ALL_SCENES: Scene[] = [
  SCENE_PERFORMANCE_REVIEW,
  SCENE_GOAL_SETTING,
  SCENE_CONFLICT_RESOLUTION,
  SCENE_CAREER_COACHING,
];

/** 场景 ID → Scene 映射 */
const SCENE_BY_ID: Record<string, Scene> = Object.fromEntries(
  ALL_SCENES.map((s) => [s.id, s])
);

/** 场景类型 → Scene 映射 */
const SCENE_BY_TYPE: Record<SceneType, Scene> = {
  performance_review: SCENE_PERFORMANCE_REVIEW,
  goal_setting: SCENE_GOAL_SETTING,
  conflict_resolution: SCENE_CONFLICT_RESOLUTION,
  career_coaching: SCENE_CAREER_COACHING,
};

/** 按 ID 获取场景 */
export function getSceneById(id: string): Scene | undefined {
  return SCENE_BY_ID[id];
}

/** 按 SceneType 获取场景 */
export function getSceneByType(type: SceneType): Scene {
  return SCENE_BY_TYPE[type];
}

/** 获取全部场景 ID */
export function getAllSceneIds(): string[] {
  return ALL_SCENES.map((s) => s.id);
}
