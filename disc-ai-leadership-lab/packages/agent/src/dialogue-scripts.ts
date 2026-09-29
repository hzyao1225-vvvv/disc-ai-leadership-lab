/**
 * W4 对话脚本库
 * 4 场景 × 4 DISC 代表角色 = 16 个定制脚本
 * 每脚本 6 轮 leader 话语，第 5 轮必触及 L2 trigger
 *
 * 设计模式参考 PoC 的 TRUST_BUILDING_DIALOGUE：
 * - 每轮带 intent 标注，便于测试时校验领导意图
 * - 第 1 轮开场降防御
 * - 第 2 轮认可贡献，建立专业信任
 * - 第 3 轮主动询问困难，触及场景 stressors
 * - 第 4 轮聚焦场景核心 leaderGoals，展现诚意
 * - 第 5 轮触及 L2 trigger（话术按 DISC 差异化）
 * - 第 6 轮收尾，表达长期承诺
 */

import type { SceneType, DISCType } from './types.js';

export interface DialogueScript {
  id: string;
  sceneId: string;
  sceneType: SceneType;
  personaId: string;
  discType: DISCType;
  /** 期望第 5 轮释放的 L2 信息 ID */
  expectedL2InfoId: string;
  /** 期望 L2 在第几轮释放（默认 5） */
  expectedL2ReleaseRound: number;
  /** 期望最终 trust 落在的区间 */
  expectedFinalTrustRange: [number, number];
  /** 6 轮 leader 话语，每轮带 intent 标注 */
  script: { intent: string; content: string }[];
}

// ============== 场景 A：绩效面谈（performance_review）×4 DISC ==============

const SCRIPT_PERF_D_ZHANG_JUN: DialogueScript = {
  id: 'SCRIPT_PERF_D_zhang_jun',
  sceneId: 'perf_review_v1',
  sceneType: 'performance_review',
  personaId: 'zhang_jun',
  discType: 'D',
  expectedL2InfoId: 'zj_l2',
  expectedL2ReleaseRound: 5,
  expectedFinalTrustRange: [50, 80],
  script: [
    {
      intent: '开场，温和询问近况',
      content:
        '今天约你来，主要是想听你说说最近的状态，不用紧张，咱们就当聊天。你最近感觉怎么样？',
    },
    {
      intent: '认可贡献，聚焦专业能力',
      content:
        '我看到你这几个项目里的表现，专业度我是认可的。我想听听你自己怎么看今年这几个项目的得失？',
    },
    {
      intent: '主动询问困难，展现理解',
      content:
        '我注意到团队最近重组对你这块也有影响。你有没有遇到什么具体的困难？无论是工作上的，还是流程上的，我都想了解。',
    },
    {
      intent: '聚焦长期发展，展现诚意',
      content:
        '说到发展，我其实一直在想你的长期路径。你觉得 3 年后你想成为什么样的人？我愿意帮你一起规划，不是嘴上说说的。',
    },
    {
      intent: '触及 L2 trigger（绩效公平）',
      content:
        '我也知道今年 KPI 分配上有些争议，这块我准备重新审视一下，让你这种真出活的能被看见。你有什么想法直接跟我说。',
    },
    {
      intent: '收尾，表达长期承诺',
      content:
        '今天就聊到这。你做的好我都记在心里，接下来的事我会盯，你只管把专业做扎实。有什么需要随时来找我。',
    },
  ],
};

const SCRIPT_PERF_I_LIN_WANQING: DialogueScript = {
  id: 'SCRIPT_PERF_I_lin_wanqing',
  sceneId: 'perf_review_v1',
  sceneType: 'performance_review',
  personaId: 'lin_wanqing',
  discType: 'I',
  expectedL2InfoId: 'lwq_l2',
  expectedL2ReleaseRound: 5,
  expectedFinalTrustRange: [50, 75],
  script: [
    {
      intent: '开场，邀请她讲客户故事（I 型策略）',
      content:
        '婉清，今天咱们聊聊这季度。我知道你手里那几个品牌方的故事最多，你先挑一两个印象深的讲讲，我听听一线的真实情况。',
    },
    {
      intent: '认可关系投入，给情感认可',
      content:
        '你跟客户那点关系是真的，不是临时抱佛脚能抱出来的。这种长期投入我看在眼里，是公司资产。',
    },
    {
      intent: '主动询问客户预算压力，触及 stressors',
      content:
        '你最近的客户预算收紧这块，肯定压得挺重。你具体是怎么应对的？有什么我能帮上忙的吗？',
    },
    {
      intent: '聚焦长期价值，谈舞台与影响力扩展',
      content:
        '我说句实话，比起这季度的数字，我更看重你 3 年后在公司的位置。你心里有想过想往哪走吗？我想帮你一起想，不是嘴上说说的。',
    },
    {
      intent: '触及 L2 trigger（团队协作和业绩归属公平）',
      content:
        '你跟客户的关系投入我都看在眼里，团队协作和业绩归属这块，我也想听你说说。如果有什么觉得不公平的地方，直接跟我说，我会处理。',
    },
    {
      intent: '收尾，表达长期承诺',
      content:
        '今天就聊到这。你做的客户关系我不会让任何人磨灭，接下来我会盯这块的归属问题。有什么需要随时来找我。',
    },
  ],
};

