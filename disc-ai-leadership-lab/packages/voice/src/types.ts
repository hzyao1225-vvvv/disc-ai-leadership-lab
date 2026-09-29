/**
 * @disc-lab/voice - 语音交互类型定义
 *
 * 设计原则：VoicePersona 是 agent Persona 的结构兼容 subset，
 * 不修改 packages/agent 任何文件。PERSONAS（Record<string, Persona>）
 * 可直接赋值给 Record<string, VoicePersona>。
 */

// ============== DISC 类型（与 agent DISCType 结构兼容） ==============

export type DISCType = 'D' | 'I' | 'S' | 'C';

// ============== 语音画像 subset（与 agent VoiceProfile 结构兼容） ==============

export interface VoiceProfile {
  /** 语速 slow | medium | fast */
  pace: 'slow' | 'medium' | 'fast';
  /** 音调 low | mid | high */
  pitch: 'low' | 'mid' | 'high';
  /** 音色描述（供 TTS 选型） */
  timbre: string;
  /** 标志性口头禅 —— 不进入声音设计描述 */
  catchphrase?: string;
}

// ============== Persona subset（结构兼容 agent Persona） ==============

export interface VoicePersona {
  id: string;
  name: string;
  disc: DISCType;
  voice: VoiceProfile;
}

// ============== 语音模式三态状态机 ==============

export type VoiceModeState = 'voice' | 'text' | 'voice-degraded';

// ============== CosyVoice 声音设计 ==============

export interface VoiceDesignRequest {
  /** DISC 型 */
  disc: DISCType;
  /** 自然语言音色描述（由 VoiceProfileMapper.buildDescription 拼装） */
  description: string;
  /** 模型名（如 cosyvoice-v3-flash） */
  model: string;
}

/** DISC → voiceId 映射（同 DISC 型 2 人共享同一 voiceId） */
export type VoiceIdMap = Record<DISCType, string>;

/** voice-cache.json 结构 */
export interface VoiceCacheFile {
  version: number;
  model: string;
  voiceIds: VoiceIdMap;
  createdAt: string;
}

// ============== 缓存存储抽象（便于测试注入 in-memory 实现） ==============

export interface VoiceCacheStore {
  read(): VoiceCacheFile | null;
  write(file: VoiceCacheFile): void;
}

// ============== 声音设计函数（注入：真实调 dashscope / mock 返回固定 id） ==============

export type VoiceDesignFn = (request: VoiceDesignRequest) => Promise<string>;

// ============== WebSocket 协议消息（voice-server § Step 7 使用） ==============

// 复用 agent 包的评价类型，避免重复定义
import type {
  EvaluationCriteria,
  EvaluationResult,
} from '@disc-lab/agent';

// 客户端 → 服务端
export type VoiceClientMessage =
  | {
      type: 'start';
      sceneId: string;
      personaId: string;
      mode: VoiceModeState;
      /** 学员编辑后的会话背景；空串/未传 = 走 scene.sessionBackgroundDefault */
      sessionBackground?: string;
      /** 学员编辑后的会话目标；空串/未传 = 走 scene.sessionGoalDefault */
      sessionGoal?: string;
    }
  | { type: 'audio-chunk'; data: ArrayBuffer } // PCM Int16
  | { type: 'audio-end' }
  | { type: 'text'; content: string } // 降级文字输入
  | { type: 'switch-mode'; mode: VoiceModeState }
  | { type: 'evaluate'; criteria?: EvaluationCriteria } // 主动触发评价
  | { type: 'dbg'; ev: string; bytes?: number } // 前端诊断事件
  | { type: 'ping' };

// 服务端 → 客户端
export type VoiceServerMessage =
  | { type: 'asr-partial'; text: string }
  | { type: 'asr-final'; text: string }
  | { type: 'reply'; text: string; emotion: string; round: number }
  | { type: 'audio-chunk'; data: ArrayBuffer } // PCM
  | { type: 'audio-end' }
  | { type: 'mode'; mode: VoiceModeState; reason?: string }
  | { type: 'evaluation'; result: EvaluationResult } // 评价结果回推
  | { type: 'error'; message: string }
  | { type: 'pong' };

// 复用 agent 包的评价类型（re-export 便于前端/测试直接从 voice 包取）
export type { EvaluationCriteria, EvaluationResult } from '@disc-lab/agent';
