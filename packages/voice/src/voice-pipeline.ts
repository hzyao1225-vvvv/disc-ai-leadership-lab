/**
 * voice-pipeline.ts —— 核心编排：ASR 句末 → EmployeeAgent.respond → TTS 流式
 *
 * 一轮生命周期（语音模式）：
 *   ASR.onSentenceEnd(text) × N   [一次发言的多句先进 utteranceBuffer，不触发回复]
 *   endVoiceSession()（VAD 发言结束 → audio-end）
 *     → ASR.finish() → 合并缓冲多句为一条文本
 *     → pipeline.handleUserText(merged)   [一次发言 → 一次回复，有问有答]
 *       → agent.respond(text)           [防并发：busy 时入队，drain 时合并为一轮]
 *       → cb.onReply(reply, emotion, round)   [推文本给前端]
 *       → splitSentences(reply)              [按中文标点切句]
 *       → for each sentence: ttsClient.synthesize(sentence, voiceId, cb.onAudioChunk)
 *       → cb.onAudioEnd()
 *
 * 降级：
 *   - agent.respond 抛错 → 状态机 tts-failed → voice-degraded + onReply 仅文本（不送 TTS）
 *   - TTS synthesize 抛错 → 状态机 tts-failed → voice-degraded + onAudioEnd + onModeChange
 *
 * 防并发：一轮 busy=true 期间，新的 handleUserText 入队，当前轮结束后串行处理。
 */

import type { VoiceModeState } from './types.js';
import { VoiceModeStateMachine } from './degradation.js';
import type { ParaformerASRClient } from './dashscope-asr.js';
import type { CosyVoiceTTSClient } from './dashscope-tts.js';

// ============== Agent 兼容接口（结构子集，EmployeeAgent 兼容） ==============

export interface AgentResponseSubset {
  reply: string;
  emotion: string;
  round: number;
}

export interface AgentLike {
  respond(text: string): Promise<AgentResponseSubset>;
}

// ============== 依赖与回调 ==============

export interface VoicePipelineDeps {
  asrClient: ParaformerASRClient;
  ttsClient: CosyVoiceTTSClient;
  agent: AgentLike;
  /** 当前角色 voiceId（由 VoiceProfileMapper.getVoiceId 提供） */
  voiceId: string;
}

export interface VoicePipelineCallbacks {
  /** ASR 增量文本（前端显示 partial） */
  onAsrPartial?: (text: string) => void;
  /** agent reply 文本（前端显示对话气泡 + 降级时唯一输出） */
  onReply: (text: string, emotion: string, round: number) => void;
  /** TTS 音频分块（前端 PCM 播放） */
  onAudioChunk: (pcm: ArrayBuffer) => void;
  /** 一轮音频结束（前端停止播放动画） */
  onAudioEnd: () => void;
  /** 模式变更（降级提示） */
  onModeChange: (mode: VoiceModeState, reason: string) => void;
  /** 错误上报 */
  onError: (err: Error) => void;
}

// ============== Pipeline ==============

export class VoicePipeline {
  private busy = false;
  /** busy 期间到达的文本排队，当前轮结束后合并为一轮处理 */
  private pendingTexts: string[] = [];
  /** 一次发言的 ASR 分句缓冲：onSentenceEnd 只累积不回复，endVoiceSession 时合并为一轮 */
  private utteranceBuffer: string[] = [];
  private readonly stateMachine = new VoiceModeStateMachine();

  constructor(
    private readonly deps: VoicePipelineDeps,
    private readonly cb: VoicePipelineCallbacks
  ) {}

  getMode(): VoiceModeState {
    return this.stateMachine.getState();
  }

  /** ASR 会话是否活跃（可接收音频帧） */
  isAsrActive(): boolean {
    return this.deps.asrClient.isActive();
  }

  isBusy(): boolean {
    return this.busy;
  }

  /**
   * 开始语音会话：ASR.start，把 onSentenceEnd 接到 handleUserText。
   * 返回 start 是否成功（失败由 onError 上报）。
   */
  async startVoiceSession(): Promise<boolean> {
    try {
      await this.deps.asrClient.start({
        onText: (partial) => this.cb.onAsrPartial?.(partial),
        onSentenceEnd: (sentence) => {
          // 一次发言可能含多句：只累积进缓冲，等 audio-end（endVoiceSession）合并为一轮回复，
          // 避免一句一答导致 AI 连续自答多条。
          const t = sentence.trim();
          if (t) this.utteranceBuffer.push(t);
        },
      });
      return true;
    } catch (err) {
      this.cb.onError(err as Error);
      // ASR 启动失败 → asr-failed 计数（由外部决定是否继续）
      const t = this.stateMachine.transition({ kind: 'asr-failed', message: (err as Error).message });
      if (t) this.cb.onModeChange(t.to, t.reason);
      return false;
    }
  }

  /** 推音频帧给 ASR */
  sendAudio(samples: Int16Array): void {
    this.deps.asrClient.sendAudioChunk(samples);
  }

