/**
 * dashscope-tts —— CosyVoice 实时语音合成 + 声音设计
 *
 * 协议来源：百炼 Qwen-Audio-TTS/CosyVoice WebSocket API（maas 域名）。
 *   URL  : wss://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference
 *   鉴权 : 握手期 Authorization: Bearer <api_key> 头
 *   帧序 : run-task → (task-started) → continue-task → finish-task
 *          ← task-started / result-generated(文本) / 二进制音频 / task-finished / task-failed
 *   音频 : 通过 WebSocket 二进制帧（binary channel）下发，format=pcm 时为 PCM
 *   注   : maas 端走标准 WS 文本/二进制帧，无 4 字节长度前缀（前缀仅旧版 NLS 网关用）。
 *
 * 声音设计（HTTP）：
 *   POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/customization
 *   body: { model:'voice-enrollment', input:{ action:'create_voice', target_model, voice_prompt, preview_text, prefix }, parameters:{ sample_rate, response_format } }
 *   返回 voice_id（名称形如 {target_model}-vd-{prefix}-{unique_id}），用于后续 run-task.parameters.voice。
 *
 * 可测试性：transport 与 httpPost 均可注入，tts-mock.test.ts 用假实现验证帧序与 payload。
 */

import { randomUUID } from 'node:crypto';
import type { VoiceDesignFn, VoiceDesignRequest } from './types.js';

// ============== 类型错误 ==============

export class TtsError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'TtsError';
  }
}

// ============== 传输层抽象 ==============

export interface TtsTransportHandlers {
  onOpen: () => void;
  /** 文本帧（JSON 字符串） */
  onText: (data: string) => void;
  /** 二进制帧（音频 PCM） */
  onBinary: (data: ArrayBuffer) => void;
  onClose: (code: number, reason: string) => void;
  onError: (err: Error) => void;
}

export interface TtsTransport {
  setHandlers(handlers: TtsTransportHandlers): void;
  send(data: string | ArrayBuffer): void;
  close(): void;
  readonly readyState: number;
}

// ============== HTTP 抽象（声音设计） ==============

export interface HttpPostResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

export type HttpPost = (
  url: string,
  opts: { method: string; headers: Record<string, string>; body: string }
) => Promise<HttpPostResponse>;

// ============== 配置 ==============

export interface TtsClientConfig {
  apiKey: string;
  workspaceId: string;
  model: string;
  sampleRate?: number; // 默认 16000
  format?: 'pcm' | 'wav' | 'mp3' | 'opus'; // 默认 pcm
}

export interface TtsClientDeps {
  /** 注入 transport 工厂（测试用假实现）；默认用真实 WsTtsTransport（异步） */
  createTransport?: (
    url: string,
    headers: Record<string, string>
  ) => TtsTransport | Promise<TtsTransport>;
  /** 注入 httpPost（测试用假实现）；默认用全局 fetch */
  httpPost?: HttpPost;
}

// ============== 声音设计（HTTP） ==============

const VOICE_DESIGN_PREVIEW_TEXT =
  '您好，我是您的直属下属，很高兴和您沟通今天的工作进展。'; // ≥15 字符，API 要求

/** 默认 httpPost：用 Node 全局 fetch */
const defaultHttpPost: HttpPost = async (url, opts) => {
  const resp = await fetch(url, {
    method: opts.method,
    headers: opts.headers,
    body: opts.body,
  });
  return {
    ok: resp.ok,
    status: resp.status,
    json: () => resp.json(),
    text: () => resp.text(),
  };
};

/**
 * 生成 VoiceDesignFn（喂给 VoiceProfileMapper.initialize）。
 * 调用 CosyVoice 声音设计 HTTP 接口，返回 voice_id。
 */
export function createDashscopeVoiceDesignFn(
  config: Pick<TtsClientConfig, 'apiKey' | 'workspaceId' | 'model'>,
  deps?: { httpPost?: HttpPost }
): VoiceDesignFn {
  const httpPost = deps?.httpPost ?? defaultHttpPost;
  return async (req: VoiceDesignRequest): Promise<string> => {
    const url = `https://${config.workspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/customization`;
    // prefix 仅字母数字 ≤10，用 disc+ 型字母
    const prefix = `disc${req.disc.toLowerCase()}`;
    const body = JSON.stringify({
      model: 'voice-enrollment',
      input: {
        action: 'create_voice',
        target_model: config.model,
        voice_prompt: req.description, // 自然语言描述
        preview_text: VOICE_DESIGN_PREVIEW_TEXT,
        prefix,
      },
      parameters: {
        sample_rate: 24000,
        response_format: 'wav',
      },
    });
    const resp = await httpPost(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body,
    });
    if (!resp.ok) {
      const t = await resp.text();
      throw new TtsError(
        `声音设计接口失败 status=${resp.status} body=${t}`,
        'VOICE_DESIGN_HTTP_ERROR'
      );
    }
    const json = (await resp.json()) as Record<string, unknown>;
    const voiceId = extractVoiceId(json);
    if (!voiceId) {
      throw new TtsError(
        `声音设计响应未包含 voice_id：${JSON.stringify(json)}`,
        'VOICE_DESIGN_NO_ID'
      );
    }
    return voiceId;
  };
}

