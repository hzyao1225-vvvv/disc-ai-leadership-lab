/**
 * VoiceProfileMapper
 *
 * 职责：把 8 个 Persona.voice 映射成 4 个 DISC 型 voiceId（同型 2 人共享）。
 * - buildDescription(persona): 用 timbre / pace / pitch 拼自然语言描述；
 *   catchphrase 明确不入描述（口头禅是文本风格，由 LLM 驱动，不污染音色设计）。
 * - initialize: 读 voice-cache.json 命中跳过创建；缺失的 DISC 型调 voiceDesignFn 生成；
 *   结果回写缓存。
 * - getVoiceId(persona): 按 persona.disc 查 map。
 *
 * 不修改 packages/agent 任何文件：mapper 仅依赖 voice 自己的 VoicePersona subset，
 * PERSONAS 可结构兼容传入。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve as pathResolve } from 'node:path';
import type {
  DISCType,
  VoicePersona,
  VoiceProfile,
  VoiceCacheFile,
  VoiceCacheStore,
  VoiceDesignFn,
  VoiceDesignRequest,
  VoiceIdMap,
} from './types.js';

const DISC_ORDER: readonly DISCType[] = ['D', 'I', 'S', 'C'] as const;

/**
 * DISC 4 型 → CosyVoice 系统预置音色（免费，无需声音设计/voice-enrollment）。
 * 已在 cosyvoice-v3-flash + maas 实时端点实测全部可合成（2026-09）。
 * 选型依据（受 v3-flash 中文成熟音色库存限制，同型 2 人共享）：
 *   D 龙安洋 longanyang      阳光有力男声、支持情感指令 → 结果导向、冲劲
 *   I 龙安欢 longanhuan_v3   欢脱元气女、感染力强       → 热情、情感丰富
 *   S 龙小淳 longxiaochun_v3 知性积极/温和女           → 平稳、温和支持
 *   C 龙小夏 longxiaoxia_v3  沉稳权威女、克制           → 冷静、字斟句酌
 * 注：性别与部分角色不完全一致（同型共享约束使然）；角色差异化由 LLM 文本风格承担。
 * 将来开通付费声音设计后，可改走 initialize + voiceDesignFn 生成定制音色。
 */
export const PRESET_VOICE_IDS: VoiceIdMap = {
  D: 'longanyang',
  I: 'longanhuan_v3',
  S: 'longxiaochun_v3',
  C: 'longxiaoxia_v3',
};

const PACE_DESC: Record<VoiceProfile['pace'], string> = {
  slow: '语速偏慢',
  medium: '语速中等',
  fast: '语速偏快',
};

const PITCH_DESC: Record<VoiceProfile['pitch'], string> = {
  low: '低沉',
  mid: '中音区',
  high: '清亮',
};

/**
 * 文件系统缓存存储（默认实现，运行时用）。
 * 使用同步 fs：启动期一次性读取小 JSON，避免 async 噪声。
 */
export class FileVoiceCacheStore implements VoiceCacheStore {
  private readonly absPath: string;

  constructor(filePath: string) {
    this.absPath = pathResolve(filePath);
  }

  read(): VoiceCacheFile | null {
    if (!existsSync(this.absPath)) return null;
    try {
      const raw = readFileSync(this.absPath, 'utf-8');
      const parsed = JSON.parse(raw) as VoiceCacheFile;
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        typeof parsed.model !== 'string' ||
        !parsed.voiceIds
      ) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  write(file: VoiceCacheFile): void {
    const dir = dirname(this.absPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.absPath, JSON.stringify(file, null, 2), 'utf-8');
  }
}

export interface MapperInitOptions {
  /** 8 个 Persona（结构兼容 VoicePersona subset 即可） */
  personas: Record<string, VoicePersona>;
  /** 声音设计函数（真实 dashscope / mock） */
  voiceDesignFn: VoiceDesignFn;
  /** 缓存存储；不传则不缓存 */
  cacheStore?: VoiceCacheStore;
  /** 模型名（缓存命中需匹配） */
  model: string;
}

export class VoiceProfileMapper {
  private voiceIds: VoiceIdMap = { D: '', I: '', S: '', C: '' };
  /** 最近一次 initialize 中实际调用 voiceDesignFn 的次数 */
  private designCallCount = 0;

  /**
   * 用 timbre / pace / pitch 拼自然语言音色描述。
   * 注意：catchphrase 不入描述（强约束：口头禅属文本风格，由 LLM 文本侧驱动）。
   */
  static buildDescription(persona: VoicePersona): string {
    const v = persona.voice;
    return `${v.timbre}，${PACE_DESC[v.pace]}，${PITCH_DESC[v.pitch]}`;
  }

  /** 按 DISC 型取 voiceId；未初始化抛错 */
  getVoiceId(persona: VoicePersona): string {
    const id = this.voiceIds[persona.disc];
    if (!id) {
      throw new Error(
        `voiceId 未初始化：DISC=${persona.disc}（请先调用 initialize）`
      );
    }
    return id;
  }

  /** 取整张映射（只读副本） */
  getVoiceIdMap(): Readonly<VoiceIdMap> {
    return { ...this.voiceIds };
  }

  /**
   * 预置音色模式：直接载入系统预置 voiceId 映射，不调声音设计接口（免费）。
   * PoC 默认路径。传入自定义 map 可覆盖选型。
   */
  usePresetVoices(map: VoiceIdMap = PRESET_VOICE_IDS): void {
    for (const disc of DISC_ORDER) {
      if (!map[disc]) throw new Error(`预置音色缺失：DISC=${disc}`);
    }
    this.voiceIds = { ...map };
    this.designCallCount = 0;
  }

  /** 最近一次 initialize 中 voiceDesignFn 被调用的次数 */
  getDesignCallCount(): number {
    return this.designCallCount;
  }

  /**
   * 初始化：读缓存 → 缺失的 DISC 型调 voiceDesignFn → 回写缓存。
   * 同 DISC 型 2 人共享 voiceId：取该 DISC 型首个出现的 persona 作为代表建描述。
   */
  async initialize(opts: MapperInitOptions): Promise<void> {
    this.designCallCount = 0;
    const { personas, voiceDesignFn, cacheStore, model } = opts;

    // 1. 从缓存恢复
    const cache = cacheStore?.read() ?? null;
    if (cache && cache.version === 1 && cache.model === model) {
      this.voiceIds = { ...cache.voiceIds };
    }

    // 2. 每个 DISC 型取首个代表 persona
    const representative = new Map<DISCType, VoicePersona>();
    for (const key of Object.keys(personas)) {
      const p = personas[key];
      if (!p) continue;
      if (!representative.has(p.disc)) representative.set(p.disc, p);
    }

    // 3. 为缺失 DISC 型创建 voiceId
    let created = false;
    for (const disc of DISC_ORDER) {
      if (this.voiceIds[disc]) continue;
      const persona = representative.get(disc);
      if (!persona) continue;
      const request: VoiceDesignRequest = {
        disc,
        description: VoiceProfileMapper.buildDescription(persona),
        model,
      };
      this.designCallCount++;
      const voiceId = await voiceDesignFn(request);
      if (!voiceId) {
        throw new Error(`voiceDesignFn 返回空 voiceId：DISC=${disc}`);
      }
      this.voiceIds[disc] = voiceId;
      created = true;
    }

    // 4. 回写缓存（仅在本次有新建时）
    if (created && cacheStore) {
      const file: VoiceCacheFile = {
        version: 1,
        model,
        voiceIds: { ...this.voiceIds },
        createdAt: new Date().toISOString(),
      };
      cacheStore.write(file);
    }
  }
}
