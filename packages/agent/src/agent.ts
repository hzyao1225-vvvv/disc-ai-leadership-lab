/**
 * EmployeeAgent 主类
 * 整合 persona + scene + state-machine + llm-gateway + prompt-builder
 */

import type {
  Persona,
  Scene,
  EmployeeState,
  AgentResponse,
  AgentConfig,
  LLMResponse,
  DialogueTurn,
  HiddenInfo,
  SessionContext,
} from './types.js';
import { LLMGateway, type ChatMessage } from './llm-gateway.js';
import {
  createInitialState,
  applyLLMResponse,
  stateSummary,
} from './state-machine.js';
import {
  buildSystemPrompt,
  buildUserPrompt,
  extractJSON,
} from './prompt-builder.js';

export class EmployeeAgent {
  private persona: Persona;
  private scene: Scene;
  private state: EmployeeState;
  private history: DialogueTurn[] = [];
  private llm: LLMGateway;
  private round: number = 0;
  private debugPrompt: boolean;
  private debugResponse: boolean;
  private sessionContext?: SessionContext;

  constructor(persona: Persona, scene: Scene, config: AgentConfig) {
    this.persona = persona;
    this.scene = scene;
    this.state = createInitialState(scene, persona);
    this.llm = new LLMGateway(config.llm);
    this.debugPrompt = config.debugPrompt ?? false;
    this.debugResponse = config.debugResponse ?? false;
    this.sessionContext = config.sessionContext;
  }

  /** 当前状态快照（只读） */
  getState(): Readonly<EmployeeState> {
    return { ...this.state };
  }

  /** 当前对话历史（只读） */
  getHistory(): Readonly<DialogueTurn>[] {
    return [...this.history];
  }

  /**
   * 主入口：领导发言 → 员工响应
   */
  async respond(leaderMessage: string): Promise<AgentResponse> {
    this.round++;
    const stateBefore = { ...this.state };

    // 1. 构造 prompt
    const systemPrompt = buildSystemPrompt(
      this.persona,
      this.scene,
      this.state,
      this.sessionContext
    );
    const userPrompt = buildUserPrompt(leaderMessage, this.round);

    if (this.debugPrompt) {
      console.log('--- SYSTEM PROMPT ---');
      console.log(systemPrompt);
      console.log('--- USER PROMPT ---');
      console.log(userPrompt);
    }

    // 2. 构造历史上下文（保留最近 6 轮，避免 token 膨胀）
    const historyMessages: ChatMessage[] = this.history
      .slice(-12)
      .map((turn) => ({
        role: (turn.role === 'leader' ? 'user' : 'assistant') as ChatMessage['role'],
        content: turn.content,
      }));

    // 3. 调用 LLM
    const rawOutput = await this.llm.chatWithHistory(
      systemPrompt,
      userPrompt,
      historyMessages
    );

    if (this.debugResponse) {
      console.log('--- RAW LLM OUTPUT ---');
      console.log(rawOutput);
    }

    // 4. 解析 JSON
    const jsonStr = extractJSON(rawOutput);
    let llmResponse: LLMResponse;
    try {
      llmResponse = JSON.parse(jsonStr) as LLMResponse;
    } catch (err) {
      throw new Error(
        `LLM 输出 JSON 解析失败: ${(err as Error).message}\n原始输出:\n${rawOutput}`
      );
    }

    // 5. 应用状态增量 + 处理隐藏信息释放
    const { newState, newlyRevealed, rejectedReveals } = applyLLMResponse(
      this.state,
      this.persona,
      llmResponse
    );

    if (rejectedReveals.length > 0) {
      console.warn(
        `[state-machine] 以下隐藏信息释放被拒绝:`,
        rejectedReveals
      );
    }

    // 6. 更新历史
    this.history.push({
      round: this.round,
      role: 'leader',
      content: leaderMessage,
      timestamp: Date.now(),
    });
    this.history.push({
      round: this.round,
      role: 'employee',
      content: llmResponse.reply,
      internalThought: llmResponse.internal_thought,
      timestamp: Date.now(),
    });

    // 7. 更新状态
    this.state = newState;

    // 8. 组装响应
    const response: AgentResponse = {
      reply: llmResponse.reply,
      emotion: llmResponse.emotion,
      stateBefore,
      stateAfter: { ...newState },
      hiddenRevealed: newlyRevealed,
      internalThought: llmResponse.internal_thought,
      behaviorTags: llmResponse.behavior_tags ?? [],
      round: this.round,
      rawLLMOutput: this.debugResponse ? rawOutput : undefined,
    };

    console.log(
      `[${this.persona.name} · ${this.persona.disc}型] ${stateSummary(this.state)}`
    );

    return response;
  }

  /** 重置 Agent 状态 */
  reset(): void {
    this.state = createInitialState(this.scene);
    this.history = [];
    this.round = 0;
  }
}

/** 工具：获取 persona 的全部隐藏信息 ID */
export function getHiddenInfoIds(persona: Persona): string[] {
  return persona.hiddenInfo.map((h) => h.id);
}

/** 工具：根据 ID 列表获取 HiddenInfo 对象 */
export function getHiddenInfoByIds(
  persona: Persona,
  ids: string[]
): HiddenInfo[] {
  return persona.hiddenInfo.filter((h) => ids.includes(h.id));
}

// ============== 评价器导出（供 voice-server 等外部使用） ==============
export { SessionEvaluator } from './evaluator.js';
export type {
  SessionContext,
  EvaluationResult,
  EvaluationCriteria,
  ScoreDimension,
  ReportSection,
  PersonaStage,
  VariableRule,
  PersonaInitialState,
  // 同时导出核心类型，方便外部（如 voice-server）import 而不绕到 ./types 子路径
  Persona,
  Scene,
  EmployeeState,
  DialogueTurn,
  AgentConfig,
  LLMConfig,
  LLMResponse,
  AgentResponse,
  HiddenInfo,
  HiddenLayer,
  DISCType,
  DISCTrait,
  VoiceProfile,
  SceneType,
} from './types.js';
