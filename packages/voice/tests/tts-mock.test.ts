/**
 * tts-mock.test.ts —— CosyVoice TTS + 声音设计 单测（mock）
 * 用法: pnpm --filter @disc-lab/voice test:tts
 *
 * 5 个用例：
 *  1. 声音设计 HTTP payload 含自然语言描述（voice_prompt=description）+ 结构正确
 *  2. 声音设计返回 voice_id（createDashscopeVoiceDesignFn 返回值正确）
 *  3. voiceId 缓存命中跳过创建（mapper + cache，第二次 httpPost 0 调用）
 *  4. synthesize 流式：帧序 run-task→continue-task→finish-task，onAudioChunk ≥1
 *  5. 空文本不合成（transport 工厂不被调用、onAudioChunk 0）
 */

import {
  CosyVoiceTTSClient,
  TtsError,
  createDashscopeVoiceDesignFn,
  buildRunTask,
} from '../src/dashscope-tts.js';
import type { TtsTransport, TtsTransportHandlers } from '../src/dashscope-tts.js';
import { VoiceProfileMapper } from '../src/voice-profile-mapper.js';
import type { VoiceCacheStore, VoiceCacheFile } from '../src/types.js';
import { PERSONAS } from '@disc-lab/agent/personas';

// ============== 极简测试桩 ==============
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
function assertEqual<T>(actual: T, expected: T, msg: string): void {
  assert(actual === expected, `${msg} (期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)})`);
}

// ============== in-memory 缓存 ==============
class MemoryCacheStore implements VoiceCacheStore {
  private file: VoiceCacheFile | null = null;
  read(): VoiceCacheFile | null {
    return this.file;
  }
  write(file: VoiceCacheFile): void {
    this.file = JSON.parse(JSON.stringify(file)) as VoiceCacheFile;
  }
}

// ============== Mock WS Transport ==============
class MockTtsTransport implements TtsTransport {
  sent: string[] = [];
  closed = false;
  readyState = 1;
  private handlers!: TtsTransportHandlers;
  setHandlers(h: TtsTransportHandlers): void {
    this.handlers = h;
    // 模拟真实 ws 的 open 事件异步触发
    queueMicrotask(() => this.handlers.onOpen());
  }
  send(data: string | ArrayBuffer): void {
    const str = typeof data === 'string' ? data : '[binary]';
    this.sent.push(str);
    const msg = JSON.parse(str) as { header: { action: string; task_id: string } };
    this.react(msg);
  }
  close(): void {
    this.closed = true;
  }
  private react(msg: { header: { action: string; task_id: string } }): void {
    const { action, task_id } = msg.header;
    const evt = (event: string, payload: unknown): void => {
      this.handlers.onText(JSON.stringify({ header: { task_id, event }, payload }));
    };
    if (action === 'run-task') {
      evt('task-started', {});
    } else if (action === 'continue-task') {
      evt('result-generated', { output: { type: 'sentence-begin' } });
      // 模拟一帧音频
      this.handlers.onBinary(new ArrayBuffer(16));
      evt('result-generated', { output: { type: 'sentence-end' } });
    } else if (action === 'finish-task') {
      evt('task-finished', { usage: { characters: 4 } });
    }
  }
}

const CONFIG = { apiKey: 'sk-test', workspaceId: 'ws-test', model: 'cosyvoice-v3-flash' };