  /**
   * 结束语音会话：ASR.finish，然后把本次发言累积的多句合并为一轮回复。
   * finish 失败也必须 flush——否则已识别的分句被静默丢弃，前端会一直"监听中"无响应。
   * @param opts.flush 默认 true；ws 连接关闭等场景传 false 跳过回复（避免死连接浪费 LLM 调用）
   */
  async endVoiceSession(opts?: { flush?: boolean }): Promise<void> {
    try {
      await this.deps.asrClient.finish();
      console.log('[pipeline] ASR finish 完成');
    } catch (err) {
      console.warn(`[pipeline] ASR finish 异常（仍尝试 flush 缓冲）: ${(err as Error).message}`);
    }
    if (opts?.flush === false) {
      this.utteranceBuffer = [];
      return;
    }
    this.flushUtterance();
  }

  /** 把本次发言的多句合并为一条文本触发一轮回复（fire-and-forget） */
  private flushUtterance(): void {
    const count = this.utteranceBuffer.length;
    if (count === 0) {
      // 说话了但 ASR 一句都没识别出（太短/太轻/音频未送达）：不能沉默，否则用户以为卡死
      console.warn('[pipeline] 发言结束但 ASR 无识别结果（buffer 为空）');
      this.cb.onError(new Error('没有识别到说话内容，请再靠近麦克风说一次'));
      return;
    }
    // ASR 分句文本通常自带句末标点，直接拼接即可
    const merged = this.utteranceBuffer.join('');
    this.utteranceBuffer = [];
    console.log(`[pipeline] 发言结束：合并 ${count} 句（${merged.length} 字）触发一轮回复`);
    void this.handleUserText(merged);
  }

  /**
   * 核心编排：处理一句用户文本（ASR 句末 / 文字模式输入）。
   * busy 期间到达的文本入队，当前轮结束后自动串行处理。
   * 同步设置 busy=true 后 fire 异步编排，保证竞态时第二调用必定入队。
   */
  async handleUserText(text: string): Promise<boolean> {
    const trimmed = text.trim();
    if (!trimmed) return true;
    if (this.busy) {
      this.pendingTexts.push(trimmed);
      console.log(`[pipeline] busy 中，排队文本: "${trimmed.slice(0, 40)}..." (队列=${this.pendingTexts.length})`);
      return true;
    }
    this.busy = true; // 同步设置，保证竞态时第二次 handleUserText 必进上一个 if
    await this.runAgentAndTtsWithDrain(trimmed);
    return true;
  }

  /** 执行 agent+Tts，finally 中 drain 排队文本，最后才 busy=false */
  private async runAgentAndTtsWithDrain(text: string): Promise<void> {
    try {
      await this.runAgentAndTts(text);
    } finally {
      // drain 时把排队文本合并为一轮：busy 期间到达的多条（分句/连发）只回一次
      while (this.pendingTexts.length > 0) {
        const merged = this.pendingTexts.join('\n');
        this.pendingTexts = [];
        if (merged.trim()) await this.runAgentAndTts(merged.trim());
      }
      this.busy = false;
    }
  }

  /** agent + TTS 执行体（抽出便于 finally 后的串行循环复用） */
  private async runAgentAndTts(trimmed: string): Promise<void> {
    // 1. 调 agent
    let response: AgentResponseSubset;
    try {
      response = await this.deps.agent.respond(trimmed);
    } catch (err) {
      const t = this.stateMachine.transition({
        kind: 'tts-failed',
        message: `agent.respond: ${(err as Error).message}`,
      });
      if (t) this.cb.onModeChange(t.to, t.reason);
      this.cb.onError(err as Error);
      return;
    }

    // 2. 推 reply 文本
    this.cb.onReply(response.reply, response.emotion, response.round);

    // 3. 切句送 TTS
    const sentences = splitSentences(response.reply);
    let totalBytes = 0;
    try {
      for (const sentence of sentences) {
        await this.deps.ttsClient.synthesize(
          sentence,
          this.deps.voiceId,
          (pcm) => {
            totalBytes += pcm.byteLength;
            this.cb.onAudioChunk(pcm);
          }
        );
      }
    } catch (err) {
      const t = this.stateMachine.transition({
        kind: 'tts-failed',
        message: `tts.synthesize: ${(err as Error).message}`,
      });
      if (t) this.cb.onModeChange(t.to, t.reason);
      if (totalBytes > 0) this.cb.onAudioEnd();
      this.cb.onError(err as Error);
      return;
    }

    if (totalBytes > 0) this.cb.onAudioEnd();
  }
}

// ============== 句子切分 ==============

/**
 * 按中文句末标点（。？！；）切分 reply 文本，逐句送 TTS 以实现流式首包。
 * 保留标点在句尾。空文本返回空数组。
 */
export function splitSentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }
  // 匹配"非句末标点 + 可选句末标点"序列
  const parts = trimmed.match(/[^。？！；]+[。？！；]?/g);
  if (!parts) {
    return [trimmed];
  }
  return parts
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
