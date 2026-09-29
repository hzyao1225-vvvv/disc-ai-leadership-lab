/**
 * dashscope-asr —— Paraformer 流式语音识别
 *
 * 协议来源：百炼 Paraformer-realtime-v2 WebSocket 流式 ASR（maas 域名）。
 *   URL  : wss://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference
 *   鉴权 : 握手期 Authorization: Bearer <api_key> 头
 *   帧序 : run-task → (task-started) → 客户端发二进制音频帧 → result-generated(含 text) → finish-task → task-finished
 *   音频 : 16kHz PCM Int16，通过 WebSocket 二进制帧上行
 *   文本 : result-generated 文本帧含 payload.output.text（句子级累积，非递减）；
 *          payload.output.type='sentence-end' 标记一句完整结束。
 *
 * 可测试性：复用 dashscope-tts 的 TtsTransport 抽象（底层 ws 行为完全一致），
 * createTransport 可注入，asr-mock.test.ts 用假实现验证帧序与回调。
 */

import { randomUUID } from 'node:crypto';
// 复用 TTS 的 transport 抽象与默认实现（底层 ws 行为完全一致）
import {
  defaultCreateTransport,
  type TtsTransport,
  type TtsTransportHandlers,
} from './dashscope-tts.js';

// ASR 复用 TTS 的 transport 类型别名（结构相同，避免重复定义）
export type AsrTransport = TtsTransport;
export type AsrTransportHandlers = TtsTransportHandlers;

// ============== 类型错误 ==============

export class AsrError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'AsrError';
  }
}

// ============== 配置 ==============

export interface AsrClientConfig {
  apiKey: string;
  workspaceId: string;
  /** ASR 模型，如 paraformer-realtime-v2 */
  model: string;
  /** 采样率，默认 16000 */
  sampleRate?: number;
  /** 音频格式，默认 pcm */
  format?: 'pcm' | 'wav';
}

export interface AsrClientDeps {
  /** 注入 transport 工厂（测试用假实现）；默认用真实 defaultCreateTransport（异步 ws） */
  createTransport?: (
    url: string,
    headers: Record<string, string>
  ) => AsrTransport | Promise<AsrTransport>;
}

// ============== 回调 ==============

export interface AsrCallbacks {
  /**
   * 增量文本回调。Paraformer 流式返回句子级累积文本（非递减）：
   * 每次收到 result-generated.payload.output.text 即回调，后一次 text 应包含前一次全部内容。
   */
  onText: (partial: string) => void;
  /**
   * 一句完整结束回调。触发时机：
   *   1) result-generated.payload.output.type='sentence-end' 时
   *   2) task-finished 时若仍有未结句的尾文本，补发一次
   */
  onSentenceEnd: (sentence: string) => void;
}

// ============== 帧构造（导出便于测试断言） ==============

export function buildAsrRunTask(taskId: string, config: AsrClientConfig): string {
  return JSON.stringify({
    header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
    payload: {
      task_group: 'audio',
      task: 'asr',
      function: 'recognition',
      model: config.model,
      parameters: {
        sample_rate: config.sampleRate ?? 16000,
        format: config.format ?? 'pcm',
      },
      input: {},
    },
  });
}

export function buildAsrFinishTask(taskId: string): string {
  return JSON.stringify({
    header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
    payload: { input: {} },
  });
}

// ============== ASR 客户端 ==============

/**
 * 两段式生命周期：
 *   await client.start(callbacks)   // resolve 于 task-started（可开始推音频）
 *   client.sendAudioChunk(int16)    // 同步推二进制音频帧（可多次）
 *   await client.finish()           // 发 finish-task，resolve 于 task-finished
 */
export class ParaformerASRClient {
  private config: AsrClientConfig;
  private createTransport: (
    url: string,
    headers: Record<string, string>
  ) => AsrTransport | Promise<AsrTransport>;

  private transport: AsrTransport | null = null;
  private taskId: string | null = null;
  private started = false; // task-started 收到
  private finished = false; // task-finished 收到
  private callbacks: AsrCallbacks | null = null;
  private lastText = ''; // 最近一次 onText 的 partial，用于句末补发与"非递减"跟踪

  private startResolve: ((v: void) => void) | null = null;
  private startReject: ((e: Error) => void) | null = null;
  private finishResolve: ((v: void) => void) | null = null;
  private finishReject: ((e: Error) => void) | null = null;

  constructor(config: AsrClientConfig, deps?: AsrClientDeps) {
    this.config = config;
    this.createTransport = deps?.createTransport ?? defaultCreateTransport;
  }

