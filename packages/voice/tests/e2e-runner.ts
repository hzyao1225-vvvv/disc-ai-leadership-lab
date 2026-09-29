/**
 * e2e-runner.ts —— W5 端到端真实冒烟（W5 plan §6 Step 8）
 *
 * 用途：在真实 DASHSCOPE + LLM 凭证下，跑通"音色设计 → EmployeeAgent.respond → CosyVoice TTS"全链路；
 *       可选：若提供 tests/sample.pcm（16kHz Int16 PCM），跑通 Paraformer ASR 真实识别。
 *
 * 触发：pnpm --filter @disc-lab/voice test:e2e（自动加载 ../../.env）
 *
 * SKIP 条件（任一）：
 *   - DASHSCOPE_API_KEY 或 DASHSCOPE_WORKSPACE_ID 为空 / 占位值
 *   - LLM_API_KEY 为空 / 占位值
 *   - 网络无法触达 dashscope maas 域名（运行时由调用失败暴露）
 *
 * 断言：
 *   - A. mapper.initialize 真实创建 4 voiceId（非空）
 *   - B. EmployeeAgent.respond 真实 LLM 调用：reply 非空 + emotion 非空 + round=1
 *   - C. CosyVoiceTTSClient.synthesize 真实合成 reply 首句：onAudioChunk 累计字节 > 0
 *   - D. （可选）若有 tests/sample.pcm：ParaformerASRClient 真实识别：onSentenceEnd 文本非空
 *
 * PoC 范围：不做麦克风实时采集（Node 端不便）；真实麦克风测试用 Step 7 浏览器测试页。
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EmployeeAgent } from '@disc-lab/agent';
import { PERSONAS } from '@disc-lab/agent/personas';

import { VoiceProfileMapper } from '../src/voice-profile-mapper.js';
import { CosyVoiceTTSClient } from '../src/dashscope-tts.js';
import { ParaformerASRClient } from '../src/dashscope-asr.js';
import type { VoicePersona } from '../src/types.js';

// ============== 内嵌最小 Scene 字面值（与 voice-server 同步源：packages/agent/src/scenes.ts） ==============

const SCENE_PERF = {
  id: 'perf_review_v1',
  type: 'performance_review' as const,
  title: '季度绩效面谈',
  description:
    '本季度业绩复盘，领导者需要与员工就近期表现进行 1:1 面谈，了解其状态、对齐下阶段目标',
  stressors: ['KPI 压力', '团队重组', '客户预算收紧'],
  leaderGoals: ['了解员工真实状态', '识别潜在离职风险', '建立信任，给出可执行发展建议'],
  initialEmotion: 'guarded',
  difficulty: 3,
};

const PERSONA_ID = 'zhang_jun';
const USER_TEXT = '张峻，本季度你的业绩数据我看了，我们谈谈。';

// ============== 极简测试桩（沿用项目约定） ==============

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ ${msg}`);
  }
}

// ============== 占位值检测 ==============

function isPlaceholder(value: string | undefined): boolean {
  if (!value) return true;
  const v = value.trim();
  if (!v) return true;
  if (/^sk-xxx/i.test(v)) return true;
  if (/REPLACE/i.test(v)) return true;
  if (v.length < 20) return true; // 真实 key 通常 ≥ 32
  return false;
}

// ============== 环境读取 ==============

function readEnv() {
  // DASHSCOPE_API_KEY 未单独配置时回退 LLM_API_KEY（W5 规划：同一个通义 key）
  const llmApiKey = process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? '';
  return {
    dashscopeApiKey: process.env.DASHSCOPE_API_KEY || llmApiKey,
    dashscopeWorkspaceId: process.env.DASHSCOPE_WORKSPACE_ID ?? '',
    llmApiKey,
    llmBaseUrl: process.env.LLM_BASE_URL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    llmModel: process.env.LLM_MODEL ?? 'qwen-plus',
    llmTemperature: Number(process.env.LLM_TEMPERATURE ?? 0.7),
    llmMaxTokens: Number(process.env.LLM_MAX_TOKENS ?? 800),
    cosyvoiceModel: process.env.COSYVOICE_MODEL ?? 'cosyvoice-v3-flash',
    paraformerModel: process.env.PARAFORMER_MODEL ?? 'paraformer-realtime-v2',
  };
}

// ============== 主流程 ==============

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const env = readEnv();

  console.log('═══════════════════════════════════════════════');
  console.log('  DISC × AI 镜像实验室 - W5 端到端真实冒烟');
  console.log('═══════════════════════════════════════════════');
  console.log(`LLM: ${env.llmModel} @ ${env.llmBaseUrl}`);
  console.log(`ASR: ${env.paraformerModel}`);
  console.log(`TTS: ${env.cosyvoiceModel}`);
  console.log(`Workspace: ${env.dashscopeWorkspaceId || '(未配置)'}`);

  // ===== SKIP 检查 =====
  const reasons: string[] = [];
  if (isPlaceholder(env.dashscopeApiKey)) {
    reasons.push('DASHSCOPE_API_KEY 未配置或为占位值');
  }
  if (isPlaceholder(env.dashscopeWorkspaceId)) {
    reasons.push('DASHSCOPE_WORKSPACE_ID 未配置');
  }
  if (isPlaceholder(env.llmApiKey)) {
    reasons.push('LLM_API_KEY 未配置或为占位值');
  }
  if (reasons.length > 0) {
    console.log('\n⏭️  SKIP 端到端冒烟：');
    for (const r of reasons) console.log(`   - ${r}`);
    console.log('\n   配置方法：复制 .env.example 为 .env，填入真实通义千问 key 与 Workspace ID 后重试。');
    console.log('   真实麦克风测试请用浏览器测试页：pnpm --filter @disc-lab/voice dev');
    process.exit(0);
  }

  // ===== A. 预置音色映射（免费，已实测 maas 端点可用） =====
  console.log('\n[A] VoiceProfileMapper.usePresetVoices 载入 4 个系统预置 voiceId');
  const mapper = new VoiceProfileMapper();
  try {
    mapper.usePresetVoices();
  } catch (err) {
    console.error(`  ❌ usePresetVoices 抛错：${(err as Error).message}`);
    console.error('  e2e 无法继续，退出。');
    process.exit(1);
  }
  const voiceIdMap = mapper.getVoiceIdMap();
  const nonEmpty = (['D', 'I', 'S', 'C'] as const).filter((d) => voiceIdMap[d]).length;
  assert(nonEmpty === 4, `4 个 DISC 型 voiceId 全部非空（实际 ${nonEmpty}/4）`);
  console.log(`  voiceIdMap: ${JSON.stringify(voiceIdMap)}`);

  const persona = PERSONAS[PERSONA_ID];
  if (!persona) {
    console.error(`  ❌ 未找到 persona: ${PERSONA_ID}`);
    process.exit(1);
  }
  const voiceId = mapper.getVoiceId(persona as unknown as VoicePersona);

  // ===== B. EmployeeAgent.respond 真实 LLM 调用 =====
  console.log(`\n[B] EmployeeAgent.respond 真实 LLM 调用（persona=${PERSONA_ID}）`);
  const agent = new EmployeeAgent(
    persona as unknown as ConstructorParameters<typeof EmployeeAgent>[0],
    SCENE_PERF as unknown as ConstructorParameters<typeof EmployeeAgent>[1],
    {
      llm: {
        apiKey: env.llmApiKey,
        baseUrl: env.llmBaseUrl,
        model: env.llmModel,
        temperature: env.llmTemperature,
        maxTokens: env.llmMaxTokens,
      },
      debugPrompt: process.env.DEBUG_PROMPT === 'true',
      debugResponse: process.env.DEBUG_RESPONSE === 'true',
    }
  );

  let reply = '';
  let emotion = '';
  let round = 0;
  try {
    const resp = await agent.respond(USER_TEXT);
    reply = resp.reply;
    emotion = resp.emotion;
    round = resp.round;
  } catch (err) {
    console.error(`  ❌ agent.respond 抛错：${(err as Error).message}`);
    process.exit(1);
  }
  assert(reply.length > 0, `reply 文本非空（长度 ${reply.length}）`);
  assert(emotion.length > 0, `emotion 非空（${emotion}）`);
  assert(round === 1, `round=1（实际 ${round}）`);
  console.log(`  reply: ${reply.slice(0, 80)}${reply.length > 80 ? '...' : ''}`);
  console.log(`  emotion: ${emotion} · round: ${round}`);

  // ===== C. CosyVoiceTTSClient.synthesize 真实合成 =====
  console.log(`\n[C] CosyVoiceTTSClient.synthesize 真实合成 reply 首句`);
  // 取首句（按句号切分，简化）
  const firstSentence = reply.split(/。|！|？|；/)[0] || reply;
  console.log(`  合成文本: ${firstSentence.slice(0, 60)}${firstSentence.length > 60 ? '...' : ''}`);

  const ttsClient = new CosyVoiceTTSClient({
    apiKey: env.dashscopeApiKey,
    workspaceId: env.dashscopeWorkspaceId,
    model: env.cosyvoiceModel,
  });
  let ttsTotalBytes = 0;
  let ttsChunkCount = 0;
  try {
    await ttsClient.synthesize(firstSentence, voiceId, (pcm) => {
      ttsTotalBytes += pcm.byteLength;
      ttsChunkCount++;
    });
  } catch (err) {
    console.error(`  ❌ tts.synthesize 抛错：${(err as Error).message}`);
    process.exit(1);
  }
  assert(ttsChunkCount > 0, `onAudioChunk 回调 ≥1 次（实际 ${ttsChunkCount}）`);
  assert(ttsTotalBytes > 0, `音频累计字节 > 0（实际 ${ttsTotalBytes}）`);
  console.log(`  音频帧数: ${ttsChunkCount} · 累计字节: ${ttsTotalBytes}`);

  // ===== D. （可选）Paraformer ASR 真实识别 =====
  const samplePcm = resolve(__dirname, 'sample.pcm');
  console.log(`\n[D] Paraformer ASR 真实识别（可选，需 tests/sample.pcm）`);
  if (!existsSync(samplePcm)) {
    console.log('  ⏭️  跳过：未找到 tests/sample.pcm（16kHz Int16 PCM）。');
    console.log('     如需测试 ASR 真实链路，请放置预录音频文件到 packages/voice/tests/sample.pcm。');
  } else {
    const stat = statSync(samplePcm);
    console.log(`  找到 sample.pcm（${stat.size} 字节）`);
    const asrClient = new ParaformerASRClient({
      apiKey: env.dashscopeApiKey,
      workspaceId: env.dashscopeWorkspaceId,
      model: env.paraformerModel,
    });
    const pcmBuf = readFileSync(samplePcm);
    const samples = new Int16Array(
      pcmBuf.buffer.slice(pcmBuf.byteOffset, pcmBuf.byteOffset + pcmBuf.byteLength)
    );

    let asrFinalText = '';
    try {
      await asrClient.start({
        onText: (partial) => {
          // 增量文本（不打日志，避免噪声）
        },
        onSentenceEnd: (sentence) => {
          if (sentence) asrFinalText = sentence;
        },
      });
      // 按 3200 采样（200ms）切片推送
      const CHUNK = 3200;
      for (let i = 0; i < samples.length; i += CHUNK) {
        const slice = samples.slice(i, i + CHUNK);
        asrClient.sendAudioChunk(slice);
        // 真实流式：每 chunk 间 sleep 10ms 模拟实时音频
        await new Promise((r) => setTimeout(r, 10));
      }
      await asrClient.finish();
    } catch (err) {
      console.error(`  ❌ ASR 链路抛错：${(err as Error).message}`);
    }
    assert(asrFinalText.length > 0, `ASR 识别文本非空（"${asrFinalText.slice(0, 40)}"）`);
    console.log(`  ASR 识别: ${asrFinalText}`);
  }

  // ===== 汇总 =====
  console.log(`\n========== e2e-runner 汇总 ==========`);
  console.log(`通过 ${passed} / 失败 ${failed}`);
  if (failed > 0) {
    console.error('❌ e2e-runner 未通过');
    process.exit(1);
  }
  console.log('✅ e2e-runner 全部通过');
}

main().catch((err) => {
  console.error('e2e-runner 运行异常:', err);
  process.exit(1);
});
