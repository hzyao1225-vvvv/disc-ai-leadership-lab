/**
 * degradation.test.ts —— 三态状态机 + 网络中断文本缓存 单测
 * 用法: pnpm --filter @disc-lab/voice test:degradation
 *
 * 7 个用例：
 *  1. 拒麦克风 → text（不可逆：后续 recover 不回 voice）
 *  2. ASR 连续 3 次失败 → voice-degraded（scheduleRetry=true；ASR 计数=3）
 *  3. TTS 失败 → voice-degraded（ASR 保留：asrFailures=0；scheduleRetry=true）
 *  4. 网络中断缓存 3 条（VoiceNetworkBuffer push 4 条仅留最近 3 条）
 *  5. 恢复后 flush（VoiceNetworkBuffer flush 返回全部并清空；状态机 recover: voice-degraded→voice）
 *  6. 不可逆降级 voice→text（mic-denied 后，asr-failed/tts-failed/recover 均不转移）
 *  7. voice-degraded→text 不可回退（voice-degraded 下 asr-failed → text，后续 recover 不回 voice）
 */

import {
  VoiceModeStateMachine,
  VoiceNetworkBuffer,
  type DegradationEvent,
} from '../src/degradation.js';

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

const E = {
  mic: (message?: string): DegradationEvent => ({ kind: 'mic-denied', message }),
  asr: (message?: string): DegradationEvent => ({ kind: 'asr-failed', message }),
  tts: (message?: string): DegradationEvent => ({ kind: 'tts-failed', message }),
  net: (message?: string): DegradationEvent => ({ kind: 'network-lost', message }),
  switch: (message?: string): DegradationEvent => ({ kind: 'user-switch', message }),
  recover: (message?: string): DegradationEvent => ({ kind: 'recover', message }),
};

