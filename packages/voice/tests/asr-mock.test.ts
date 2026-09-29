/**
 * asr-mock.test.ts —— Paraformer 流式 ASR 单测（mock ws）
 * 用法: pnpm --filter @disc-lab/voice test:asr
 *
 * 5 个用例：
 *  1. start() 帧序 + run-task payload 正确（task=asr / function=recognition / model / sample_rate）
 *  2. sendAudioChunk 推二进制音频帧 + finish 发 finish-task，整体帧序 run-task → [binary] → finish-task；task-finished 后 finish resolve
 *  3. onText 增量非递减（多次 result-generated text 递增长度，onText 回调次数对应、每次长度 ≥ 上次）
 *  4. onSentenceEnd 触发（sentence-end 事件回调一句；task-finished 尾文本补发）
 *  5. 错误处理：transport onError reject AsrError(code=WS_ERROR)；task-failed reject AsrError(具体 code)
 */

import {
  ParaformerASRClient,
  AsrError,
  buildAsrRunTask,
  buildAsrFinishTask,
  type AsrTransport,
  type AsrTransportHandlers,
} from '../src/dashscope-asr.js';

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

// ============== Mock ASR Transport ==============
type SentItem =
  | { kind: 'text'; data: string }
  | { kind: 'binary'; len: number };

class MockAsrTransport implements AsrTransport {
  sent: SentItem[] = [];
  closed = false;
  readyState = 1;
  private handlers!: AsrTransportHandlers;

  /** 预设：finish-task 后依次发出的 result-generated 文本序列（模拟流式累积） */
  resultTexts: string[] = [];
  /** 是否在最后一句发 sentence-end 标记 */
  emitSentenceEndOnLast = false;
  /** 未结句的尾文本（测试 task-finished 补发 onSentenceEnd） */
  trailingText: string | null = null;
  /** 握手期即失败（onOpen 不触发，改触发 onError）—— 测 start reject */
  failOnOpen: Error | null = null;
  /** finish-task react 时发 task-failed 而非 task-finished —— 测 finish reject */
  failOnFinish: { code: string; message: string } | null = null;

  setHandlers(h: AsrTransportHandlers): void {
    this.handlers = h;
    // 模拟真实 ws 的 open 事件异步触发
    queueMicrotask(() => {
      if (this.failOnOpen) {
        this.handlers.onError(this.failOnOpen);
      } else {
        this.handlers.onOpen();
      }
    });
  }
  send(data: string | ArrayBuffer): void {
    if (typeof data === 'string') {
      this.sent.push({ kind: 'text', data });
      const msg = JSON.parse(data) as { header: { action: string; task_id: string } };
      this.react(msg);
    } else {
      this.sent.push({ kind: 'binary', len: data.byteLength });
    }
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
    } else if (action === 'finish-task') {
      // 依次发预设的 result-generated（模拟流式累积）
      for (let i = 0; i < this.resultTexts.length; i++) {
        const isLast = i === this.resultTexts.length - 1;
        const type =
          this.emitSentenceEndOnLast && isLast ? 'sentence-end' : undefined;
        evt('result-generated', { output: { text: this.resultTexts[i], type } });
      }
      // 尾文本（未结句）—— 测试 task-finished 补发
      if (this.trailingText) {
        evt('result-generated', { output: { text: this.trailingText } });
      }
      if (this.failOnFinish) {
        this.handlers.onText(
          JSON.stringify({
            header: {
              task_id,
              event: 'task-failed',
              error_code: this.failOnFinish.code,
              error_message: this.failOnFinish.message,
            },
            payload: {},
          })
        );
      } else {
        evt('task-finished', {});
      }
    }
    // 音频二进制帧：真实 ASR 在推音频期间就会出 result-generated，
    // 这里简化为 finish-task 时一次性回放，足够验证协议帧序与回调非递减。
  }
}

const CONFIG = {
  apiKey: 'sk-test',
  workspaceId: 'ws-test',
  model: 'paraformer-realtime-v2',
  sampleRate: 16000,
};