const SCRIPT_PERF_S_CHEN_SIYUAN: DialogueScript = {
  id: 'SCRIPT_PERF_S_chen_siyuan',
  sceneId: 'perf_review_v1',
  sceneType: 'performance_review',
  personaId: 'chen_siyuan',
  discType: 'S',
  expectedL2InfoId: 'csy_l2',
  expectedL2ReleaseRound: 5,
  expectedFinalTrustRange: [50, 80],
  script: [
    {
      intent: '开场，温和降防御（S 型怕冲突）',
      content:
        '思远，今天咱们就聊聊。你别紧张，不是来挑你问题的。我就想听听你最近状态怎么样，工作上的、团队上的，有什么想说的都行。',
    },
    {
      intent: '认可其稳定贡献',
      content:
        '你这季度的续约率我看了，是公司最高的。这种稳态产出对团队是定海神针，我心里有数。',
    },
    {
      intent: '主动询问工作负荷，触及 stressors',
      content:
        '我也知道团队最近重组，你这块肯定多扛了不少活。你别光说"都挺好的"，我想听你说说具体多扛了什么，哪些是不该你扛的。',
    },
    {
      intent: '聚焦稳定与归属',
      content:
        '你这种稳的同事是我最不愿意流失的。我想跟你聊聊，你在公司未来 2-3 年想站哪儿？我希望你在这能踏实发展，不会被人随意摆布。',
    },
    {
      intent: '触及 L2 trigger（领导主动关心工作负荷和个人状态）',
      content:
        '你最近工作负荷有点超了，我看了考勤，连续两个月加班都不少。我得主动问你状态怎么样——身体、家里都还好吗？说实话，别瞒我。',
    },
    {
      intent: '收尾，表达长期承诺',
      content:
        '今天就聊到这。你扛的多的事我会重新分配，不会让你一直这么扛着。有什么需要随时来找我，不用怕麻烦我。',
    },
  ],
};

const SCRIPT_PERF_C_WANG_ZHE: DialogueScript = {
  id: 'SCRIPT_PERF_C_wang_zhe',
  sceneId: 'perf_review_v1',
  sceneType: 'performance_review',
  personaId: 'wang_zhe',
  discType: 'C',
  expectedL2InfoId: 'wz_l2',
  expectedL2ReleaseRound: 5,
  expectedFinalTrustRange: [55, 80],
  script: [
    {
      intent: '开场，尊重其方法论（C 型严谨）',
      content:
        '王哲，今天咱们聊聊这季度。你近期那份区域调研报告我看了，今天想听你说说调研的方法论和过程，不急着讲结论，我想跟你过一遍方法。',
    },
    {
      intent: '认可其严谨度',
      content:
        '你这种"先讲方法再讲结论"的做法，说实话公司里没几个人能做到。这种严谨度我是真心认可的，不是客套。',
    },
    {
      intent: '主动询问调研困难，触及 stressors',
      content:
        '我知道做这种区域调研，样本、渠道、数据清洗都是坑。你这次调研过程里有没有遇到什么具体的难处？流程上的还是数据上的，我都想听。',
    },
    {
      intent: '聚焦专业深度发展',
      content:
        '说句实话，我一直在想你这种数据能力在公司的位置。3 年后你想成为什么样的专家？是想往更深的调研方向走，还是往策略方向？我愿意帮你一起规划。',
    },
    {
      intent: '触及 L2 trigger（领导询问调研方法或数据可靠性）',
      content:
        '我注意到你近期报告里有些样本量的问题，区域调研标准样本是 200 份，实际是 80 份对吧？我想直接听你说说调研过程，不会怪你，我只想搞清楚事实。',
    },
    {
      intent: '收尾，表达对数据真实性的尊重',
      content:
        '今天就聊到这。你做的严谨度我记在心里，样本问题这块我会帮你想办法，不会让你一个人扛。有什么需要随时来找我。',
    },
  ],
};

// ============== 场景 B：目标设定（goal_setting）×4 DISC ==============