async function main(): Promise<void> {
  // ============== 用例 1：拒麦克风 → text（不可逆） ==============
  console.log('\n[用例 1] 拒麦克风 → text（不可逆）');
  {
    const sm = new VoiceModeStateMachine();
    assertEqual(sm.getState(), 'voice', '初始态 = voice');

    const t = sm.transition(E.mic());
    assert(t !== null, 'mic-denied 触发转移');
    assertEqual(t!.to, 'text', '转移目标 = text');
    assert(t!.reason.includes('麦克风'), 'reason 含"麦克风"');

    // 后续 recover 不应回 voice（text 终态）
    const after = sm.transition(E.recover());
    assertEqual(after, null, 'text 态下 recover 不转移');
    assertEqual(sm.getState(), 'text', '仍为 text');

    // asr/tts 也不转移
    assertEqual(sm.transition(E.asr()), null, 'text 态下 asr-failed 不转移');
    assertEqual(sm.transition(E.tts()), null, 'text 态下 tts-failed 不转移');
  }

  // ============== 用例 2：ASR 连续 3 次失败 → voice-degraded ==============
  console.log('\n[用例 2] ASR 连续 3 次失败 → voice-degraded');
  {
    const sm = new VoiceModeStateMachine(); // 默认阈值 3
    // 第 1 次：未达阈值
    const t1 = sm.transition(E.asr());
    assertEqual(t1, null, '第 1 次 asr-failed 未达阈值（不转移）');
    assertEqual(sm.getState(), 'voice', '第 1 次后仍 voice');
    assertEqual(sm.getAsrFailures(), 1, 'asrFailures=1');

    // 第 2 次：未达阈值
    const t2 = sm.transition(E.asr());
    assertEqual(t2, null, '第 2 次 asr-failed 未达阈值（不转移）');
    assertEqual(sm.getAsrFailures(), 2, 'asrFailures=2');

    // 第 3 次：达阈值 → voice-degraded
    const t3 = sm.transition(E.asr());
    assert(t3 !== null, '第 3 次 asr-failed 触发转移');
    assertEqual(t3!.to, 'voice-degraded', '转移目标 = voice-degraded');
    assertEqual(sm.getState(), 'voice-degraded', '态 = voice-degraded');
    assertEqual(sm.getAsrFailures(), 3, 'asrFailures=3');
    assert(t3!.scheduleRetry === true, 'scheduleRetry=true（外部调度 30s 重试）');
    assert(t3!.reason.includes('3'), 'reason 含失败次数"3"');
  }

  // ============== 用例 3：TTS 失败 → voice-degraded（ASR 保留） ==============
  console.log('\n[用例 3] TTS 失败 → voice-degraded（ASR 保留，asrFailures=0）');
  {
    const sm = new VoiceModeStateMachine();
    // TTS 单次失败即降级（无阈值，与 ASR 不同）
    const t = sm.transition(E.tts());
    assert(t !== null, 'tts-failed 触发转移');
    assertEqual(t!.to, 'voice-degraded', '转移目标 = voice-degraded');
    assertEqual(sm.getState(), 'voice-degraded', '态 = voice-degraded');
    assertEqual(sm.getAsrFailures(), 0, 'ASR 计数=0（保留 ASR，未失败）');
    assertEqual(sm.getTtsFailures(), 1, 'ttsFailures=1');
    assert(t!.scheduleRetry === true, 'scheduleRetry=true');
    assert(t!.reason.includes('TTS'), 'reason 含"TTS"');
  }

  // ============== 用例 4：网络中断缓存 3 条 ==============
  console.log('\n[用例 4] 网络中断缓存 3 条（push 4 条仅留最近 3 条）');
  {
    const buf = new VoiceNetworkBuffer(3);
    assertEqual(buf.size(), 0, '初始 size=0');

    buf.push('文本A');
    buf.push('文本B');
    buf.push('文本C');
    assertEqual(buf.size(), 3, 'push 3 条后 size=3');

    // 第 4 条：丢弃最旧的"文本A"，保留 B/C/D
    buf.push('文本D');
    assertEqual(buf.size(), 3, 'push 第 4 条后仍 size=3（丢弃最旧）');

    // 不切态：network-lost 事件不转移
    const sm = new VoiceModeStateMachine();
    const t = sm.transition(E.net());
    assertEqual(t, null, 'network-lost 不触发态转移');
    assertEqual(sm.getState(), 'voice', '网络中断时态仍 voice（外部处理缓存）');
  }

  // ============== 用例 5：恢复后 flush + recover: voice-degraded → voice ==============
  console.log('\n[用例 5] 恢复后 flush（buffer 清空；状态机 recover: voice-degraded → voice）');
  {
    // 子场景 A：buffer flush 返回全部并清空
    const buf = new VoiceNetworkBuffer(3);
    buf.push('文本B');
    buf.push('文本C');
    buf.push('文本D');
    const flushed = buf.flush();
    assertEqual(flushed.length, 3, 'flush 返回 3 条');
    assertEqual(flushed[0], '文本B', 'flush[0] = 文本B（最早保留）');
    assertEqual(flushed[2], '文本D', 'flush[2] = 文本D（最新）');
    assertEqual(buf.size(), 0, 'flush 后 size=0（清空）');
    // 二次 flush 空数组
    assertEqual(buf.flush().length, 0, '二次 flush 返回空数组');

    // 子场景 B：状态机 recover 从 voice-degraded 回 voice
    const sm = new VoiceModeStateMachine();
    // 先进 voice-degraded（ASR 3 次）
    sm.transition(E.asr());
    sm.transition(E.asr());
    sm.transition(E.asr());
    assertEqual(sm.getState(), 'voice-degraded', '前置：3 次 ASR 失败 → voice-degraded');
    assertEqual(sm.getAsrFailures(), 3, '前置：asrFailures=3');

    const t = sm.transition(E.recover());
    assert(t !== null, 'recover 触发转移');
    assertEqual(t!.to, 'voice', '转移目标 = voice');
    assertEqual(sm.getState(), 'voice', '态恢复 voice');
    assertEqual(sm.getAsrFailures(), 0, 'recover 重置 asrFailures=0');
    assertEqual(sm.getTtsFailures(), 0, 'recover 重置 ttsFailures=0');
  }

  // ============== 用例 6：不可逆降级 voice→text ==============
  console.log('\n[用例 6] 不可逆降级 voice→text（mic-denied 后任何事件不转移）');
  {
    const sm = new VoiceModeStateMachine();
    sm.transition(E.mic());
    assertEqual(sm.getState(), 'text', '前置：mic-denied → text');

    // 各种事件都不应转移
    assertEqual(sm.transition(E.asr()), null, 'asr-failed 不转移');
    assertEqual(sm.transition(E.tts()), null, 'tts-failed 不转移');
    assertEqual(sm.transition(E.net()), null, 'network-lost 不转移');
    assertEqual(sm.transition(E.recover()), null, 'recover 不转移');
    assertEqual(sm.transition(E.switch()), null, 'user-switch 不转移');
    assertEqual(sm.getState(), 'text', '所有事件后仍 text');

    // 只有 reset 能回 voice（用户手动刷新）
    sm.reset();
    assertEqual(sm.getState(), 'voice', 'reset 后回 voice');
  }

  // ============== 用例 7：voice-degraded→text 不可回退 ==============
  console.log('\n[用例 7] voice-degraded→text 不可回退');
  {
    // 子场景 A：voice-degraded 下 asr-failed → text，recover 不回退
    const smA = new VoiceModeStateMachine();
    // 进 voice-degraded（ASR 3 次）
    smA.transition(E.asr());
    smA.transition(E.asr());
    smA.transition(E.asr());
    assertEqual(smA.getState(), 'voice-degraded', '前置 A：voice-degraded');

    // voice-degraded 下再次 asr-failed → text（不可逆）
    const t = smA.transition(E.asr());
    assert(t !== null, 'voice-degraded 下 asr-failed 触发转移');
    assertEqual(t!.to, 'text', '转移目标 = text');
    assertEqual(smA.getState(), 'text', '态 = text');
    // recover 不回退
    assertEqual(smA.transition(E.recover()), null, 'text 下 recover 不转移');

    // 子场景 B：voice-degraded 下 tts-failed → text，recover 不回退
    const smB = new VoiceModeStateMachine();
    // 进 voice-degraded（TTS 1 次）
    smB.transition(E.tts());
    assertEqual(smB.getState(), 'voice-degraded', '前置 B：voice-degraded');

    const t2 = smB.transition(E.tts());
    assert(t2 !== null, 'voice-degraded 下 tts-failed 触发转移');
    assertEqual(t2!.to, 'text', '转移目标 = text');
    assertEqual(smB.getState(), 'text', '态 = text');
    assertEqual(smB.transition(E.recover()), null, 'text 下 recover 不转移');

    // 子场景 C：voice-degraded 下 recover 可回 voice（验证可回退路径存在，对比不可逆）
    const smC = new VoiceModeStateMachine();
    smC.transition(E.tts());
    assertEqual(smC.getState(), 'voice-degraded', '前置 C：voice-degraded');
    const tc = smC.transition(E.recover());
    assert(tc !== null, 'voice-degraded 下 recover 触发转移（可回退路径）');
    assertEqual(tc!.to, 'voice', 'recover 目标 = voice');
  }

  // ============== 汇总 ==============
  console.log(`\n========== degradation.test 汇总 ==========`);
  console.log(`通过 ${passed} / 失败 ${failed}`);
  if (failed > 0) {
    console.error('❌ degradation.test 未通过');
    process.exit(1);
  }
  console.log('✅ degradation.test 全部通过');
}

main().catch((err) => {
  console.error('degradation.test 运行异常:', err);
  process.exit(1);
});