async function main(): Promise<void> {
  // ============== 用例 1：start() 帧序 + run-task payload ==============
  console.log('\n[用例 1] start() 发 run-task，payload 含 task=asr/function=recognition/model');
  {
    const mock = new MockAsrTransport();
    const client = new ParaformerASRClient(CONFIG, { createTransport: () => mock });
    let startResolved = false;
    await client
      .start({
        onText: () => {},
        onSentenceEnd: () => {},
      })
      .then(() => {
        startResolved = true;
      });
    // start() resolve 说明 task-started 已到
    assert(startResolved, 'start() 在 task-started 后 resolve');
    // 发了 1 个文本帧（run-task）
    const textFrames = mock.sent.filter((s) => s.kind === 'text');
    assertEqual(textFrames.length, 1, 'start() 仅发 1 个文本帧（run-task）');
    const runTask = JSON.parse((textFrames[0] as { data: string }).data) as {
      header: { action: string };
      payload: {
        task_group: string;
        task: string;
        function: string;
        model: string;
        parameters: { sample_rate: number; format: string };
      };
    };
    assertEqual(runTask.header.action, 'run-task', 'header.action = run-task');
    assertEqual(runTask.payload.task_group, 'audio', 'payload.task_group = audio');
    assertEqual(runTask.payload.task, 'asr', 'payload.task = asr');
    assertEqual(runTask.payload.function, 'recognition', 'payload.function = recognition');
    assertEqual(runTask.payload.model, CONFIG.model, 'payload.model = 配置模型');
    assertEqual(runTask.payload.parameters.sample_rate, 16000, 'parameters.sample_rate = 16000');
    assertEqual(runTask.payload.parameters.format, 'pcm', 'parameters.format = pcm');

    // 帧构造器导出与运行时一致
    const built = buildAsrRunTask('task-1', CONFIG);
    const builtParsed = JSON.parse(built) as { payload: { task: string } };
    assertEqual(builtParsed.payload.task, 'asr', 'buildAsrRunTask 帧含 task=asr');
  }

  // ============== 用例 2：sendAudioChunk + finish 帧序 ==============
  console.log('\n[用例 2] sendAudioChunk 推二进制帧 + finish 发 finish-task，帧序正确');
  {
    const mock = new MockAsrTransport();
    const client = new ParaformerASRClient(CONFIG, { createTransport: () => mock });
    await client.start({ onText: () => {}, onSentenceEnd: () => {} });

    // 推两段音频
    const samples1 = new Int16Array(160); // 10ms@16k
    const samples2 = new Int16Array(320); // 20ms@16k
    client.sendAudioChunk(samples1);
    client.sendAudioChunk(samples2);

    let finishResolved = false;
    await client.finish().then(() => {
      finishResolved = true;
    });
    assert(finishResolved, 'finish() 在 task-finished 后 resolve');

    // 帧序：run-task(文本) → binary → binary → finish-task(文本)
    assertEqual(mock.sent.length, 4, '总发送 4 帧（run + 2 binary + finish）');
    assertEqual(mock.sent[0].kind, 'text', '第 1 帧 = 文本（run-task）');
    assertEqual(mock.sent[1].kind, 'binary', '第 2 帧 = 二进制（音频）');
    assertEqual(mock.sent[2].kind, 'binary', '第 3 帧 = 二进制（音频）');
    assertEqual(mock.sent[3].kind, 'text', '第 4 帧 = 文本（finish-task）');

    // 二进制帧长度与输入一致
    const b1 = mock.sent[1] as { len: number };
    const b2 = mock.sent[2] as { len: number };
    assertEqual(b1.len, samples1.byteLength, '第 1 音频帧字节长度 = Int16Array.byteLength');
    assertEqual(b2.len, samples2.byteLength, '第 2 音频帧字节长度 = Int16Array.byteLength');

    // finish-task 帧结构
    const finishFrame = JSON.parse((mock.sent[3] as { data: string }).data) as {
      header: { action: string };
      payload: { input: Record<string, unknown> };
    };
    assertEqual(finishFrame.header.action, 'finish-task', '末帧 header.action = finish-task');

    // 完成后关闭 transport
    assert(mock.closed, '完成后关闭 transport');

    // buildAsrFinishTask 帧结构一致
    const built = buildAsrFinishTask('task-2');
    const builtParsed = JSON.parse(built) as { header: { action: string } };
    assertEqual(builtParsed.header.action, 'finish-task', 'buildAsrFinishTask 帧含 action=finish-task');
  }

  // ============== 用例 3：onText 增量非递减 ==============
  console.log('\n[用例 3] onText 增量非递减（result-generated text 递增长度）');
  {
    const mock = new MockAsrTransport();
    // 预设三段累积文本（非递减：每次包含之前全部内容）
    mock.resultTexts = ['你', '你好', '你好世界'];
    const client = new ParaformerASRClient(CONFIG, { createTransport: () => mock });

    const textCalls: string[] = [];
    await client.start({
      onText: (partial) => textCalls.push(partial),
      onSentenceEnd: () => {},
    });
    await client.finish();

    assertEqual(textCalls.length, 3, 'onText 回调 3 次');
    // 非递减：每次 text 长度 ≥ 上次，且后一次以前一次为前缀（句子级累积语义）
    let nonDecreasing = true;
    for (let i = 1; i < textCalls.length; i++) {
      if (textCalls[i].length < textCalls[i - 1].length) {
        nonDecreasing = false;
        break;
      }
      if (!textCalls[i].startsWith(textCalls[i - 1])) {
        nonDecreasing = false;
        break;
      }
    }
    assert(nonDecreasing, 'onText 每次长度非递减且后一次包含前一次内容');
    assertEqual(textCalls[0], '你', '第 1 次 onText = "你"');
    assertEqual(textCalls[2], '你好世界', '第 3 次 onText = "你好世界"');
  }

  // ============== 用例 4：onSentenceEnd 触发 + task-finished 补发 ==============
  console.log('\n[用例 4] onSentenceEnd 触发（sentence-end + 尾文本补发）');
  {
    // 子场景 A：sentence-end 标记触发
    const mockA = new MockAsrTransport();
    mockA.resultTexts = ['你好世界'];
    mockA.emitSentenceEndOnLast = true;
    const clientA = new ParaformerASRClient(CONFIG, { createTransport: () => mockA });
    const sentenceA: string[] = [];
    await clientA.start({
      onText: () => {},
      onSentenceEnd: (s) => sentenceA.push(s),
    });
    await clientA.finish();
    assertEqual(sentenceA.length, 1, 'A: sentence-end 触发 1 次 onSentenceEnd');
    assertEqual(sentenceA[0], '你好世界', 'A: onSentenceEnd 内容 = "你好世界"');

    // 子场景 B：未结句尾文本，task-finished 补发
    const mockB = new MockAsrTransport();
    mockB.resultTexts = ['已完成句。']; // 这句有 sentence-end（emitSentenceEndOnLast=true）
    mockB.emitSentenceEndOnLast = true;
    mockB.trailingText = '未完成句'; // 尾文本无 sentence-end
    const clientB = new ParaformerASRClient(CONFIG, { createTransport: () => mockB });
    const sentenceB: string[] = [];
    await clientB.start({
      onText: () => {},
      onSentenceEnd: (s) => sentenceB.push(s),
    });
    await clientB.finish();
    assertEqual(sentenceB.length, 2, 'B: onSentenceEnd 共 2 次（1 句末 + 1 尾文本补发）');
    assertEqual(sentenceB[0], '已完成句。', 'B: 第 1 次 = 已完成句');
    assertEqual(sentenceB[1], '未完成句', 'B: 第 2 次 = 尾文本补发');
  }

  // ============== 用例 5：错误处理 ==============
  console.log('\n[用例 5] 错误处理（onError reject AsrError；task-failed reject AsrError）');
  {
    // 子场景 A：start 期间 transport onError → start reject AsrError(WS_ERROR)
    const mockA = new MockAsrTransport();
    mockA.failOnOpen = new Error('连接被重置');
    const clientA = new ParaformerASRClient(CONFIG, { createTransport: () => mockA });
    let aError: AsrError | null = null;
    try {
      await clientA.start({ onText: () => {}, onSentenceEnd: () => {} });
    } catch (e) {
      aError = e as AsrError;
    }
    assert(aError !== null, 'A: start() 被 reject');
    assert(aError instanceof AsrError, 'A: reject 的是 AsrError 实例');
    assertEqual(aError!.code, 'WS_ERROR', 'A: AsrError.code = WS_ERROR');
    // 连接失败时不应发送任何 run-task 帧
    assertEqual(mockA.sent.length, 0, 'A: 连接失败前未发送任何帧');

    // 子场景 B：finish-task → task-failed → finish reject AsrError(具体 code)
    const mockB = new MockAsrTransport();
    mockB.failOnFinish = { code: 'ASR_AUDIO_FORMAT', message: '音频格式不支持' };
    const clientB = new ParaformerASRClient(CONFIG, { createTransport: () => mockB });
    await clientB.start({ onText: () => {}, onSentenceEnd: () => {} });
    clientB.sendAudioChunk(new Int16Array(160));
    let bError: AsrError | null = null;
    try {
      await clientB.finish();
    } catch (e) {
      bError = e as AsrError;
    }
    assert(bError !== null, 'B: finish() 被 reject（task-failed）');
    assert(bError instanceof AsrError, 'B: reject 的是 AsrError 实例');
    assertEqual(bError!.code, 'ASR_AUDIO_FORMAT', 'B: AsrError.code = 服务端 error_code');
    assert(mockB.closed, 'B: task-failed 后关闭 transport');
  }

  // ============== 汇总 ==============
  console.log(`\n========== asr-mock.test 汇总 ==========`);
  console.log(`通过 ${passed} / 失败 ${failed}`);
  if (failed > 0) {
    console.error('❌ asr-mock.test 未通过');
    process.exit(1);
  }
  console.log('✅ asr-mock.test 全部通过');
}

main().catch((err) => {
  console.error('asr-mock.test 运行异常:', err);
  process.exit(1);
});