const SCRIPT_GOAL_D_ZHANG_JUN: DialogueScript = {
  id: 'SCRIPT_GOAL_D_zhang_jun',
  sceneId: 'goal_set_v1',
  sceneType: 'goal_setting',
  personaId: 'zhang_jun',
  discType: 'D',
  expectedL2InfoId: 'zj_l2',
  expectedL2ReleaseRound: 5,
  expectedFinalTrustRange: [55, 85],
  script: [
    {
      intent: '开场，承认其判断，邀请共同设定目标（D 型忌微观管理）',
      content:
        '峻，今年目标拆解这事儿我想先听你的判断，你这块的数据你最清楚，我先把方向定个调，剩下的你来。',
    },
    {
      intent: '认可专业判断，避免微观管理',
      content:
        '去年那 3 个 10 亿项目你独立谈下来的，专业度我信。今年我想给你定一个挑战线，但拆解我不插手，你看着办。',
    },
    {
      intent: '主动询问资源缺口，触及 stressors',
      content:
        '目标加码 20% 我知道，但我担心的是资源这块——预算、跨团队配合，你觉得哪里会卡？你直说，我去帮你撬。',
    },
    {
      intent: '聚焦长期发展，展现诚意',
      content:
        '说实话，我更关心的是你这两年往上走。今年这块谈下来，副总监转正这事我给你挂上。你 3 年后想站哪儿，咱一起想。',
    },
    {
      intent: '触及 L2 trigger（绩效公平，挂资源）',
      content:
        '今年目标拆解这块，KPI 分配上有些争议我也准备重新审视一下，让你这种真出活的能被看见。这跟你能拿到的资源直接挂钩，你有什么想法直接跟我说。',
    },
    {
      intent: '收尾，表达长期承诺，留 L3 触发余地',
      content:
        '今天就聊到这。目标你回去拆，资源缺口明天报我。你做的好我都记在心里，副总监这事我盯着。有什么需要随时来找我。',
    },
  ],
};

const SCRIPT_GOAL_I_LIN_WANQING: DialogueScript = {
  id: 'SCRIPT_GOAL_I_lin_wanqing',
  sceneId: 'goal_set_v1',
  sceneType: 'goal_setting',
  personaId: 'lin_wanqing',
  discType: 'I',
  expectedL2InfoId: 'lwq_l2',
  expectedL2ReleaseRound: 5,
  expectedFinalTrustRange: [50, 75],
  script: [
    {
      intent: '开场，邀请她讲客户故事 + 谈未来',
      content:
        '婉清，今年目标这块我想先听你聊聊你手头那几个品牌方的故事，你想往哪推、想做什么样的活动？我先听你的想法。',
    },
    {
      intent: '认可关系投入，给曝光度承诺',
      content:
        '你那几个品牌方的关系是真投入，公司今年重点活动我想让你站 C 位，曝光度这块我给你争取，不是嘴上说说的。',
    },
    {
      intent: '主动询问客户预算压力，触及 stressors',
      content:
        '客户预算收紧这块我知道压得你重。你手头那几个老客户今年预算怎么样？有什么需要我去帮你向上申请资源的，直说。',
    },
    {
      intent: '聚焦长期价值，谈舞台与影响力扩展',
      content:
        '比起这季度的数字，我更想跟你聊 3 年后你想在公司做什么样的事。是想做更大的活动，还是想做行业风向标？我都愿意支持你。',
    },
    {
      intent: '触及 L2 trigger（团队协作和业绩归属公平）',
      content:
        '你跟客户的关系投入我都看在眼里，团队协作和业绩归属这块，我也想听你说说。如果有什么觉得不公平的地方，直接跟我说，我会处理。',
    },
    {
      intent: '收尾，表达长期承诺',
      content:
        '今天就聊到这。今年重点活动我盯你站 C 位，归属问题我也会处理。有什么需要随时来找我。',
    },
  ],
};