/** 防御式从多种可能结构中提取 voice_id */
function extractVoiceId(json: Record<string, unknown>): string | null {
  const out = json.output as Record<string, unknown> | undefined;
  const cand = [
    out?.voice_id,
    (out?.voice as Record<string, unknown> | undefined)?.voice_id,
    (out as Record<string, unknown> | undefined)?.id,
    json.voice_id,
  ];
  for (const c of cand) {
    if (typeof c === 'string' && c.length > 0) return c;
  }
  return null;
}

// ============== 帧构造（导出便于测试断言） ==============

export function buildRunTask(taskId: string, config: TtsClientConfig, voiceId: string): string {
  return JSON.stringify({
    header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
    payload: {
      task_group: 'audio',
      task: 'tts',
      function: 'SpeechSynthesizer',
      model: config.model,
      parameters: {
        text_type: 'PlainText',
        voice: voiceId,
        format: config.format ?? 'pcm',
        sample_rate: config.sampleRate ?? 16000,
        rate: 1.0,
        pitch: 1.0,
        enable_ssml: false,
      },
      input: {},
    },
  });
}

export function buildContinueTask(taskId: string, text: string): string {
  return JSON.stringify({
    header: { action: 'continue-task', task_id: taskId, streaming: 'duplex' },
    payload: { input: { text } },
  });
}

export function buildFinishTask(taskId: string): string {
  return JSON.stringify({
    header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
    payload: { input: {} },
  });
}

// ============== TTS 客户端 ==============

const WS_OPEN = 1;

export class CosyVoiceTTSClient {
  private config: TtsClientConfig;
  private createTransport: (
    url: string,
    headers: Record<string, string>
  ) => TtsTransport | Promise<TtsTransport>;

  constructor(config: TtsClientConfig, deps?: TtsClientDeps) {
    this.config = config;
    this.createTransport = deps?.createTransport ?? defaultCreateTransport;
  }

  private endpoint(): string {
    return `wss://${this.config.workspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference`;
  }

  /**
   * 流式合成。空文本直接返回（不合成）。
   * 帧：run-task → 等 task-started → continue-task → finish-task → 收二进制音频回调 → task-finished 解析。
   */
  async synthesize(
    text: string,
    voiceId: string,
    onAudioChunk: (pcm: ArrayBuffer) => void
  ): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) {
      // 空文本不合成
      return;
    }

    const taskId = randomUUID();
    const transport = await this.createTransport(this.endpoint(), {
      Authorization: `Bearer ${this.config.apiKey}`,
    });

    return new Promise<void>((resolve, reject) => {
      let finished = false;
      let started = false;

      transport.setHandlers({
        onOpen: () => {
          // 仅发 run-task，等 task-started 再发文本
          transport.send(buildRunTask(taskId, this.config, voiceId));
        },
        onText: (data) => {
          let msg: Record<string, unknown>;
          try {
            msg = JSON.parse(data) as Record<string, unknown>;
          } catch {
            return; // 忽略无法解析的文本帧
          }
          const header = (msg.header ?? {}) as Record<string, unknown>;
          const event = header.event as string | undefined;
          if (event === 'task-started') {
            started = true;
            transport.send(buildContinueTask(taskId, trimmed));
            transport.send(buildFinishTask(taskId));
          } else if (event === 'task-finished') {
            finished = true;
            try {
              transport.close();
            } catch {
              /* ignore */
            }
            resolve();
          } else if (event === 'task-failed') {
            const code = (header.error_code as string) ?? 'TTS_FAILED';
            const message =
              (header.error_message as string) ?? 'task-failed';
            try {
              transport.close();
            } catch {
              /* ignore */
            }
            reject(new TtsError(message, code));
          }
          // result-generated：文本帧带元数据，音频走二进制帧，这里无需处理
        },
        onBinary: (buf) => {
          onAudioChunk(buf);
        },
        onClose: (code, reason) => {
          if (!finished) {
            reject(
              new TtsError(
                `WebSocket 提前关闭 code=${code} reason=${reason}`,
                started ? 'WS_CLOSED_EARLY' : 'WS_CLOSED_BEFORE_START'
              )
            );
          }
        },
        onError: (err) => {
          reject(new TtsError(err.message, 'WS_ERROR'));
        },
      });
    });
  }
}

// ============== 真实 transport（基于 ws 包） ==============

let WebSocketImpl: typeof import('ws').default | null = null;
async function loadWs(): Promise<typeof import('ws').default> {
  if (WebSocketImpl) return WebSocketImpl;
  // 动态 import，避免纯类型构建期对 ws 的硬依赖
  const mod = (await import('ws')) as unknown as { default: typeof import('ws').default };
  WebSocketImpl = mod.default;
  return WebSocketImpl;
}

function bufferToArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

export const defaultCreateTransport = async (
  url: string,
  headers: Record<string, string>
): Promise<TtsTransport> => {
  const WebSocket = await loadWs();
  const ws = new WebSocket(url, { headers });
  return {
    setHandlers(handlers) {
      ws.on('open', handlers.onOpen);
      ws.on('message', (data, isBinary) => {
        if (isBinary) {
          handlers.onBinary(bufferToArrayBuffer(data as Buffer));
        } else {
          handlers.onText((data as Buffer).toString('utf-8'));
        }
      });
      ws.on('close', (code, reason) =>
        handlers.onClose(code, reason.toString())
      );
      ws.on('error', (err) => handlers.onError(err));
    },
    send(data) {
      ws.send(data);
    },
    close() {
      ws.close();
    },
    get readyState() {
      return ws.readyState;
    },
  };
};

// 标记 readyState 常量供测试复用（避免魔法数）
export const TTS_TRANSPORT_OPEN = WS_OPEN;
