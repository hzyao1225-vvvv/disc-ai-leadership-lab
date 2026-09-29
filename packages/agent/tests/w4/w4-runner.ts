/**
 * W4 测试编排器
 * 用法: pnpm test:w4
 * 依次运行 3 个测试套件并生成报告
 */

import type { AgentConfig, TestResult } from '../../src/types.js';
import { PERSONAS } from '../../src/personas.js';
import { ALL_SCENES } from '../../src/scenes.js';
import { DIALOGUE_SCRIPTS } from '../../src/dialogue-scripts.js';
import { runSceneEngineTest } from './scene-engine.test.js';
import { runDialogueMatrixTest } from './dialogue-matrix.test.js';
import { runCrossPersonaDiffTest } from './cross-persona-diff.test.js';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============== W4 报告类型 ==============

interface W4Report {
  timestamp: string;
  model: string;
  suites: {
    sceneEngine?: TestResult;
    dialogueMatrix?: TestResult;
    crossPersonaDiff?: TestResult;
  };
  overallPassed: boolean;
  summary: string;
  matrix: {
    sceneCount: number;
    personaCount: number;
    customScripts: number;
    matrixCells: number;
  };
}

// ============== 报告输出 ==============

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORT_JSON = resolve(__dirname, 'w4-report.json');
const REPORT_MD = resolve(__dirname, 'w4-report.md');

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
    debugResponse: process.env.DEBUG_RESPONSE === 'true',
  };

  console.log('═══════════════════════════════════════════════');
  console.log('  DISC × AI 镜像实验室 - W4 场景引擎验证');
  console.log('═══════════════════════════════════════════════');
  console.log(`模型: ${config.llm.model}`);
  console.log(`端点: ${config.llm.baseUrl}`);
  console.log(`场景数: ${ALL_SCENES.length}`);
  console.log(`人设数: ${Object.keys(PERSONAS).length}`);
  console.log(`定制脚本数: ${DIALOGUE_SCRIPTS.length}`);
  console.log(
    `矩阵: ${ALL_SCENES.length} 场景 × ${Object.keys(PERSONAS).length} 角色 = ${ALL_SCENES.length * Object.keys(PERSONAS).length} 单元`
  );
  console.log('');

  const report: W4Report = {
    timestamp: new Date().toISOString(),
    model: config.llm.model ?? 'unknown',
    suites: {},
    overallPassed: false,
    summary: '',
    matrix: {
      sceneCount: ALL_SCENES.length,
      personaCount: Object.keys(PERSONAS).length,
      customScripts: DIALOGUE_SCRIPTS.length,
      matrixCells: ALL_SCENES.length * Object.keys(PERSONAS).length,
    },
  };

  const suites: { name: string; fn: () => Promise<TestResult> }[] = [
    { name: '1) 场景引擎测试', fn: () => runSceneEngineTest() },
    { name: '2) 对话矩阵测试', fn: () => runDialogueMatrixTest(config) },
    { name: '3) 跨角色差异化测试', fn: () => runCrossPersonaDiffTest(config) },
  ];

  for (const suite of suites) {
    console.log(`\n──── ${suite.name} ────`);
    try {
      const result = await suite.fn();
      const key = suite.name.includes('场景引擎')
        ? 'sceneEngine'
        : suite.name.includes('对话矩阵')
          ? 'dialogueMatrix'
          : 'crossPersonaDiff';
      report.suites[key] = result;
      console.log(
        `结果: ${result.passed ? '✅ PASS' : '❌ FAIL'} (分数 ${result.score})`
      );
      for (const detail of result.details) {
        console.log(`  · ${detail}`);
      }
    } catch (err) {
      console.error(`套件执行异常:`, err);
      const key = suite.name.includes('场景引擎')
        ? 'sceneEngine'
        : suite.name.includes('对话矩阵')
          ? 'dialogueMatrix'
          : 'crossPersonaDiff';
      report.suites[key] = {
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
  console.log(
    `  总体: ${allPassed ? '✅ 通过，W4 里程碑达成' : '❌ 未通过，需要调整'}`
  );
  console.log(`  报告: ${REPORT_JSON}`);
  console.log(`  报告: ${REPORT_MD}`);
  console.log('═══════════════════════════════════════════════');

  process.exit(allPassed ? 0 : 1);
}

function renderMarkdownReport(report: W4Report): string {
  const lines: string[] = [];
  lines.push('# DISC × AI 镜像实验室 - W4 场景引擎验证报告');
  lines.push('');
  lines.push(`- 时间: ${report.timestamp}`);
  lines.push(`- 模型: ${report.model}`);
  lines.push(`- 总结: ${report.summary}`);
  lines.push(`- 总体结论: ${report.overallPassed ? '✅ 通过' : '❌ 未通过'}`);
  lines.push('');
  lines.push('## 测试矩阵');
  lines.push('');
  lines.push(`- 场景数: ${report.matrix.sceneCount}`);
  lines.push(`- 人设数: ${report.matrix.personaCount}`);
  lines.push(`- 定制脚本数: ${report.matrix.customScripts}`);
  lines.push(`- 矩阵单元: ${report.matrix.matrixCells}`);
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
  console.error('W4 运行失败:', err);
  process.exit(1);
});