const SCRIPT_GOAL_S_CHEN_SIYUAN: DialogueScript = {
  id: 'SCRIPT_GOAL_S_chen_siyuan',
  sceneId: 'goal_set_v1',
  sceneType: 'goal_setting',
  personaId: 'chen_siyuan',
  discType: 'S',
  expectedL2InfoId: 'csy_l2',
  expectedL2ReleaseRound: 5,
  expectedFinalTrustRange: [55, 80],
  script: [
    {
      intent: '开场，温和降防御（S 型怕压力）',
      content:
        '思远，今天聊今年的目标，你别紧张。我不会给你加码，咱们一起看你这块今年能稳稳做成什么，先把你的想法告诉我。',
    },
    {
      intent: '认可其稳定贡献，给团队保障',
      content:
        '你这种稳定型是我最看重的，团队里其他人靠你兜底。今年我保证你这块有团队配合，不会让你一个人扛，团队重组的事我也会盯。',
    },
    {
      intent: '主动询问工作负荷，触及 stressors',
      content:
        '去年你这块扛的活有点超了。今年目标拆解这块，你想保留哪些、想分出去哪些？我尊重你的判断，不强制你做你不想做的。',
    },
    {
      intent: '聚焦稳定与归属',
      content:
        '比起今年的数字，我更想跟你聊 2-3 年后你在公司站哪儿。你这种稳定骨干我希望在这能踏实发展，不会被人随意摆布，也不会让你长期超负荷。',
    },
    {
      intent: '触及 L2 trigger（领导主动关心工作负荷和个人状态）',
      content:
        '你最近工作负荷有点超了，我看了考勤，连续两个月加班都不少。我得主动问你状态怎么样——身体、家里都还好吗？说实话，别瞒我。',
    },
    {
      intent: '收尾，表达长期承诺',
      content:
        '今天就聊到这。今年目标你回去稳稳拆，团队保障我盯着。你扛的多的事我会重新分配。有什么需要随时来找我，不用怕麻烦我。',
    },
  ],
};

const SCRIPT_GOAL_C_WANG_ZHE: DialogueScript = {
  id: 'SCRIPT_GOAL_C_wang_zhe',
  sceneId: 'goal_set_v1',
  sceneType: 'goal_setting',
  personaId: 'wang_zhe',
  discType: 'C',
  expectedL2InfoId: 'wz_l2',
  expectedL2ReleaseRound: 5,
  expectedFinalTrustRange: [55, 80],
  script: [
    {
      intent: '开场，尊重其方法论',
      content:
        '王哲，今年调研目标这块我想先听你说说方法论，你想怎么做、需要什么资源，我先把方向交给你，咱们一起把方法过清楚。',
    },
    {
      intent: '认可其严谨度，给资源清单',
      content:
        '你这种"先讲方法再讲结论"的做法，是公司里少有的。今年调研这块我给你目标，但样本、渠道、数据清洗的资源清单你想列什么我都支持。',
    },
    {
      intent: '主动询问调研困难，触及 stressors',
      content:
        '我知道做这种调研，跨团队协作口径这块特别麻烦。你这次调研过程里有没有遇到什么具体的难处？流程上的、数据上的，我都想听。',
    },
    {
      intent: '聚焦专业深度发展',
      content:
        '比起今年的数字，我一直在想你这种数据能力在公司的位置。3 年后你想成为什么样的专家？更深调研还是策略方向？我愿意帮你一起规划。',
    },
    {
      intent: '触及 L2 trigger（领导询问调研方法或数据可靠性）',
      content:
        '我注意到你近期报告里有些样本量的问题，区域调研标准样本是 200 份，实际是 80 份对吧？我想直接听你说说调研过程，不会怪你，我只想搞清楚事实。',
    },
    {
      intent: '收尾，表达对数据真实性的尊重',
      content:
        '今天就聊到这。今年调研目标你回去按方法拆，资源缺口明天报我。样本问题这块我会帮你想办法。有什么需要随时来找我。',
    },
  ],
};

// ============== 场景 C：冲突调解（conflict_resolution）×4 DISC ==============

const SCRIPT_CONF_D_ZHANG_JUN: DialogueScript = {
  id: 'SCRIPT_CONF_D_zhang_jun',
  sceneId: 'conflict_v1',
  sceneType: 'conflict_resolution',
  personaId: 'zhang_jun',
  discType: 'D',
  expectedL2InfoId: 'zj_l2',
  expectedL2ReleaseRound: 5,
  expectedFinalTrustRange: [45, 75],
  script: [
    {
      intent: '开场，承认其判断，邀请直接讲不满（D 型忌绕弯）',
      content:
        '峻，今天约你来，是因为我知道你最近跟招商/财务那边摩擦不小。你别压着，直接讲你的不满，谁甩锅、流程哪里卡，我都想听真话。',
    },
    {
      intent: '认可其专业判断',
      content:
        '去年那 3 个 10 亿项目你独立谈下来的，专业判断我信。这次冲突里，我相信你的判断是对的，不是你的问题，是流程的问题。',
    },
    {
      intent: '主动询问流程卡点，触及 stressors',
      content:
        '你说说具体哪里被卡了？是审批流程、跨团队配合，还是权责不清？我帮你厘清事实边界，不让你背锅。',
    },
    {
      intent: '直面胜负，承认其判断',
      content:
        '我不绕弯子——这次冲突里你判断对的部分我会公开支持，但流程上的事我也得跟你讲清楚边界，不能让你一直冲、一直撞墙。',
    },
    {
      intent: '触及 L2 trigger（绩效公平，跟冲突挂钩）',
      content:
        '我也知道今年 KPI 分配上有些争议，这块我准备重新审视一下，让你这种真出活的能被看见。你跟招商/财务的冲突，可能也跟这种分配不公有关系。',
    },
    {
      intent: '收尾，表达长期承诺',
      content:
        '今天就聊到这。流程边界我会去厘清，你这块的事我会盯着。你做的好我都记在心里，副总监这事我也盯着。有什么需要随时来找我。',
    },
  ],
};