async function main(): Promise<void> {
  // ============== 用例 1：声音设计 payload 含自然语言描述 ==============
  console.log('\n[用例 1] 声音设计 HTTP payload 含自然语言描述');
  {
    let capturedUrl = '';
    let capturedBody = '';
    const mockHttpPost = async (
      url: string,
      opts: { method: string; headers: Record<string, string>; body: string }
    ) => {
      capturedUrl = url;
      capturedBody = opts.body;
      return {
        ok: true,
        status: 200,
        json: async () => ({ output: { voice_id: 'cosyvoice-v3-flash-vd-discd-abc123' } }),
        text: async () => '',
      };
    };
    const designFn = createDashscopeVoiceDesignFn(CONFIG, { httpPost: mockHttpPost });
    const description = '沉稳有力、磁性强，语速偏快，低沉';
    const voiceId = await designFn({
      disc: 'D',
      description,
      model: CONFIG.model,
    });

    // URL 正确（声音设计 HTTP 端点）
    assert(
      capturedUrl ===
        'https://ws-test.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/customization',
      '声音设计 URL 指向 maas customization 端点'
    );
    const body = JSON.parse(capturedBody) as {
      model: string;
      input: { action: string; target_model: string; voice_prompt: string; preview_text: string; prefix: string };
    };
    assertEqual(body.model, 'voice-enrollment', 'body.model = voice-enrollment');
    assertEqual(body.input.action, 'create_voice', 'input.action = create_voice');
    assertEqual(body.input.target_model, CONFIG.model, 'input.target_model 与配置一致');
    // 核心：自然语言描述进入 voice_prompt
    assertEqual(body.input.voice_prompt, description, 'input.voice_prompt = 自然语言描述');
    assert(body.input.preview_text.length >= 15, 'preview_text ≥15 字符（API 要求）');
    assert(/^[a-z0-9]+$/.test(body.input.prefix), 'prefix 仅字母数字');

    // 用例 2：返回值正确
    console.log('\n[用例 2] 声音设计返回 voice_id');
    assertEqual(voiceId, 'cosyvoice-v3-flash-vd-discd-abc123', 'designFn 返回 voice_id');
  }

  // ============== 用例 3：缓存命中跳过创建 ==============
  console.log('\n[用例 3] voiceId 缓存命中跳过创建');
  {
    let httpCalls = 0;
    const mockHttpPost = async () => {
      httpCalls++;
      return {
        ok: true,
        status: 200,
        json: async () => ({ output: { voice_id: `vd-${httpCalls}` } }),
        text: async () => '',
      };
    };
    const designFn = createDashscopeVoiceDesignFn(CONFIG, { httpPost: mockHttpPost });
    const cache = new MemoryCacheStore();
    const personas = PERSONAS as unknown as Record<string, import('../src/types.js').VoicePersona>;

    const m1 = new VoiceProfileMapper();
    await m1.initialize({ personas, voiceDesignFn: designFn, cacheStore: cache, model: CONFIG.model });
    assertEqual(httpCalls, 4, '首次 initialize 调声音设计 4 次（4 DISC 型）');

    httpCalls = 0;
    const m2 = new VoiceProfileMapper();
    await m2.initialize({ personas, voiceDesignFn: designFn, cacheStore: cache, model: CONFIG.model });
    assertEqual(httpCalls, 0, '缓存命中：第二次 initialize 调声音设计 0 次');

    // 映射一致
    assert(
      m1.getVoiceIdMap().D === m2.getVoiceIdMap().D &&
        m1.getVoiceIdMap().I === m2.getVoiceIdMap().I,
      '缓存命中后映射与首次一致'
    );
  }

  // ============== 用例 4：synthesize 流式帧序 + onAudioChunk ≥1 ==============
  console.log('\n[用例 4] synthesize 流式：帧序正确、onAudioChunk ≥1');
  {
    const mock = new MockTtsTransport();
    let audioCalls = 0;
    let audioBytes = 0;
    const client = new CosyVoiceTTSClient(CONFIG, {
      createTransport: () => mock,
    });
    await client.synthesize(
      '你好，这是一段测试语音。',
      'vd-test',
      (pcm) => {
        audioCalls++;
        audioBytes += pcm.byteLength;
      }
    );

    // 帧序：run-task → continue-task → finish-task
    assertEqual(mock.sent.length, 3, '发送 3 个文本帧（run/continue/finish）');
    const actions = mock.sent.map((s) => (JSON.parse(s) as { header: { action: string } }).header.action);
    assertEqual(actions[0], 'run-task', '首帧为 run-task');
    assertEqual(actions[1], 'continue-task', '次帧为 continue-task');
    assertEqual(actions[2], 'finish-task', '末帧为 finish-task');

    // run-task 含 voice/model
    const runTask = JSON.parse(mock.sent[0]) as ReturnType<typeof JSON.parse>;
    assert(runTask.payload.parameters.voice === 'vd-test', 'run-task.parameters.voice = voiceId');
    assert(runTask.payload.model === CONFIG.model, 'run-task.payload.model = 配置模型');
    // continue-task 含文本
    const cont = JSON.parse(mock.sent[1]) as { payload: { input: { text: string } } };
    assert(cont.payload.input.text === '你好，这是一段测试语音。', 'continue-task.input.text = 合成文本');

    assert(audioCalls >= 1, 'onAudioChunk 至少回调 1 次');
    assert(audioBytes > 0, '音频累计字节 > 0');
    assert(mock.closed, '完成后关闭 transport');
  }

  // ============== 用例 5：空文本不合成 ==============
  console.log('\n[用例 5] 空文本不合成');
  {
    let transportCreated = false;
    let audioCalls = 0;
    const client = new CosyVoiceTTSClient(CONFIG, {
      createTransport: () => {
        transportCreated = true;
        return new MockTtsTransport();
      },
    });
    // 不应抛错
    await client.synthesize('', 'vd-test', () => {
      audioCalls++;
    });
    assert(!transportCreated, '空文本不创建 transport（短路）');
    assertEqual(audioCalls, 0, '空文本 onAudioChunk 0 次');

    // 仅空白也短路
    await client.synthesize('   \n  ', 'vd-test', () => {
      audioCalls++;
    });
    assertEqual(audioCalls, 0, '纯空白文本同样不合成');
  }

  // ============== 汇总 ==============
  console.log(`\n========== tts-mock.test 汇总 ==========`);
  console.log(`通过 ${passed} / 失败 ${failed}`);
  if (failed > 0) {
    console.error('❌ tts-mock.test 未通过');
    process.exit(1);
  }
  console.log('✅ tts-mock.test 全部通过');
}

main().catch((err) => {
  console.error('tts-mock.test 运行异常:', err);
  process.exit(1);
});
