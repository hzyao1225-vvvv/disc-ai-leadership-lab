/**
 * PoC 测试编排器
 * 用法: pnpm test:poc
 * 依次运行 4 个测试套件并生成报告
 */

import type { AgentConfig, PocReport, TestResult, Scene } from '../../src/types.js';
import { PERSONAS } from '../../src/personas.js';
import { runJsonStabilityTest } from './json-stability.test.js';
import { runStateMachineTest } from './state-machine.test.js';
import { runHiddenLayersTest } from './hidden-layers.test.js';
import { runPersonaDiffTest } from './persona-diff.test.js';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============== 共享 fixtures ==============

/** 标准绩效面谈场景 */
export const SCENE_PERFORMANCE_REVIEW: Scene = {
  id: 'perf_review_v1',
  type: 'performance_review',
  title: '季度绩效面谈',
  description:
    '本季度业绩复盘，领导者需要与员工就近期表现进行 1:1 面谈，了解其状态、对齐下阶段目标',
  stressors: ['KPI 压力', '团队重组', '客户预算收紧'],
  leaderGoals: [
    '了解员工真实状态',
    '识别潜在离职风险',
    '建立信任，给出可执行发展建议',
  ],
  initialEmotion: 'guarded',
  difficulty: 3,
};

/** 渐进式建立信任的领导者话语序列 */
export const TRUST_BUILDING_DIALOGUE: { content: string; intent: string }[] = [
  {
    intent: '开场，温和询问近况',
    content:
      '今天约你来，主要是想听你说说最近的状态，不用紧张，咱们就当聊天。你最近感觉怎么样？',
  },
  {
    intent: '认可贡献，聚焦专业能力',
    content:
      '我看到你这几个项目里的表现，专业度我是认可的。我想听听你自己怎么看今年这几个项目的得失？',
  },
  {
    intent: '主动询问困难，展现理解',
    content:
      '我注意到团队最近重组对你这块也有影响。你有没有遇到什么具体的困难？无论是工作上的，还是流程上的，我都想了解。',
  },
  {
    intent: '聚焦长期发展，展现诚意',
    content:
      '说到发展，我其实一直在想你的长期路径。你觉得 3 年后你想成为什么样的人？我愿意帮你一起规划，不是嘴上说说的。',
  },
  {
    intent: '主动提及公平性，触及 L2 触发条件',
    content:
      '我也知道今年 KPI 分配上有些争议，这块我准备重新审视一下，让你这种真出活的能被看见。你有什么想法直接跟我说。',
  },
  {
    intent: '收尾，表达长期承诺',
    content:
      '今天就聊到这。你做的好我都记在心里，接下来的事我会盯，你只管把专业做扎实。有什么需要随时来找我。',
  },
];

// ============== 报告输出 ==============

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORT_JSON = resolve(__dirname, 'poc-report.json');
const REPORT_MD = resolve(__dirname, 'poc-report.md');

async function main() {
  const apiKey = process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('❌ 请设置 LLM_API_KEY 环境变量（或 OPENAI_API_KEY）');
    process.exit(1);
  }

  const config: AgentConfig = {
    llm: {
      apiKey,
      baseUrl: process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1',
      model: process.env.LLM_MODEL ?? 'gpt-4o-mini',
      temperature: 0.7,
      maxTokens: 800,
    },
    debugPrompt: process.env.DEBUG_PROMPT === 'true',
    // PoC 测试默认开启 response 调试，便于校验 state_delta 等字段
    debugResponse: process.env.DEBUG_RESPONSE === 'false' ? false : true,
  };

  console.log('═══════════════════════════════════════════════');
  console.log('  DISC × AI 镜像实验室 - PoC 可行性验证');
  console.log('═══════════════════════════════════════════════');
  console.log(`模型: ${config.llm.model}`);
  console.log(`端点: ${config.llm.baseUrl}`);
  console.log(`人设数: ${Object.keys(PERSONAS).length}`);
  console.log('');

  const report: PocReport = {
    timestamp: new Date().toISOString(),
    model: config.llm.model ?? 'unknown',
    suites: {},
    overallPassed: false,
    summary: '',
  };

  const suites: { name: string; fn: () => Promise<TestResult> }[] = [
    { name: '1) JSON 稳定性测试', fn: () => runJsonStabilityTest(config) },
    { name: '2) 状态机行为测试', fn: () => runStateMachineTest(config) },
    { name: '3) 隐藏信息分层释放测试', fn: () => runHiddenLayersTest(config) },
    { name: '4) 8 角色差异化测试', fn: () => runPersonaDiffTest(config) },
  ];

  for (const suite of suites) {
    console.log(`\n──── ${suite.name} ────`);
    try {
      const result = await suite.fn();
      report.suites[
        suite.name.includes('JSON')
          ? 'jsonStability'
          : suite.name.includes('状态机')
            ? 'stateMachine'
            : suite.name.includes('隐藏')
              ? 'hiddenLayers'
              : 'personaDiff'
      ] = result;
      console.log(`结果: ${result.passed ? '✅ PASS' : '❌ FAIL'} (分数 ${result.score})`);
      for (const detail of result.details) {
        console.log(`  · ${detail}`);
      }
    } catch (err) {
      console.error(`套件执行异常:`, err);
      report.suites[
        suite.name.includes('JSON')
          ? 'jsonStability'
          : suite.name.includes('状态机')
            ? 'stateMachine'
            : suite.name.includes('隐藏')
              ? 'hiddenLayers'
              : 'personaDiff'
      ] = {
        name: suite.name,
        passed: false,
        score: 0,
        details: [`异常: ${(err as Error).message}`],
      };
    }
  }

  // 总体判定
  const results = Object.values(report.suites).filter(Boolean) as TestResult[];
  const allPassed = results.every((r) => r.passed);
  const avgScore =
    results.reduce((sum, r) => sum + r.score, 0) / results.length;
  report.overallPassed = allPassed;
  report.summary = `${results.filter((r) => r.passed).length}/${results.length} 套件通过，平均分 ${avgScore.toFixed(1)}/100`;

  // 写报告
  writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), 'utf-8');
  writeFileSync(REPORT_MD, renderMarkdownReport(report), 'utf-8');

  console.log('\n═══════════════════════════════════════════════');
  console.log(`  总结: ${report.summary}`);
  console.log(`  总体: ${allPassed ? '✅ 通过，可进入 W4 开发' : '❌ 未通过，需要调整'}`);
  console.log(`  报告: ${REPORT_JSON}`);
  console.log(`  报告: ${REPORT_MD}`);
  console.log('═══════════════════════════════════════════════');

  process.exit(allPassed ? 0 : 1);
}

function renderMarkdownReport(report: PocReport): string {
  const lines: string[] = [];
  lines.push('# DISC × AI 镜像实验室 - PoC 验证报告');
  lines.push('');
  lines.push(`- 时间: ${report.timestamp}`);
  lines.push(`- 模型: ${report.model}`);
  lines.push(`- 总结: ${report.summary}`);
  lines.push(`- 总体结论: ${report.overallPassed ? '✅ 通过' : '❌ 未通过'}`);
  lines.push('');
  for (const [key, result] of Object.entries(report.suites)) {
    if (!result) continue;
    lines.push(`## ${result.name}`);
    lines.push('');
    lines.push(`- 状态: ${result.passed ? '✅ PASS' : '❌ FAIL'}`);
    lines.push(`- 分数: ${result.score}/100`);
    lines.push('');
    lines.push('### 详情');
    for (const d of result.details) {
      lines.push(`- ${d}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

main().catch((err) => {
  console.error('PoC 运行失败:', err);
  process.exit(1);
});
