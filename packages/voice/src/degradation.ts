/**
 * degradation.ts —— 语音模式三态状态机 + 降级决策器 + 网络中断文本缓存
 *
 * 三态：voice / text / voice-degraded
 *
 * 转移规则（W5 plan §5 降级策略）：
 *   voice ──mic-denied────────────────► text                 （不可逆，用户刷新才回 voice）
 *   voice ──user-switch────────────────► text                 （不可逆）
 *   voice ──asr-failed×N(默认3)────────► voice-degraded        （可回 voice：30s 自动重试）
 *   voice ──tts-failed─────────────────► voice-degraded       （ASR 保留，TTS 关；可回 voice）
 *   voice ──network-lost───────────────► voice（不变，外部缓存 3 条文本，重连 flush）
 *   voice-degraded ──recover──────────► voice                 （30s 自动重试成功）
 *   voice-degraded ──任何失败──────────► text                 （不可逆：避免抖动）
 *   text ──任何──► text                                        （终态）
 *
 * 设计：状态机不持定时器，仅返回 scheduleRetry 标志；
 * 由外部（voice-pipeline/voice-server）调度 30s 后发 recover 事件，便于测试注入。
 */

import type { VoiceModeState } from './types.js';

// VoiceModeState 仅从 types.ts 导出（避免 index.ts 重复导出歧义）。
// degradation.ts 内部使用该类型，不 re-export。

// ============== 降级事件 ==============

export type DegradationErrorKind =
  | 'mic-denied' // 麦克风权限被拒
  | 'asr-failed' // ASR 单次失败
  | 'tts-failed' // TTS 失败
  | 'network-lost' // 网络中断
  | 'user-switch' // 用户手动切换到文字模式
  | 'recover'; // 恢复信号（voice-degraded → voice，30s 自动重试成功）

export interface DegradationEvent {
  kind: DegradationErrorKind;
  /** 可选错误信息（便于 reason 拼装） */
  message?: string;
}

export interface DegradationTransition {
  /** 转移后的目标态（与转移前相同表示态不变，仅副作用） */
  to: VoiceModeState;
  /** 转移原因（供 UI 展示） */
  reason: string;
  /**
   * 是否需要外部调度 30s 后发 recover 事件。
   * 仅 voice → voice-degraded（asr/tts 失败）时为 true。
   */
  scheduleRetry?: boolean;
}

// ============== 配置 ==============

export interface DegradationConfig {
  /** ASR 连续失败几次触发降级，默认 3 */
  asrFailureThreshold?: number;
}

// ============== 状态机 ==============

export class VoiceModeStateMachine {
  private state: VoiceModeState = 'voice';
  private asrFailures = 0;
  private ttsFailures = 0;
  private readonly asrThreshold: number;

  constructor(config?: DegradationConfig) {
    this.asrThreshold = config?.asrFailureThreshold ?? 3;
  }

  getState(): VoiceModeState {
    return this.state;
  }

  getAsrFailures(): number {
    return this.asrFailures;
  }

  getTtsFailures(): number {
    return this.ttsFailures;
  }

  /**
   * 处理事件，返回转移信息（null 表示态不变）。
   * 不可逆性：voice→text 后不可回退；voice-degraded→text 后不可回退；
   * 仅 voice-degraded→voice 可经 recover 回退。
   */
  transition(event: DegradationEvent): DegradationTransition | null {
    const prev = this.state;

    // text 是终态（不可逆）
    if (prev === 'text') {
      return null;
    }

    switch (event.kind) {
      case 'mic-denied': {
        this.state = 'text';
        return {
          to: 'text',
          reason: event.message ?? '麦克风权限被拒，已切文字模式',
        };
      }
      case 'user-switch': {
        this.state = 'text';
        return {
          to: 'text',
          reason: event.message ?? '用户手动切换到文字模式',
        };
      }
      case 'asr-failed': {
        this.asrFailures++;
        if (prev === 'voice') {
          if (this.asrFailures >= this.asrThreshold) {
            this.state = 'voice-degraded';
            return {
              to: 'voice-degraded',
              reason:
                event.message ??
                `ASR 连续失败 ${this.asrFailures} 次，切语音降级（ASR 关闭，TTS 保留）`,
              scheduleRetry: true,
            };
          }
          return null; // 未达阈值，态不变
        }
        // prev === 'voice-degraded'：再次 ASR 失败 → 不可逆 text
        this.state = 'text';
        return {
          to: 'text',
          reason:
            event.message ?? 'voice-degraded 下 ASR 再次失败，不可逆切文字模式',
        };
      }
      case 'tts-failed': {
        this.ttsFailures++;
        if (prev === 'voice') {
          this.state = 'voice-degraded';
          return {
            to: 'voice-degraded',
            reason:
              event.message ?? 'TTS 失败，切语音降级（ASR 保留，TTS 关闭）',
            scheduleRetry: true,
          };
        }
        // prev === 'voice-degraded'：再次 TTS 失败 → 不可逆 text
        this.state = 'text';
        return {
          to: 'text',
          reason:
            event.message ?? 'voice-degraded 下 TTS 失败，不可逆切文字模式',
        };
      }
      case 'network-lost': {
        // 网络中断不切态（voice 保留），由外部 VoiceNetworkBuffer 缓存文本 + 重连 flush
        return null;
      }
      case 'recover': {
        // 仅 voice-degraded 下经 30s 自动重试成功才回 voice
        if (prev === 'voice-degraded') {
          this.asrFailures = 0;
          this.ttsFailures = 0;
          this.state = 'voice';
          return {
            to: 'voice',
            reason: event.message ?? '30s 自动重试成功，恢复语音模式',
          };
        }
        return null;
      }
      default:
        return null;
    }
  }

  /** 重置（用户手动刷新页面 / 重新连接） */
  reset(): void {
    this.state = 'voice';
    this.asrFailures = 0;
    this.ttsFailures = 0;
  }
}

// ============== 网络中断文本缓存 ==============

/**
 * 网络中断时缓存最近 N 条未发送文本，重连后 flush 续传。
 * 默认 max=3（W5 plan §5 约束）。
 */
export class VoiceNetworkBuffer {
  private queue: string[] = [];
  readonly max: number;

  constructor(max = 3) {
    this.max = max;
  }

  /** 入队；超过 max 丢弃最旧的（保留最近 max 条） */
  push(text: string): void {
    this.queue.push(text);
    while (this.queue.length > this.max) {
      this.queue.shift();
    }
  }

  /** 重连后 flush：返回全部缓存并清空 */
  flush(): string[] {
    const out = this.queue.slice();
    this.queue = [];
    return out;
  }

  size(): number {
    return this.queue.length;
  }
}