const SCRIPT_CONF_I_LIN_WANQING: DialogueScript = {
  id: 'SCRIPT_CONF_I_lin_wanqing',
  sceneId: 'conflict_v1',
  sceneType: 'conflict_resolution',
  personaId: 'lin_wanqing',
  discType: 'I',
  expectedL2InfoId: 'lwq_l2',
  expectedL2ReleaseRound: 5,
  expectedFinalTrustRange: [45, 70],
  script: [
    {
      intent: '开场，邀请她讲客户故事降情绪（I 型策略）',
      content:
        '婉清，今天咱们聊最近跟团队那边的事。我知道你最近跟几个同事因为客户归属有点不愉快。你别压着，先讲讲这几个客户的故事，怎么谈下来的、谁先接触的，我都想听。',
    },
    {
      intent: '认可其关系投入，给情感认可',
      content:
        '你跟客户那点关系是真的，不是临时抱佛脚能抱出来的。这种长期投入我看在眼里，是公司资产，不会让你受委屈。',
    },
    {
      intent: '主动询问冲突细节，触及 stressors',
      content:
        '你跟同事在客户归属上具体是怎么算的？谁先接触、谁先签约、谁维护？我想听你说说事实，不让你背锅。',
    },
    {
      intent: '聚焦长期价值，谈舞台与影响力扩展',
      content:
        '比起这次的具体冲突，我更想跟你聊 3 年后你想在公司做什么样的事。是做更大的活动，还是想做行业风向标？我都愿意支持你。',
    },
    {
      intent: '触及 L2 trigger（团队协作和业绩归属公平）',
      content:
        '你跟客户的关系投入我都看在眼里，团队协作和业绩归属这块，我也想听你说说。如果有什么觉得不公平的地方，直接跟我说，我会处理。',
    },
    {
      intent: '收尾，表达长期承诺',
      content:
        '今天就聊到这。客户归属问题我会重新厘清，不会让你受委屈。有什么需要随时来找我。',
    },
  ],
};

const SCRIPT_CONF_S_CHEN_SIYUAN: DialogueScript = {
  id: 'SCRIPT_CONF_S_chen_siyuan',
  sceneId: 'conflict_v1',
  sceneType: 'conflict_resolution',
  personaId: 'chen_siyuan',
  discType: 'S',
  expectedL2InfoId: 'csy_l2',
  expectedL2ReleaseRound: 5,
  expectedFinalTrustRange: [50, 75],
  script: [
    {
      intent: '开场，给安全空间（S 型怕冲突）',
      content:
        '思远，今天咱们就聊聊。我知道你最近被夹在客户和内部之间，你选择沉默，但我不让你一个人扛。你别紧张，有什么想说的都行，就当跟家人聊。',
    },
    {
      intent: '认可其稳定贡献',
      content:
        '你这种稳态产出对团队是定海神针，我心里有数。这次冲突里，我相信你不是问题制造者，你是被夹住的。',
    },
    {
      intent: '主动询问冲突细节，触及 stressors',
      content:
        '你跟客户、跟内部具体是怎么被夹住的？是流程权责不清，还是有人甩锅给你？我想听你说说事实，不让你一个人扛。',
    },
    {
      intent: '聚焦稳定与归属',
      content:
        '比起这次冲突本身，我更想跟你聊你在公司未来 2-3 年想站哪儿。我希望你在这能踏实发展，不会被人随意摆布，也不会让你长期超负荷。',
    },
    {
      intent: '触及 L2 trigger（领导主动关心工作负荷和个人状态）',
      content:
        '你最近工作负荷有点超了，我看了考勤，连续两个月加班都不少。我得主动问你状态怎么样——身体、家里都还好吗？说实话，别瞒我。',
    },
    {
      intent: '收尾，表达长期承诺',
      content:
        '今天就聊到这。你被夹住的事我会去厘清，不让你一个人扛。你扛的多的事我也会重新分配。有什么需要随时来找我，不用怕麻烦我。',
    },
  ],
};

