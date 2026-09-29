/**
 * mapper.test.ts —— VoiceProfileMapper 单测
 * 用法: pnpm --filter @disc-lab/voice test:mapper
 *
 * 4 个用例：
 *  1. 8 persona → 4 唯一 voiceId
 *  2. 同 DISC 型映射一致：zhang_jun = liu_yang（同为 D 型）
 *  3. catchphrase 不入声音设计描述
 *  4. 缓存命中：第二次 initialize 调用 voiceDesignFn 0 次
 */

import { PERSONAS } from '@disc-lab/agent/personas';
import {
  VoiceProfileMapper,
} from '../src/voice-profile-mapper.js';
import type {
  VoicePersona,
  VoiceCacheStore,
  VoiceCacheFile,
  VoiceDesignRequest,
} from '../src/types.js';

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
  const ok = actual === expected;
  assert(ok, `${msg} (期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)})`);
}

// ============== in-memory 缓存存储 ==============

class MemoryCacheStore implements VoiceCacheStore {
  private file: VoiceCacheFile | null = null;
  read(): VoiceCacheFile | null {
    return this.file;
  }
  write(file: VoiceCacheFile): void {
    this.file = JSON.parse(JSON.stringify(file)) as VoiceCacheFile;
  }
}

// ============== mock voiceDesignFn ==============

function createMockDesignFn(): {
  fn: (req: VoiceDesignRequest) => Promise<string>;
  calls: VoiceDesignRequest[];
  reset: () => void;
} {
  const calls: VoiceDesignRequest[] = [];
  return {
    calls,
    reset: () => {
      calls.length = 0;
    },
    fn: (req: VoiceDesignRequest) => {
      calls.push(req);
      // 返回确定性 voiceId，同 DISC 型返回同值
      return Promise.resolve(`voice-${req.disc}`);
    },
  };
}

const MODEL = 'cosyvoice-v3-flash';
const PERSONAS_AS_VOICE: Record<string, VoicePersona> = PERSONAS as unknown as Record<
  string,
  VoicePersona
>;

