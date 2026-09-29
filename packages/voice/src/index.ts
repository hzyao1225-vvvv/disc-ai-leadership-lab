/**
 * @disc-lab/voice - 语音交互集成包
 *
 * 管道：ASR (Paraformer) → EmployeeAgent.respond → TTS (CosyVoice)
 * 降级：voice / text / voice-degraded 三态状态机
 *
 * 模块导出在 Step 2-7 逐步填充。
 */

// Step 2：类型 + DISC → voiceId 映射
export * from './types.js';
export * from './voice-profile-mapper.js';
// Step 3：CosyVoice TTS + 声音设计
export * from './dashscope-tts.js';
// Step 4：Paraformer ASR
export * from './dashscope-asr.js';
// Step 5：三态降级状态机 + 网络中断缓存
export * from './degradation.js';
// Step 6：核心编排（ASR → agent.respond → TTS）
export * from './voice-pipeline.js';
