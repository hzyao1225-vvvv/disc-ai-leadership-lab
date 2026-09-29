/**
 * pipeline.test.ts —— VoicePipeline 编排单测（mock ASR/agent/TTS）
 * 用法: pnpm --filter @disc-lab/voice test:pipeline
 *
 * 6 个用例：
 *  1. ASR 句末 → agent.respond → TTS 顺序正确（onReply 在 onAudioChunk 之前；agent 调用次数=1）
 *  2. 并发请求入队（busy 时第 2 次 handleUserText 排队，第 1 轮结束后串行处理）
 *  3. agent 抛错 → pipeline 转 voice-degraded + onModeChange + 不送 TTS（onAudioChunk 0）
 *  4. TTS 音频累计长度 > 0（多句 reply → 多段音频，累计 byteLength > 0）
 *  5. TTS 抛错 → voice-degraded + onModeChange + onAudioEnd（若有部分音频）+ onReply 仍发出
 *  6. 空文本不触发 TTS（handleUserText 空串 → onReply 0 / onAudioChunk 0，返回 true）
 */

import { VoicePipeline, splitSentences, type AgentLike, type AgentResponseSubset } from '../src/voice-pipeline.js';
import type { ParaformerASRClient, AsrCallbacks } from '../src/dashscope-asr.js';
import type { CosyVoiceTTSClient } from '../src/dashscope-tts.js';

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
  assert(
    actual === expected,
    `${msg} (期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)})`
  );
}

// ============== Mock Agent ==============
class MockAgent implements AgentLike {
  calls: string[] = [];
  shouldThrow = false;
  reply = '好的，我明白了。这是您的回复。';
  emotion = 'neutral';
  round = 1;
  async respond(text: string): Promise<AgentResponseSubset> {
    this.calls.push(text);
    if (this.shouldThrow) {
      throw new Error('agent.respond 模拟失败');
    }
    return { reply: this.reply, emotion: this.emotion, round: this.round };
  }
}

// ============== Mock TTS ==============
class MockTTS {
  calls: string[] = [];
  shouldThrow = false;
  /** 每句产生几个音频帧、每帧多少字节 */
  framesPerSentence = 2;
  frameBytes = 64;
  async synthesize(
    text: string,
    _voiceId: string,
    onAudioChunk: (pcm: ArrayBuffer) => void
  ): Promise<void> {
    this.calls.push(text);
    if (this.shouldThrow) {
      throw new Error('tts.synthesize 模拟失败');
    }
    // 空文本不合成（与真实 CosyVoiceTTSClient 行为一致）
    if (!text.trim()) return;
    for (let i = 0; i < this.framesPerSentence; i++) {
      onAudioChunk(new ArrayBuffer(this.frameBytes));
    }
  }
}

// ============== Mock ASR（不真正连，只记录 start/finish） ==============
class MockASR {
  startCalls = 0;
  finishCalls = 0;
  finishShouldThrow = false;
  private callbacks: AsrCallbacks | null = null;
  async start(callbacks: AsrCallbacks): Promise<void> {
    this.startCalls++;
    this.callbacks = callbacks;
  }
  sendAudioChunk(_samples: Int16Array): void {}
  async finish(): Promise<void> {
    this.finishCalls++;
    if (this.finishShouldThrow) {
      throw new Error('会话未开始，无法结束（模拟 finish 失败）');
    }
    this.callbacks = null;
  }
  /** 测试注入：触发一句完整结束 */
  emitSentenceEnd(text: string): void {
    this.callbacks?.onSentenceEnd(text);
  }
  emitPartial(text: string): void {
    this.callbacks?.onText(text);
  }
}

// ============== 回调记录器 ==============
interface RecordedCall {
  type: 'reply' | 'audio' | 'audioEnd' | 'mode' | 'error' | 'partial';
  payload?: unknown;
}
function makeRecorder() {
  const calls: RecordedCall[] = [];
  return {
    calls,
    cb: {
      onAsrPartial: (text: string) => calls.push({ type: 'partial', payload: text }),
      onReply: (text: string, emotion: string, round: number) =>
        calls.push({ type: 'reply', payload: { text, emotion, round } }),
      onAudioChunk: (pcm: ArrayBuffer) =>
        calls.push({ type: 'audio', payload: pcm.byteLength }),
      onAudioEnd: () => calls.push({ type: 'audioEnd' }),
      onModeChange: (mode: string, reason: string) =>
        calls.push({ type: 'mode', payload: { mode, reason } }),
      onError: (err: Error) => calls.push({ type: 'error', payload: err.message }),
    },
  };
}