  /** ASR 会话是否活跃（已 start 且未 finish，可接收音频帧） */
  isActive(): boolean {
    return this.transport !== null && this.started && !this.finished;
  }

  private endpoint(): string {
    return `wss://${this.config.workspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference`;
  }

  /**
   * 开始会话：建 WS → 发 run-task → 等 task-started。
   * Promise resolve 后可调 sendAudioChunk。
   * 允许多轮复用：若上一轮已 finish（finished=true），强制清理旧 transport 再建新的。
   */
  start(callbacks: AsrCallbacks): Promise<void> {
    if (this.transport && !this.finished) {
      return Promise.reject(
        new AsrError('会话已开始，请先 finish', 'SESSION_ALREADY_STARTED')
      );
    }
    // 上一轮已完成（finished=true）但 WS close 事件还没到——强制清理
    if (this.transport && this.finished) {
      try { this.transport.close(); } catch {}
      this.transport = null;
    }
    // 彻底重置所有会话状态，确保干净复用
    this.callbacks = null;
    this.taskId = null;
    this.started = false;
    this.finished = false;
    this.lastText = '';
    this.startResolve = null;
    this.startReject = null;
    this.finishResolve = null;
    this.finishReject = null;

    this.callbacks = callbacks;
    this.taskId = randomUUID();
    const taskId = this.taskId;

    return new Promise<void>(async (resolve, reject) => {
      this.startResolve = resolve;
      this.startReject = reject;

      let transport: AsrTransport;
      try {
        transport = await this.createTransport(this.endpoint(), {
          Authorization: `Bearer ${this.config.apiKey}`,
        });
      } catch (err) {
        this.startResolve = null;
        this.startReject = null;
        reject(new AsrError((err as Error).message, 'TRANSPORT_CREATE_FAILED'));
        return;
      }
      this.transport = transport;

      transport.setHandlers({
        onOpen: () => {
          // 发 run-task，等 task-started
          transport.send(buildAsrRunTask(taskId, this.config));
          // 5 秒 task-started 超时兜底
          const st = setTimeout(() => {
            console.warn('[ASR] task-started 超时，reject start()');
            try { this.transport?.close(); } catch {}
            this.transport = null;
            const sr = this.startReject;
            this.startResolve = null;
            this.startReject = null;
            sr?.(new AsrError('task-started 超时', 'START_TIMEOUT'));
          }, 5000);
          (this as unknown as { _startTimeout?: NodeJS.Timeout })._startTimeout = st;
        },
        onText: (data) => this.handleText(data),
        onBinary: () => {
          // ASR 客户端不接收二进制（音频是上行）；忽略
        },
        onClose: (code, reason) => this.handleClose(code, reason),
        onError: (err) => this.handleError(err),
      });
    });
  }

  /**
   * 推送音频帧。需在 start() resolve 后调用（task-started 已到）。
   * task-started 未到时丢弃（PoC 简化：真实场景握手极快）。
   */
  sendAudioChunk(samples: Int16Array): void {
    if (!this.transport || !this.taskId) {
      throw new AsrError('会话未开始，无法推送音频', 'SESSION_NOT_STARTED');
    }
    if (!this.started) {
      // task-started 未到，丢弃——打日志定位"音频未送达 ASR"类问题
      console.warn('[ASR] task-started 未到，音频帧被丢弃');
      return;
    }
    if (this.finished) {
      console.warn('[ASR] 会话已 finished，音频帧被丢弃');
      return;
    }
    // Int16Array → ArrayBuffer 二进制帧
    const buf =
      samples.buffer instanceof ArrayBuffer
        ? samples.buffer.slice(
            samples.byteOffset,
            samples.byteOffset + samples.byteLength
          )
        : samples.buffer;
    this.transport.send(buf as ArrayBuffer);
  }