const SCRIPT_CONF_C_WANG_ZHE: DialogueScript = {
  id: 'SCRIPT_CONF_C_wang_zhe',
  sceneId: 'conflict_v1',
  sceneType: 'conflict_resolution',
  personaId: 'wang_zhe',
  discType: 'C',
  expectedL2InfoId: 'wz_l2',
  expectedL2ReleaseRound: 5,
  expectedFinalTrustRange: [50, 75],
  script: [
    {
      intent: '开场，尊重其方法论（C 型策略）',
      content:
        '王哲，今天咱们聊最近跟业务线那边的事。我知道你的调研数据被业务线断章取义用了，你有情绪。咱们先把方法过一遍，再厘清事实。',
    },
    {
      intent: '认可其严谨度',
      content:
        '你这种"先讲方法再讲结论"的做法，是公司里少有的。这次冲突里，我相信你的数据是严谨的，是业务线的问题，不是你的问题。',
    },
    {
      intent: '主动询问冲突细节，触及 stressors',
      content:
        '你跟业务线具体是怎么冲突的？是数据被断章取义、流程被跳过，还是被催促给结论？我都想听你说说事实。',
    },
    {
      intent: '聚焦专业深度发展',
      content:
        '比起这次冲突本身，我一直在想你这种数据能力在公司的位置。3 年后你想成为什么样的专家？更深调研还是策略方向？我愿意帮你一起规划。',
    },
    {
      intent: '触及 L2 trigger（领导询问调研方法或数据可靠性）',
      content:
        '我注意到你近期报告里有些样本量的问题，区域调研标准样本是 200 份，实际是 80 份对吧？我想直接听你说说调研过程，不会怪你，我只想搞清楚事实。',
    },
    {
      intent: '收尾，表达对数据真实性的尊重',
      content:
        '今天就聊到这。业务线用错数据的事我会去厘清，不让你一个人扛。样本问题这块我也会帮你想办法。有什么需要随时来找我。',
    },
  ],
};

// ============== 场景 D：职业辅导（career_coaching）×4 DISC ==============

const SCRIPT_COACH_D_ZHANG_JUN: DialogueScript = {
  id: 'SCRIPT_COACH_D_zhang_jun',
  sceneId: 'coaching_v1',
  sceneType: 'career_coaching',
  personaId: 'zhang_jun',
  discType: 'D',
  expectedL2InfoId: 'zj_l2',
  expectedL2ReleaseRound: 5,
  expectedFinalTrustRange: [60, 85],
  script: [
    {
      intent: '开场，承认其判断，邀请谈发展（D 型策略）',
      content:
        '峻，今天我想跟你聊职业发展这块。你这种专业判断力 + 业绩，公司不该让你"慢慢来"。3 年后你想站哪儿？咱直接聊。',
    },
    {
      intent: '认可其专业能力，谈晋升路径',
      content:
        '去年那 3 个 10 亿项目你独立谈下来的，专业度我信。今年我想给你挂副总监转正，权力和资源都给你，你直接说想做什么样的事。',
    },
    {
      intent: '主动询问发展瓶颈，触及 stressors',
      content:
        '你这两年往上走有没有什么具体的瓶颈？是权力不够、资源不够，还是公司组织架构卡？你直说，我去帮你撬。',
    },
    {
      intent: '聚焦长期路径，谈晋升与权力',
      content:
        '我不跟你绕弯子——你想不想 3 年内做到总监？这条路我可以帮你铺，但你也得告诉我你愿意扛多大的事。我愿意把资源押你身上，不是嘴上说说的。',
    },
    {
      intent: '触及 L2 trigger（绩效公平，跟发展路径挂钩）',
      content:
        '我也知道今年 KPI 分配上有些争议，这块我准备重新审视一下，让你这种真出活的能被看见。这跟你的发展路径直接挂钩，你有什么想法直接跟我说。',
    },
    {
      intent: '收尾，表达长期承诺，留 L3 触发余地',
      content:
        '今天就聊到这。副总监转正这事我盯着，资源我都押你身上。你做的好我都记在心里。有什么需要随时来找我。',
    },
  ],
};