async function main(): Promise<void> {
  // ============== 用例 1：ASR 句末 → agent.respond → TTS 顺序 ==============
  console.log('\n[用例 1] ASR 句末 → agent.respond → TTS 顺序正确');
  {
    const agent = new MockAgent();
    const tts = new MockTTS();
    const asr = new MockASR();
    const rec = makeRecorder();
    const pipeline = new VoicePipeline(
      {
        asrClient: asr as unknown as ParaformerASRClient,
        ttsClient: tts as unknown as CosyVoiceTTSClient,
        agent,
        voiceId: 'vd-test',
      },
      rec.cb
    );

    // 直接调 handleUserText（模拟 ASR 句末触发）
    const ok = await pipeline.handleUserText('我想和你谈谈绩效');
    assertEqual(ok, true, 'handleUserText 返回 true（已处理）');
    assertEqual(agent.calls.length, 1, 'agent.respond 调用 1 次');
    assertEqual(agent.calls[0], '我想和你谈谈绩效', 'agent 收到用户文本');
    assertEqual(tts.calls.length, 2, 'tts.synthesize 调用 2 次（reply 含 2 个句号切 2 句）');

    // 顺序：onReply 在所有 onAudio 之前
    const replyIdx = rec.calls.findIndex((c) => c.type === 'reply');
    const firstAudioIdx = rec.calls.findIndex((c) => c.type === 'audio');
    assert(replyIdx >= 0, '有 onReply 调用');
    assert(firstAudioIdx >= 0, '有 onAudioChunk 调用');
    assert(replyIdx < firstAudioIdx, 'onReply 在首个 onAudioChunk 之前');

    // onAudioEnd 在最后
    const lastCall = rec.calls[rec.calls.length - 1];
    assertEqual(lastCall.type, 'audioEnd', '最后一个回调 = onAudioEnd');

    // reply 内容正确
    const replyCall = rec.calls.find((c) => c.type === 'reply') as
      | { type: 'reply'; payload: { text: string; emotion: string; round: number } }
      | undefined;
    assertEqual(replyCall!.payload.text, agent.reply, 'onReply 文本 = agent.reply');
    assertEqual(replyCall!.payload.emotion, agent.emotion, 'onReply emotion = agent.emotion');
    assertEqual(replyCall!.payload.round, agent.round, 'onReply round = agent.round');
  }

  // ============== 用例 2：并发请求被拒 ==============
  console.log('\n[用例 2] 并发请求被拒（busy 时第 2 次返回 false）');
  {
    const agent = new MockAgent();
    // 让 respond 慢一点，确保第一个未完成
    const origRespond = agent.respond.bind(agent);
    agent.respond = async (text: string) => {
      await new Promise((r) => setTimeout(r, 50));
      return origRespond(text);
    };
    const tts = new MockTTS();
    const asr = new MockASR();
    const rec = makeRecorder();
    const pipeline = new VoicePipeline(
      {
        asrClient: asr as unknown as ParaformerASRClient,
        ttsClient: tts as unknown as CosyVoiceTTSClient,
        agent,
        voiceId: 'vd-test',
      },
      rec.cb
    );

    // 第 1 次（异步，立即 fire）
    const p1 = pipeline.handleUserText('第一句');
    // 第 2 次立即调（第 1 次已同步设 busy=true）
    const ok2 = await pipeline.handleUserText('第二句');
    assertEqual(ok2, true, 'busy 时第 2 次 handleUserText 排队，返回 true');

    await p1;
    assertEqual(agent.calls.length, 2, '两句都送进 agent（排队串行处理）');
    assertEqual(agent.calls[0], '第一句', 'agent 先收到"第一句"');
    assertEqual(agent.calls[1], '第二句', 'agent 再收到"第二句"');
  }

  // ============== 用例 3：agent 抛错 → voice-degraded + 不送 TTS ==============
  console.log('\n[用例 3] agent 抛错 → voice-degraded + onModeChange + onAudioChunk 0');
  {
    const agent = new MockAgent();
    agent.shouldThrow = true;
    const tts = new MockTTS();
    const asr = new MockASR();
    const rec = makeRecorder();
    const pipeline = new VoicePipeline(
      {
        asrClient: asr as unknown as ParaformerASRClient,
        ttsClient: tts as unknown as CosyVoiceTTSClient,
        agent,
        voiceId: 'vd-test',
      },
      rec.cb
    );

    const ok = await pipeline.handleUserText('触发 agent 错误');
    assertEqual(ok, true, 'handleUserText 返回 true（已处理错误路径）');
    assertEqual(pipeline.getMode(), 'voice-degraded', '模式切到 voice-degraded');
    assertEqual(tts.calls.length, 0, 'agent 抛错时不送 TTS（tts.synthesize 0 次）');
    const audioCalls = rec.calls.filter((c) => c.type === 'audio');
    assertEqual(audioCalls.length, 0, 'onAudioChunk 0 次（不送 TTS）');
    const modeCalls = rec.calls.filter((c) => c.type === 'mode');
    assertEqual(modeCalls.length, 1, 'onModeChange 调用 1 次');
    assertEqual(
      (modeCalls[0].payload as { mode: string }).mode,
      'voice-degraded',
      'onModeChange 目标 = voice-degraded'
    );
    const errorCalls = rec.calls.filter((c) => c.type === 'error');
    assertEqual(errorCalls.length, 1, 'onError 调用 1 次');
    assert(!pipeline.isBusy(), '错误路径后 busy=false（释放）');
  }

  // ============== 用例 4：TTS 音频累计长度 > 0（多句 reply） ==============
  console.log('\n[用例 4] TTS 音频累计长度 > 0（多句 reply → 多段音频）');
  {
    const agent = new MockAgent();
    agent.reply = '第一句。第二句！第三句？'; // 切成 3 句
    const tts = new MockTTS();
    tts.framesPerSentence = 2;
    tts.frameBytes = 100;
    const asr = new MockASR();
    const rec = makeRecorder();
    const pipeline = new VoicePipeline(
      {
        asrClient: asr as unknown as ParaformerASRClient,
        ttsClient: tts as unknown as CosyVoiceTTSClient,
        agent,
        voiceId: 'vd-test',
      },
      rec.cb
    );

    await pipeline.handleUserText('多句测试');

    // 切句：3 句
    assertEqual(tts.calls.length, 3, 'tts.synthesize 调用 3 次（3 句）');
    assertEqual(tts.calls[0], '第一句。', '第 1 句含标点');
    assertEqual(tts.calls[1], '第二句！', '第 2 句含标点');
    assertEqual(tts.calls[2], '第三句？', '第 3 句含标点');

    const audioCalls = rec.calls.filter((c) => c.type === 'audio');
    assertEqual(audioCalls.length, 6, 'onAudioChunk 6 次（3 句 × 2 帧）');
    const totalBytes = audioCalls.reduce(
      (sum, c) => sum + (c.payload as number),
      0
    );
    assert(totalBytes > 0, '音频累计字节 > 0');
    assertEqual(totalBytes, 600, '累计字节 = 6×100 = 600');

    // onAudioEnd 在最后
    const lastCall = rec.calls[rec.calls.length - 1];
    assertEqual(lastCall.type, 'audioEnd', '最后回调 = onAudioEnd');
  }

  // ============== 用例 5：TTS 抛错 → voice-degraded + onReply 仍发出 ==============
  console.log('\n[用例 5] TTS 抛错 → voice-degraded + onReply 仍发出 + onAudioEnd（部分音频）');
  {
    const agent = new MockAgent();
    agent.reply = '第一句。第二句。'; // 2 句
    const tts = new MockTTS();
    // 第 1 句成功，第 2 句抛错
    let synthCount = 0;
    const origSynth = tts.synthesize.bind(tts);
    tts.synthesize = async (
      text: string,
      voiceId: string,
      onAudioChunk: (pcm: ArrayBuffer) => void
    ) => {
      synthCount++;
      if (synthCount === 2) {
        tts.shouldThrow = true; // 第 2 句抛错
      }
      try {
        return await origSynth(text, voiceId, onAudioChunk);
      } finally {
        tts.shouldThrow = false;
      }
    };
    const asr = new MockASR();
    const rec = makeRecorder();
    const pipeline = new VoicePipeline(
      {
        asrClient: asr as unknown as ParaformerASRClient,
        ttsClient: tts as unknown as CosyVoiceTTSClient,
        agent,
        voiceId: 'vd-test',
      },
      rec.cb
    );

    await pipeline.handleUserText('TTS 部分失败');

    assertEqual(pipeline.getMode(), 'voice-degraded', '模式切到 voice-degraded');
    // onReply 在 TTS 之前已发出
    const replyCalls = rec.calls.filter((c) => c.type === 'reply');
    assertEqual(replyCalls.length, 1, 'onReply 仍发出 1 次（文本优先）');
    // 部分音频（第 1 句成功）
    const audioCalls = rec.calls.filter((c) => c.type === 'audio');
    assert(audioCalls.length > 0, '有部分音频（第 1 句成功）');
    assertEqual(audioCalls.length, 2, '部分音频 = 2 帧（第 1 句 2 帧）');
    // onAudioEnd 发出（因为部分音频已推送）
    const endCalls = rec.calls.filter((c) => c.type === 'audioEnd');
    assertEqual(endCalls.length, 1, 'onAudioEnd 调用 1 次（部分音频后）');
    // onModeChange
    const modeCalls = rec.calls.filter((c) => c.type === 'mode');
    assertEqual(modeCalls.length, 1, 'onModeChange 调用 1 次');
    // onError
    const errorCalls = rec.calls.filter((c) => c.type === 'error');
    assertEqual(errorCalls.length, 1, 'onError 调用 1 次');
    assert(!pipeline.isBusy(), '错误路径后 busy=false');
  }

  // ============== 用例 6：空文本不触发 TTS ==============
  console.log('\n[用例 6] 空文本不触发 TTS（onReply 0 / onAudioChunk 0，返回 true）');
  {
    const agent = new MockAgent();
    const tts = new MockTTS();
    const asr = new MockASR();
    const rec = makeRecorder();
    const pipeline = new VoicePipeline(
      {
        asrClient: asr as unknown as ParaformerASRClient,
        ttsClient: tts as unknown as CosyVoiceTTSClient,
        agent,
        voiceId: 'vd-test',
      },
      rec.cb
    );

    // 空串
    const ok1 = await pipeline.handleUserText('');
    assertEqual(ok1, true, '空文本返回 true（不处理但不算拒绝）');
    assertEqual(agent.calls.length, 0, '空文本不调 agent');
    assertEqual(tts.calls.length, 0, '空文本不调 tts');

    // 纯空白
    const ok2 = await pipeline.handleUserText('   \n  ');
    assertEqual(ok2, true, '纯空白返回 true');
    assertEqual(agent.calls.length, 0, '纯空白不调 agent');
    assertEqual(tts.calls.length, 0, '纯空白不调 tts');

    // onReply 0 次
    const replyCalls = rec.calls.filter((c) => c.type === 'reply');
    assertEqual(replyCalls.length, 0, '空文本 onReply 0 次');
    const audioCalls = rec.calls.filter((c) => c.type === 'audio');
    assertEqual(audioCalls.length, 0, '空文本 onAudioChunk 0 次');
  }

  // ============== 用例 7：一次发言多句 ASR 分句 → 合并为一轮回复 ==============
  console.log('\n[用例 7] 一次发言多句 ASR 分句 → 合并为一轮回复（有问有答）');
  {
    const agent = new MockAgent();
    const tts = new MockTTS();
    const asr = new MockASR();
    const rec = makeRecorder();
    const pipeline = new VoicePipeline(
      {
        asrClient: asr as unknown as ParaformerASRClient,
        ttsClient: tts as unknown as CosyVoiceTTSClient,
        agent,
        voiceId: 'vd-test',
      },
      rec.cb
    );

    await pipeline.startVoiceSession();
    // 一次发言被 ASR 切成 3 句
    asr.emitSentenceEnd('你有什么想跟我说的吗。');
    asr.emitSentenceEnd('结论已经定了。');
    asr.emitSentenceEnd('我们做个业绩回顾。');
    assertEqual(agent.calls.length, 0, '句末不立即触发回复');

    // VAD 判定发言结束 → audio-end → endVoiceSession 触发合并回复
    await pipeline.endVoiceSession();
    await new Promise((r) => setTimeout(r, 20)); // flush 是 fire-and-forget，等一轮完成
    assertEqual(agent.calls.length, 1, '一次发言只触发 1 轮回复');
    assertEqual(
      agent.calls[0],
      '你有什么想跟我说的吗。结论已经定了。我们做个业绩回顾。',
      '多句合并为一条文本送 agent'
    );

    // 下一轮发言：缓冲已清空，不重复
    await pipeline.startVoiceSession();
    asr.emitSentenceEnd('好的。');
    await pipeline.endVoiceSession();
    await new Promise((r) => setTimeout(r, 20));
    assertEqual(agent.calls.length, 2, '下一轮发言正常触发第 2 轮');
    assertEqual(agent.calls[1], '好的。', '第 2 轮只含本轮内容');

    // flush:false（ws 关闭路径）不触发回复
    await pipeline.startVoiceSession();
    asr.emitSentenceEnd('这句话不该回复。');
    await pipeline.endVoiceSession({ flush: false });
    await new Promise((r) => setTimeout(r, 20));
    assertEqual(agent.calls.length, 2, 'flush:false 时缓冲被丢弃，不调 agent');
  }

  // ============== 用例 8：ASR finish 抛错时仍 flush 缓冲（防"一直监听中"） ==============
  console.log('\n[用例 8] ASR finish 抛错时仍 flush 缓冲');
  {
    const agent = new MockAgent();
    const tts = new MockTTS();
    const asr = new MockASR();
    asr.finishShouldThrow = true;
    const rec = makeRecorder();
    const pipeline = new VoicePipeline(
      {
        asrClient: asr as unknown as ParaformerASRClient,
        ttsClient: tts as unknown as CosyVoiceTTSClient,
        agent,
        voiceId: 'vd-test',
      },
      rec.cb
    );

    await pipeline.startVoiceSession();
    asr.emitSentenceEnd('这句不能因为 finish 失败而丢掉。');
    await pipeline.endVoiceSession(); // finish 抛错但应被吞掉并继续 flush
    await new Promise((r) => setTimeout(r, 20));
    assertEqual(agent.calls.length, 1, 'finish 抛错仍触发 1 轮回复');
    assertEqual(agent.calls[0], '这句不能因为 finish 失败而丢掉。', '缓冲文本未丢失');
  }

  // ============== 用例 9：发言结束但 ASR 无识别结果 → onError 提示（不沉默） ==============
  console.log('\n[用例 9] ASR 无识别结果时 onError 提示');
  {
    const agent = new MockAgent();
    const tts = new MockTTS();
    const asr = new MockASR();
    const rec = makeRecorder();
    const pipeline = new VoicePipeline(
      {
        asrClient: asr as unknown as ParaformerASRClient,
        ttsClient: tts as unknown as CosyVoiceTTSClient,
        agent,
        voiceId: 'vd-test',
      },
      rec.cb
    );

    await pipeline.startVoiceSession();
    await pipeline.endVoiceSession(); // 无任何句子
    await new Promise((r) => setTimeout(r, 20));
    assertEqual(agent.calls.length, 0, '无识别不调 agent');
    const errs = rec.calls.filter((c) => c.type === 'error');
    assertEqual(errs.length, 1, 'onError 提示 1 次');
    assert(
      String(errs[0]?.payload).includes('没有识别到说话内容'),
      `提示语包含"没有识别到说话内容"，实际: ${JSON.stringify(errs[0]?.payload)}`
    );
  }

  // ============== 汇总 ==============
  console.log(`\n========== pipeline.test 汇总 ==========`);
  console.log(`通过 ${passed} / 失败 ${failed}`);
  if (failed > 0) {
    console.error('❌ pipeline.test 未通过');
    process.exit(1);
  }
  console.log('✅ pipeline.test 全部通过');
}

main().catch((err) => {
  console.error('pipeline.test 运行异常:', err);
  process.exit(1);
});
