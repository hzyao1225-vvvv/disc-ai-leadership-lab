/**
 * 员工状态机
 * 负责状态更新、隐藏信息释放的合法性校验
 */

import type {
  EmployeeState,
  LLMResponse,
  Persona,
  HiddenInfo,
  Scene,
  SceneType,
} from './types.js';

/**
 * 各场景的初始状态差异化基线
 * - performance_review: 防御中等（PoC 基线，保留）
 * - goal_setting: 员工较愿意谈未来，resistance 略低
 * - conflict_resolution: 员工处于冲突情绪中，trust 低、resistance 高
 * - career_coaching: 员工主动寻求辅导，trust/acceptance 较高
 */
const SCENE_INITIAL_STATE: Record<SceneType, Partial<EmployeeState>> = {
  performance_review:   { trust: 30, acceptance: 40, resistance: 35, disclosure: 1 },
  goal_setting:         { trust: 35, acceptance: 45, resistance: 25, disclosure: 1 },
  conflict_resolution:  { trust: 20, acceptance: 30, resistance: 55, disclosure: 1 },
  career_coaching:      { trust: 40, acceptance: 50, resistance: 20, disclosure: 1 },
};

/** 默认初始状态（scene 缺省或类型未知时使用） */
const DEFAULT_INITIAL_STATE: Partial<EmployeeState> = {
  trust: 30,
  acceptance: 40,
  resistance: 35,
  recognition: 30,
  attritionRisk: 40,
  disclosure: 1,
};

/**
 * 创建初始状态
 * 合并优先级：默认基线 < 场景基线 < 人设覆盖（persona.initialState）
 */
export function createInitialState(scene?: Scene, persona?: Persona): EmployeeState {
  const base =
    scene && scene.type
      ? SCENE_INITIAL_STATE[scene.type] ?? DEFAULT_INITIAL_STATE
      : DEFAULT_INITIAL_STATE;
  const personaOverride = persona?.initialState ?? {};

  return {
    emotion: scene?.initialEmotion ?? 'neutral',
    trust: personaOverride.trust ?? base.trust ?? 30,
    acceptance: personaOverride.acceptance ?? base.acceptance ?? 40,
    resistance: personaOverride.resistance ?? base.resistance ?? 35,
    recognition: personaOverride.recognition ?? base.recognition ?? 30,
    attritionRisk: personaOverride.attritionRisk ?? base.attritionRisk ?? 40,
    disclosure: personaOverride.disclosure ?? base.disclosure ?? 1,
    revealedInfoIds: [],
    behaviorTags: [],
    round: 0,
  };
}

/** 数值夹取到 [0, 100] */
function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * 校验 LLM 尝试释放的隐藏信息是否合规
 * 规则：当前 trust 必须 >= 该信息条的 trustThreshold
 *       且 disclosure 必须 >= 该信息条的 layer
 */
export function validateHiddenReveal(
  info: HiddenInfo,
  state: EmployeeState
): { valid: boolean; reason?: string } {
  if (state.trust < info.trustThreshold) {
    return {
      valid: false,
      reason: `trust 不足 (${state.trust} < ${info.trustThreshold})，无法释放 L${info.layer} 信息`,
    };
  }
  if (state.disclosure < info.layer) {
    return {
      valid: false,
      reason: `disclosure 层级不足 (${state.disclosure} < L${info.layer})`,
    };
  }
  return { valid: true };
}

/**
 * 应用 LLM 响应的状态增量，并尝试释放隐藏信息
 * 返回更新后的状态 + 实际被释放的隐藏信息
 */
export function applyLLMResponse(
  prevState: EmployeeState,
  persona: Persona,
  llmResponse: LLMResponse
): {
  newState: EmployeeState;
  newlyRevealed: HiddenInfo[];
  rejectedReveals: { id: string; reason: string }[];
} {
  // 1. 应用状态增量（每项 -3 ~ +3，×5 落盘）
  const delta = llmResponse.state_delta;
  const trustAfter = clamp(prevState.trust + (delta.trust ?? 0) * 5);
  const acceptanceAfter = clamp(prevState.acceptance + (delta.acceptance ?? 0) * 5);
  const resistanceAfter = clamp(prevState.resistance + (delta.resistance ?? 0) * 5);
  const recognitionAfter = clamp(
    prevState.recognition + (delta.recognition ?? 0) * 5
  );
  const attritionRiskAfter = clamp(
    prevState.attritionRisk + (delta.attritionRisk ?? 0) * 5
  );
  const disclosureAfter = clamp(prevState.disclosure + (delta.disclosure ?? 0), 1, 3);

  const intermediateState: EmployeeState = {
    ...prevState,
    emotion: llmResponse.emotion ?? prevState.emotion,
    trust: trustAfter,
    acceptance: acceptanceAfter,
    resistance: resistanceAfter,
    recognition: recognitionAfter,
    attritionRisk: attritionRiskAfter,
    disclosure: disclosureAfter,
    behaviorTags: llmResponse.behavior_tags ?? prevState.behaviorTags,
    round: prevState.round + 1,
  };

  // 2. 处理 LLM 主动声明要释放的隐藏信息
  const newlyRevealed: HiddenInfo[] = [];
  const rejectedReveals: { id: string; reason: string }[] = [];
  const alreadyRevealed = new Set(prevState.revealedInfoIds);

  for (const infoId of llmResponse.hidden_revealed ?? []) {
    const info = persona.hiddenInfo.find((h) => h.id === infoId);
    if (!info) {
      rejectedReveals.push({
        id: infoId,
        reason: `未找到 ID 为 ${infoId} 的隐藏信息`,
      });
      continue;
    }
    if (alreadyRevealed.has(infoId)) {
      // 已经释放过，跳过（不算违规）
      continue;
    }
    const check = validateHiddenReveal(info, intermediateState);
    if (check.valid) {
      newlyRevealed.push(info);
      alreadyRevealed.add(infoId);
    } else {
      rejectedReveals.push({ id: infoId, reason: check.reason ?? '未知' });
    }
  }

  // 3. 自动安全网：检查是否有满足阈值但 LLM 没主动释放的信息
  // （只在 trust 充分时才触发，避免 LLM 不主动导致卡壳）
  for (const info of persona.hiddenInfo) {
    if (alreadyRevealed.has(info.id)) continue;
    if (
      intermediateState.trust >= info.trustThreshold &&
      intermediateState.disclosure >= info.layer &&
      // 给 LLM 一些主动权：trust 超阈值 20+ 才自动补
      intermediateState.trust >= info.trustThreshold + 20
    ) {
      newlyRevealed.push(info);
      alreadyRevealed.add(info.id);
    }
  }

  // 4. 写回最终状态
  const newState: EmployeeState = {
    ...intermediateState,
    revealedInfoIds: Array.from(alreadyRevealed),
  };

  return { newState, newlyRevealed, rejectedReveals };
}

/** 状态摘要（用于日志/报告） */
export function stateSummary(state: EmployeeState): string {
  return (
    `[round ${state.round}] ` +
    `emotion=${state.emotion} ` +
    `trust=${state.trust} ` +
    `accept=${state.acceptance} ` +
    `defense=${state.resistance} ` +
    `recognition=${state.recognition} ` +
    `attritionRisk=${state.attritionRisk} ` +
    `disclosure=L${state.disclosure} ` +
    `revealed=${state.revealedInfoIds.length}`
  );
}