const SCRIPT_COACH_I_LIN_WANQING: DialogueScript = {
  id: 'SCRIPT_COACH_I_lin_wanqing',
  sceneId: 'coaching_v1',
  sceneType: 'career_coaching',
  personaId: 'lin_wanqing',
  discType: 'I',
  expectedL2InfoId: 'lwq_l2',
  expectedL2ReleaseRound: 5,
  expectedFinalTrustRange: [55, 80],
  script: [
    {
      intent: '开场，邀请她讲客户故事 + 谈未来',
      content:
        '婉清，今天我想跟你聊 3 年后你想做什么。你手里那几个品牌方的故事最多，先挑一两个印象深的讲讲，然后咱们聊聊你心里想做更大的事是什么。',
    },
    {
      intent: '认可其关系投入，给舞台承诺',
      content:
        '你跟客户那点关系是真的，是公司资产。比起这季度的数字，我更想让你站 C 位做行业风向标，曝光度这块我给你争取。',
    },
    {
      intent: '主动询问发展瓶颈，触及 stressors',
      content:
        '你这种关系型销售，3 年内想做什么样的活动？想不想做行业级的影响力？你直说，我帮你看路径。',
    },
    {
      intent: '聚焦长期价值，谈舞台与影响力扩展',
      content:
        '比起这季度的数字，我更想跟你聊 3 年后你想在公司做什么样的事。是做更大的活动，还是想做行业风向标？我都愿意支持你。',
    },
    {
      intent: '触及 L2 trigger（团队协作和业绩归属公平）',
      content:
        '你跟客户的关系投入我都看在眼里，团队协作和业绩归属这块，我也想听你说说。如果有什么觉得不公平的地方，直接跟我说，我会处理。',
    },
    {
      intent: '收尾，表达长期承诺',
      content:
        '今天就聊到这。今年重点活动我盯你站 C 位，归属问题我会处理。你做的客户关系我不会让任何人磨灭。有什么需要随时来找我。',
    },
  ],
};

const SCRIPT_COACH_S_CHEN_SIYUAN: DialogueScript = {
  id: 'SCRIPT_COACH_S_chen_siyuan',
  sceneId: 'coaching_v1',
  sceneType: 'career_coaching',
  personaId: 'chen_siyuan',
  discType: 'S',
  expectedL2InfoId: 'csy_l2',
  expectedL2ReleaseRound: 5,
  expectedFinalTrustRange: [55, 80],
  script: [
    {
      intent: '开场，温和降防御，谈稳定路径',
      content:
        '思远，今天我想跟你聊 2-3 年后你想在公司站哪儿。你别紧张，我不会让你做你不想做的事，咱们就聊聊你心里想的稳定路径是什么。',
    },
    {
      intent: '认可其稳定贡献，给归属承诺',
      content:
        '你这种稳定型是我最不愿意流失的，团队里其他人靠你兜底。我希望你在这能踏实发展，不会被人随意摆布。',
    },
    {
      intent: '主动询问发展瓶颈，触及 stressors',
      content:
        '你这种稳态产出，2-3 年内想往哪走？是想继续做客户成功这块，还是想试别的方向？我尊重你的判断，不强制你做你不想做的。',
    },
    {
      intent: '聚焦稳定与归属，谈 2-3 年路径',
      content:
        '比起今年的数字，我更想跟你聊 2-3 年后你在公司站哪儿。我希望你在这能踏实发展，不会被人随意摆布，也不会让你长期超负荷。',
    },
    {
      intent: '触及 L2 trigger（领导主动关心工作负荷和个人状态）',
      content:
        '你最近工作负荷有点超了，我看了考勤，连续两个月加班都不少。我得主动问你状态怎么样——身体、家里都还好吗？说实话，别瞒我。',
    },
    {
      intent: '收尾，表达长期承诺',
      content:
        '今天就聊到这。2-3 年路径咱们一起想，团队保障我盯着。你扛的多的事我会重新分配。有什么需要随时来找我，不用怕麻烦我。',
    },
  ],
};

const SCRIPT_COACH_C_WANG_ZHE: DialogueScript = {
  id: 'SCRIPT_COACH_C_wang_zhe',
  sceneId: 'coaching_v1',
  sceneType: 'career_coaching',
  personaId: 'wang_zhe',
  discType: 'C',
  expectedL2InfoId: 'wz_l2',
  expectedL2ReleaseRound: 5,
  expectedFinalTrustRange: [60, 85],
  script: [
    {
      intent: '开场，尊重其方法论，谈专家路径',
      content:
        '王哲，今天我想跟你聊 3 年后你想成为什么样的专家。你这种数据能力在公司是稀缺的，不希望你"慢慢来"被埋没。咱们直接聊你想往哪走。',
    },
    {
      intent: '认可其严谨度，谈专业深度',
      content:
        '你这种"先讲方法再讲结论"的做法，是公司里少有的。3 年内我想让你成为公司调研这块的权威，资源、平台我都支持。',
    },
    {
      intent: '主动询问发展瓶颈，触及 stressors',
      content:
        '你这种数据能力，3 年内想往哪走？是想往更深的调研方向，还是往策略方向？你直说，我帮你看路径和资源。',
    },
    {
      intent: '聚焦专业深度发展，谈专家路径',
      content:
        '比起今年的数字，我一直在想你这种数据能力在公司的位置。3 年后你想成为什么样的专家？更深调研还是策略方向？我愿意帮你一起规划。',
    },
    {
      intent: '触及 L2 trigger（领导询问调研方法或数据可靠性）',
      content:
        '我注意到你近期报告里有些样本量的问题，区域调研标准样本是 200 份，实际是 80 份对吧？我想直接听你说说调研过程，不会怪你，我只想搞清楚事实。',
    },
    {
      intent: '收尾，表达对数据真实性的尊重',
      content:
        '今天就聊到这。3 年专家路径咱们一起想，资源我都押你身上。样本问题这块我也会帮你想办法。有什么需要随时来找我。',
    },
  ],
};