async function main(): Promise<void> {
  // ---- 共享：首次 initialize（空缓存）----
  const cacheStore = new MemoryCacheStore();
  const designMock = createMockDesignFn();

  const mapper = new VoiceProfileMapper();
  await mapper.initialize({
    personas: PERSONAS_AS_VOICE,
    voiceDesignFn: designMock.fn,
    cacheStore,
    model: MODEL,
  });

  // ============== 用例 1：8 persona → 4 唯一 voiceId ==============
  console.log('\n[用例 1] 8 persona → 4 唯一 voiceId');
  {
    const ids = new Set<string>();
    for (const key of Object.keys(PERSONAS_AS_VOICE)) {
      ids.add(mapper.getVoiceId(PERSONAS_AS_VOICE[key]));
    }
    assertEqual(ids.size, 4, '8 persona 映射后唯一 voiceId 数量 = 4');
  }

  // ============== 用例 2：同 DISC 型映射一致 zhang_jun = liu_yang ==============
  console.log('\n[用例 2] 同 DISC 型映射一致：zhang_jun = liu_yang');
  {
    const zj = mapper.getVoiceId(PERSONAS_AS_VOICE.zhang_jun);
    const ly = mapper.getVoiceId(PERSONAS_AS_VOICE.liu_yang);
    assertEqual(zj, ly, 'zhang_jun 与 liu_yang 共享同一 voiceId（D 型）');

    // 补充：另三型也成对一致
    const lwq = mapper.getVoiceId(PERSONAS_AS_VOICE.lin_wanqing);
    const sy = mapper.getVoiceId(PERSONAS_AS_VOICE.sun_ying);
    assertEqual(lwq, sy, 'lin_wanqing 与 sun_ying 共享同一 voiceId（I 型）');

    const csy = mapper.getVoiceId(PERSONAS_AS_VOICE.chen_siyuan);
    const zl = mapper.getVoiceId(PERSONAS_AS_VOICE.zhou_lei);
    assertEqual(csy, zl, 'chen_siyuan 与 zhou_lei 共享同一 voiceId（S 型）');

    const wz = mapper.getVoiceId(PERSONAS_AS_VOICE.wang_zhe);
    const zxw = mapper.getVoiceId(PERSONAS_AS_VOICE.zhao_xiaowen);
    assertEqual(wz, zxw, 'wang_zhe 与 zhao_xiaowen 共享同一 voiceId（C 型）');
  }

  // ============== 用例 3：catchphrase 不入描述 ==============
  console.log('\n[用例 3] catchphrase 不入声音设计描述');
  {
    let allClean = true;
    let allHasTimbre = true;
    for (const key of Object.keys(PERSONAS_AS_VOICE)) {
      const persona = PERSONAS_AS_VOICE[key];
      const desc = VoiceProfileMapper.buildDescription(persona);
      // catchphrase（若有）绝不能出现在描述里
      if (persona.voice.catchphrase && desc.includes(persona.voice.catchphrase)) {
        allClean = false;
        console.error(`  ⚠️ ${persona.name} 的描述混入了 catchphrase：${desc}`);
      }
      // timbre 必须出现在描述里
      if (!desc.includes(persona.voice.timbre)) {
        allHasTimbre = false;
        console.error(`  ⚠️ ${persona.name} 的描述缺少 timbre：${desc}`);
      }
    }
    assert(allClean, '所有 8 角色的 catchphrase 均未混入声音设计描述');
    assert(allHasTimbre, '所有 8 角色的 timbre 均进入声音设计描述');

    // 进一步：检查首次 initialize 时发给 voiceDesignFn 的 4 条描述也不含 catchphrase
    let requestsClean = true;
    for (const req of designMock.calls) {
      // 找该 DISC 型代表 persona 的 catchphrase
      const rep = Object.values(PERSONAS_AS_VOICE).find((p) => p.disc === req.disc);
      if (rep?.voice.catchphrase && req.description.includes(rep.voice.catchphrase)) {
        requestsClean = false;
        console.error(`  ⚠️ DISC=${req.disc} 的设计请求描述含 catchphrase：${req.description}`);
      }
    }
    assert(requestsClean, '发给 voiceDesignFn 的 4 条描述均不含 catchphrase');
  }

  // ============== 用例 4：缓存命中 → 第二次 0 调用 ==============
  console.log('\n[用例 4] 缓存命中：第二次 initialize 调用 voiceDesignFn 0 次');
  {
    // 第一次已在上方完成，断言其调用了 4 次
    assertEqual(designMock.calls.length, 4, '首次 initialize 调用 voiceDesignFn 4 次');

    // 第二次：新 mapper 实例 + 同一缓存存储 + 同一 mock（重置计数）
    const mapper2 = new VoiceProfileMapper();
    designMock.reset();
    await mapper2.initialize({
      personas: PERSONAS_AS_VOICE,
      voiceDesignFn: designMock.fn,
      cacheStore,
      model: MODEL,
    });
    assertEqual(designMock.calls.length, 0, '第二次 initialize（缓存命中）调用 voiceDesignFn 0 次');
    assertEqual(
      mapper2.getDesignCallCount(),
      0,
      'mapper2.getDesignCallCount() === 0'
    );

    // 缓存命中后映射应与首次一致
    const m1 = mapper.getVoiceIdMap();
    const m2 = mapper2.getVoiceIdMap();
    assert(
      m1.D === m2.D && m1.I === m2.I && m1.S === m2.S && m1.C === m2.C,
      '缓存命中后映射与首次一致'
    );
  }

  // ============== 汇总 ==============
  console.log(`\n========== mapper.test 汇总 ==========`);
  console.log(`通过 ${passed} / 失败 ${failed}`);
  if (failed > 0) {
    console.error('❌ mapper.test 未通过');
    process.exit(1);
  }
  console.log('✅ mapper.test 全部通过');
}

main().catch((err) => {
  console.error('mapper.test 运行异常:', err);
  process.exit(1);
});