  /**
   * 结束会话：发 finish-task，等 task-finished。
   * 3 秒超时兜底：若 task-finished 未到达，强制重置状态避免后续 start 阻塞。
   */
  finish(): Promise<void> {
    if (!this.transport || !this.taskId) {
      return Promise.reject(
        new AsrError('会话未开始，无法结束', 'SESSION_NOT_STARTED')
      );
    }
    if (!this.started) {
      return Promise.reject(
        new AsrError('task 未 started，无法 finish', 'NOT_STARTED')
      );
    }
    if (this.finished) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      this.finishResolve = resolve;
      this.finishReject = reject;
      this.transport!.send(buildAsrFinishTask(this.taskId!));

      // 3 秒超时兜底：dashscope 偶发不发 task-finished，强制清理
      const timeout = setTimeout(() => {
        console.warn('[ASR] finish() 超时，强制重置状态');
        this.forceCleanup();
        resolve();
      }, 3000);
      // 存 timeout id 以便 task-finished 到达时清除
      (this as unknown as { _finishTimeout?: NodeJS.Timeout })._finishTimeout = timeout;
    });
  }

  /** 强制清理所有会话状态（超时/异常兜底） */
  private forceCleanup(): void {
    this.finished = true;
    try { this.transport?.close(); } catch {}
    this.transport = null;
    this.taskId = null;
    this.started = false;
    this.finished = false;
    this.lastText = '';
    const fd = (this as unknown as { _finishTimeout?: NodeJS.Timeout })._finishTimeout;
    if (fd) clearTimeout(fd);
  }

  // ============== 内部事件处理 ==============

  private handleText(data: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return; // 忽略无法解析的文本帧
    }
    const header = (msg.header ?? {}) as Record<string, unknown>;
    const event = header.event as string | undefined;
    const payload = (msg.payload ?? {}) as Record<string, unknown>;
    const output = (payload.output ?? {}) as Record<string, unknown>;

    if (event === 'task-started') {
      this.started = true;
      // 清除 start() 超时
      const st = (this as unknown as { _startTimeout?: NodeJS.Timeout })._startTimeout;
      if (st) { clearTimeout(st); (this as unknown as { _startTimeout?: NodeJS.Timeout })._startTimeout = undefined; }
      const r = this.startResolve;
      this.startResolve = null;
      this.startReject = null;
      r?.();
    } else if (event === 'result-generated') {
      // 真实 Paraformer-realtime-v2 结构（2026-09 实测）：
      //   payload.output.sentence.text          句子级累积文本（非递减）
      //   payload.output.sentence.sentence_end  布尔，true 表示本句结束
      // 兼容早期文档假设的 output.text / output.type='sentence-end'。
      const sentence = (output.sentence ?? {}) as Record<string, unknown>;
      const text =
        (typeof sentence.text === 'string' && sentence.text) ||
        (typeof output.text === 'string' && output.text) ||
        '';
      const isEnd =
        sentence.sentence_end === true ||
        output.type === 'sentence-end';
      if (text) {
        // 增量文本（非递减：每次 text 应包含上次全部内容）
        this.lastText = text;
        this.callbacks?.onText(text);
      }
      if (isEnd && text) {
        // 一句完整结束
        this.lastText = ''; // 句末后重置，避免 task-finished 重复补发
        this.callbacks?.onSentenceEnd(text);
      }
    } else if (event === 'task-finished') {
      this.finished = true;
      // 清除 finish() 超时
      const fd = (this as unknown as { _finishTimeout?: NodeJS.Timeout })._finishTimeout;
      if (fd) { clearTimeout(fd); (this as unknown as { _finishTimeout?: NodeJS.Timeout })._finishTimeout = undefined; }
      // 若有未结句的尾文本，补发一次 onSentenceEnd
      if (this.lastText) {
        this.callbacks?.onSentenceEnd(this.lastText);
        this.lastText = '';
      }
      try {
        this.transport?.close();
      } catch {
        /* ignore */
      }
      // 重置会话状态，允许复用（start → finish → start 循环）
      this.transport = null;
      this.taskId = null;
      this.started = false;
      this.finished = false;
      const r = this.finishResolve;
      this.finishResolve = null;
      this.finishReject = null;
      r?.();
    } else if (event === 'task-failed') {
      const code = (header.error_code as string) ?? 'ASR_FAILED';
      const message = (header.error_message as string) ?? 'task-failed';
      try {
        this.transport?.close();
      } catch {
        /* ignore */
      }
      this.rejectPending(new AsrError(message, code));
    }
  }

  private handleClose(code: number, reason: string): void {
    if (this.finished) return;
    const err = new AsrError(
      `WebSocket 提前关闭 code=${code} reason=${reason}`,
      this.started ? 'WS_CLOSED_EARLY' : 'WS_CLOSED_BEFORE_START'
    );
    this.rejectPending(err);
  }

  private handleError(err: Error): void {
    this.rejectPending(new AsrError(err.message, 'WS_ERROR'));
  }

  /** reject 当前 pending 的 promise（finish 优先，其次 start） */
  private rejectPending(err: Error): void {
    if (this.finishReject) {
      const r = this.finishReject;
      this.finishResolve = null;
      this.finishReject = null;
      r(err);
    } else if (this.startReject) {
      const r = this.startReject;
      this.startResolve = null;
      this.startReject = null;
      r(err);
    }
  }
}