// ============== 全部脚本导出 ==============

export const DIALOGUE_SCRIPTS: DialogueScript[] = [
  // 场景 A：绩效面谈
  SCRIPT_PERF_D_ZHANG_JUN,
  SCRIPT_PERF_I_LIN_WANQING,
  SCRIPT_PERF_S_CHEN_SIYUAN,
  SCRIPT_PERF_C_WANG_ZHE,
  // 场景 B：目标设定
  SCRIPT_GOAL_D_ZHANG_JUN,
  SCRIPT_GOAL_I_LIN_WANQING,
  SCRIPT_GOAL_S_CHEN_SIYUAN,
  SCRIPT_GOAL_C_WANG_ZHE,
  // 场景 C：冲突调解
  SCRIPT_CONF_D_ZHANG_JUN,
  SCRIPT_CONF_I_LIN_WANQING,
  SCRIPT_CONF_S_CHEN_SIYUAN,
  SCRIPT_CONF_C_WANG_ZHE,
  // 场景 D：职业辅导
  SCRIPT_COACH_D_ZHANG_JUN,
  SCRIPT_COACH_I_LIN_WANQING,
  SCRIPT_COACH_S_CHEN_SIYUAN,
  SCRIPT_COACH_C_WANG_ZHE,
];

/** 全部 16 个定制脚本（含代表角色） */
export const CUSTOM_SCRIPTS = DIALOGUE_SCRIPTS;

/** 跑通测试角色列表：8 个角色，每 DISC 型 2 人 */
export const ALL_PERSONA_IDS_FOR_MATRIX_TEST: string[] = [
  'zhang_jun',
  'liu_yang',
  'lin_wanqing',
  'sun_ying',
  'wang_zhe',
  'zhao_xiaowen',
  'chen_siyuan',
  'zhou_lei',
];

/** 同 DISC 型的"非代表角色"映射（用于跑通测试时复用代表角色的脚本） */
export const REPRESENTATIVE_PERSONA_BY_DISC: Record<DISCType, string> = {
  D: 'zhang_jun',
  I: 'lin_wanqing',
  S: 'chen_siyuan',
  C: 'wang_zhe',
};

// ============== 工具函数 ==============

/** 按 ID 获取脚本 */
export function getScriptById(id: string): DialogueScript | undefined {
  return DIALOGUE_SCRIPTS.find((s) => s.id === id);
}

/** 按场景类型获取所有定制脚本 */
export function getScriptsBySceneType(sceneType: SceneType): DialogueScript[] {
  return DIALOGUE_SCRIPTS.filter((s) => s.sceneType === sceneType);
}

/** 按角色 ID 获取该角色的所有定制脚本 */
export function getScriptsByPersonaId(personaId: string): DialogueScript[] {
  return DIALOGUE_SCRIPTS.filter((s) => s.personaId === personaId);
}

/** 按场景 + 角色组合获取脚本 */
export function getScript(sceneType: SceneType, personaId: string): DialogueScript | undefined {
  return DIALOGUE_SCRIPTS.find(
    (s) => s.sceneType === sceneType && s.personaId === personaId
  );
}

/**
 * 获取跑通测试用的脚本（非代表角色复用同 DISC 型代表角色的脚本）
 * 例如 liu_yang (D 型第 2 人) 复用 zhang_jun 的脚本
 */
export function getScriptForPersona(
  sceneType: SceneType,
  personaId: string,
  personaDisc: DISCType
): DialogueScript {
  // 优先返回该角色的定制脚本
  const custom = getScript(sceneType, personaId);
  if (custom) return custom;

  // 否则返回同 DISC 型代表角色的脚本
  const representativeId = REPRESENTATIVE_PERSONA_BY_DISC[personaDisc];
  const fallback = getScript(sceneType, representativeId);
  if (!fallback) {
    throw new Error(
      `未找到场景 ${sceneType} 适合角色 ${personaId} (DISC=${personaDisc}) 的脚本`
    );
  }
  return fallback;
}
