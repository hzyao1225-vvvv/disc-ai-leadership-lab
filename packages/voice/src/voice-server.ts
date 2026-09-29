/**
 * voice-server.ts —— 纯 ws + http 轻量语音服务（W5 §6 Step 7）
 *
 * 职责：
 *   1) http 托管 public/index.html（GET /）+ 健康检查（GET /healthz）
 *   2) ws 处理 /voice 路径：每连接 lazy 实例化 VoicePipeline
 *      - 注入 ParaformerASRClient / CosyVoiceTTSClient / EmployeeAgent（按 sceneId+personaId 分桶复用）
 *      - voiceId 由 VoiceProfileMapper.getVoiceId(persona) 提供
 *   3) VoicePipelineCallbacks 把事件序列化为 VoiceServerMessage 推回前端
 *      - onAudioChunk 用二进制帧；其余用文本帧（JSON）
 *   4) 解析 VoiceClientMessage：start / audio-chunk / audio-end / text / switch-mode / ping
 *
 * 设计约束（W5 plan §7）：
 *   - 不修改 packages/agent 任何文件；Scene 字面值在此内嵌副本（与 agent/src/scenes.ts 同步）
 *   - AgentConfig 结构兼容子集，TS 结构类型即可
 *   - 降级三态由 pipeline 内部状态机驱动；voice-server 仅转发 onModeChange
 *   - scheduleRetry 简化为 PoC：voice-degraded 不自动 30s 重试，需用户刷新页面重置（与 plan §5 一致）
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import { WebSocketServer, WebSocket } from 'ws';

// agent 包：仅用顶层 EmployeeAgent（已暴露）+ personas/scenes/evaluator 子路径
import { EmployeeAgent, SessionEvaluator } from '@disc-lab/agent';
import { PERSONAS } from '@disc-lab/agent/personas';
import { ALL_SCENES, getSceneById } from '@disc-lab/agent/scenes';
import type { Scene, Persona, EmployeeState, EvaluationResult } from '@disc-lab/agent';

// voice 包内部模块
import type {
  VoiceClientMessage,
  VoiceServerMessage,
  VoiceModeState,
  VoicePersona,
} from './types.js';
import { VoiceProfileMapper } from './voice-profile-mapper.js';
import { CosyVoiceTTSClient } from './dashscope-tts.js';
import { ParaformerASRClient } from './dashscope-asr.js';
import { VoicePipeline, type AgentLike } from './voice-pipeline.js';

// ============== Scene 单一源 ==============
// 自 W6 起从 agent/scenes.ts 直接导入 ALL_SCENES/getSceneById，删除原内嵌副本。
// voice-server 仍持有 SCENE_BY_ID 映射用于 ensurePipeline 查找。
const SCENE_BY_ID: Record<string, Scene> = Object.fromEntries(
  ALL_SCENES.map((s) => [s.id, s])
);

// ============== 桶 key hash 工具 ==============
// 把学員编辑后的 bg/goal 文本哈希为 8 位前缀，让不同编辑版本自然分桶；空串统一为 00000000。
const EMPTY_HASH = '0'.repeat(8);
function hashText(text: string | undefined): string {
  const t = (text ?? '').trim();
  if (!t) return EMPTY_HASH;
  // 简单 hash：djb2 变体，无需 crypto 依赖；前 8 位足够区分学員编辑差异
  let h = 5381;
  for (let i = 0; i < t.length; i++) {
    h = (h * 33) ^ t.charCodeAt(i);
  }
  // 转 16 进制取前 8 位
  const hex = (h >>> 0).toString(16).padStart(8, '0');
  return hex.slice(0, 8);
}

// ============== AgentConfig 结构兼容子集（不依赖 agent 包 types 导出） ==============

interface AgentConfigLiteral {
  llm: {
    apiKey: string;
    baseUrl?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
  };
  debugPrompt?: boolean;
  debugResponse?: boolean;
}

// ============== 环境变量读取 ==============

function readEnv(): {
  dashscopeApiKey: string;
  dashscopeWorkspaceId: string;
  llmApiKey: string;
  llmBaseUrl: string;
  llmModel: string;
  llmTemperature: number;
  llmMaxTokens: number;
  cosyvoiceModel: string;
  paraformerModel: string;
  voicePort: number;
  debugPrompt: boolean;
  debugResponse: boolean;
} {
  // W5 规划：DASHSCOPE_API_KEY 与 LLM_API_KEY 实际是同一个通义 key，未单独配置时回退
  const llmApiKey = process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? '';
  const dashscopeApiKey = process.env.DASHSCOPE_API_KEY || llmApiKey;
  const dashscopeWorkspaceId = process.env.DASHSCOPE_WORKSPACE_ID ?? '';
  const llmBaseUrl = process.env.LLM_BASE_URL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  const llmModel = process.env.LLM_MODEL ?? 'qwen-plus';
  const llmTemperature = Number(process.env.LLM_TEMPERATURE ?? 0.7);
  const llmMaxTokens = Number(process.env.LLM_MAX_TOKENS ?? 800);
  const cosyvoiceModel = process.env.COSYVOICE_MODEL ?? 'cosyvoice-v3-flash';
  const paraformerModel = process.env.PARAFORMER_MODEL ?? 'paraformer-realtime-v2';
  const voicePort = Number(process.env.VOICE_PORT ?? 4173);
  const debugPrompt = process.env.DEBUG_PROMPT === 'true';
  const debugResponse = process.env.DEBUG_RESPONSE === 'true';
  return {
    dashscopeApiKey,
    dashscopeWorkspaceId,
    llmApiKey,
    llmBaseUrl,
    llmModel,
    llmTemperature,
    llmMaxTokens,
    cosyvoiceModel,
    paraformerModel,
    voicePort,
    debugPrompt,
    debugResponse,
  };
}

// ============== 单例桶 ==============

/** EmployeeAgent 按 sceneId:personaId 复用（W5 plan §6 Step 7） */
const agentBucket = new Map<string, InstanceType<typeof EmployeeAgent>>();

function getOrCreateAgent(
  sceneId: string,
  personaId: string,
  llmConfig: AgentConfigLiteral['llm'],
  debug: { debugPrompt: boolean; debugResponse: boolean },
  sessionBackground?: string,
  sessionGoal?: string
): InstanceType<typeof EmployeeAgent> {
  // 桶 key 扩展为 sceneId:personaId:bgHash:goalHash，让不同编辑版本自然分桶
  const key = `${sceneId}:${personaId}:${hashText(sessionBackground)}:${hashText(sessionGoal)}`;
  const cached = agentBucket.get(key);
  if (cached) return cached;

  const persona = PERSONAS[personaId];
  if (!persona) {
    throw new Error(`未知 personaId: ${personaId}`);
  }
  const scene = SCENE_BY_ID[sceneId];
  if (!scene) {
    throw new Error(`未知 sceneId: ${sceneId}`);
  }
  // 仅当学員编辑后的 bg/goal 非空时透传，否则 undefined → buildSystemPrompt 自动回退到 scene 默认
  const sessionContext =
    sessionBackground?.trim() || sessionGoal?.trim()
      ? { sessionBackground, sessionGoal }
      : undefined;
  const agent = new EmployeeAgent(
    persona as unknown as ConstructorParameters<typeof EmployeeAgent>[0],
    scene as unknown as ConstructorParameters<typeof EmployeeAgent>[1],
    { llm: llmConfig, ...debug, sessionContext }
  );
  agentBucket.set(key, agent);
  return agent;
}

// ============== NoopTTS（纯文字模式：不连 dashscope，synthesize 直接 resolve） ==============

class NoopTTS {
  async synthesize(
    _text: string,
    _voiceId: string,
    _onAudioChunk: (pcm: ArrayBuffer) => void
  ): Promise<void> {
    // 文字模式不合成语音，立即返回；pipeline 仍走 onReply 文本路径
  }
}

// ============== 连接级会话上下文 ==============

interface SessionContext {
  pipeline: VoicePipeline | null;
  /** 当前连接关联的 EmployeeAgent（用于 evaluate 取 history/state）；ensurePipeline 创建后赋值 */
  agent: InstanceType<typeof EmployeeAgent> | null;
  sceneId: string | null;
  personaId: string | null;
  mode: VoiceModeState;
  /** 学员编辑后的会话背景/目标（与 start 消息同步） */
  sessionBackground?: string;
  sessionGoal?: string;
}

function newSessionContext(): SessionContext {
  return {
    pipeline: null,
    agent: null,
    sceneId: null,
    personaId: null,
    mode: 'voice',
  };
}

// ============== WS 消息发送辅助 ==============

function sendJson(ws: WebSocket, msg: VoiceServerMessage): void {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(msg));
}

function sendBinary(ws: WebSocket, buf: ArrayBuffer): void {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(buf);
}

// ============== 启动 ==============

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_HTML = resolve(__dirname, '..', 'public', 'index.html');

async function readPublicHtml(): Promise<string> {
  try {
    return await readFile(PUBLIC_HTML, 'utf-8');
  } catch {
    return '<!doctype html><html><body style="font-family:sans-serif;padding:2rem"><h1>voice-server</h1><p>public/index.html 未找到。请确认 packages/voice/public/index.html 存在。</p></body></html>';
  }
}

async function main(): Promise<void> {
  const env = readEnv();

  console.log('═══════════════════════════════════════════════');
  console.log('  DISC × AI 镜像实验室 - W5 语音服务');
  console.log('═══════════════════════════════════════════════');
  console.log(`端口: ${env.voicePort}`);
  console.log(`LLM: ${env.llmModel} @ ${env.llmBaseUrl}`);
  console.log(`ASR: ${env.paraformerModel}`);
  console.log(`TTS: ${env.cosyvoiceModel}`);
  console.log(`Workspace: ${env.dashscopeWorkspaceId || '(未配置)'}`);

  // 1. 初始化 VoiceProfileMapper
  //    PoC 默认走系统预置音色（免费，无需 voice-enrollment），已实测 maas 端点可用。
  //    声音设计定制音色路径保留在 dashscope-tts.ts / mapper.initialize，待开通付费后启用。
  const mapper = new VoiceProfileMapper();
  let mapperReady = false;
  if (env.dashscopeApiKey && env.dashscopeWorkspaceId) {
    try {
      mapper.usePresetVoices();
      mapperReady = true;
      console.log(`音色映射就绪（系统预置音色，免费）: ${JSON.stringify(mapper.getVoiceIdMap())}`);
    } catch (err) {
      console.warn(
        `[启动] VoiceProfileMapper 预置音色载入失败：${(err as Error).message}`
      );
    }
  } else {
    console.warn(
      '[启动] DASHSCOPE_API_KEY 或 DASHSCOPE_WORKSPACE_ID 未配置，语音模式不可用（文字模式不受影响）'
    );
  }

  // 2. LLM 配置（供 EmployeeAgent 构造）
  if (!env.llmApiKey) {
    console.warn(
      '[启动] LLM_API_KEY 未配置，agent.respond 调用将失败'
    );
  }
  const llmConfig = {
    apiKey: env.llmApiKey || 'missing',
    baseUrl: env.llmBaseUrl,
    model: env.llmModel,
    temperature: env.llmTemperature,
    maxTokens: env.llmMaxTokens,
  };
  const debug = { debugPrompt: env.debugPrompt, debugResponse: env.debugResponse };

  // 3. http 服务
  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';
    if (url === '/' || url === '/index.html') {
      const html = await readPublicHtml();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    if (url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, mapperReady, agents: agentBucket.size }));
      return;
    }
    if (url === '/scene-defaults') {
      // 前端 select 切换场景时拉取该场景的会话背景/目标默认值
      // 单一源 agent/scenes.ts，避免前端嵌副本
      const payload = ALL_SCENES.map((s) => ({
        id: s.id,
        title: s.title,
        sessionBackgroundDefault: s.sessionBackgroundDefault ?? '',
        sessionGoalDefault: s.sessionGoalDefault ?? '',
      }));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(payload));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  // 4. ws 服务
  // maxPayload 显式设为 10MB（≈5 分钟 16k/16bit PCM）：
  // ws 默认 100MB，这里收紧到明确值做纵深防御；前端已对长段独白分块（8KB/帧），
  // 正常单帧远小于此。超过时 ws 会以 1009 关闭连接。
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/voice',
    maxPayload: 10 * 1024 * 1024,
  });

  wss.on('connection', (ws: WebSocket) => {
    const ctx = newSessionContext();
    const connectionId = randomUUID().slice(0, 8);
    console.log(`[ws ${connectionId}] 连接建立`);

    // 串行消息队列：start（await ASR 握手）、audio-chunk、audio-end 必须按序处理，
    // 不能并发——否则 ASR startVoiceSession 还没 resolve，音频帧就到了被静默丢弃。
    const msgQueue: Array<() => Promise<void>> = [];
    let draining = false;
    const drainQueue = async () => {
      if (draining) return;
      draining = true;
      try {
        while (msgQueue.length > 0) {
          const handler = msgQueue.shift()!;
          try { await handler(); } catch (err) {
            console.error(`[ws ${connectionId}] handler error:`, (err as Error).message);
          }
        }
      } finally {
        draining = false;
      }
    };

    // pipeline 回调：序列化为 VoiceServerMessage
    const buildCallbacks = () => ({
      onAsrPartial: (text: string) => sendJson(ws, { type: 'asr-partial', text }),
      onReply: (text: string, emotion: string, round: number) =>
        sendJson(ws, { type: 'reply', text, emotion, round }),
      onAudioChunk: (pcm: ArrayBuffer) => sendBinary(ws, pcm),
      onAudioEnd: () => sendJson(ws, { type: 'audio-end' }),
      onModeChange: (mode: VoiceModeState, reason: string) => {
        ctx.mode = mode;
        sendJson(ws, { type: 'mode', mode, reason });
      },
      onError: (err: Error) =>
        sendJson(ws, { type: 'error', message: err.message }),
    });

    // 构建 pipeline（start 消息触发）
    const ensurePipeline = (): { pipeline: VoicePipeline; voiceId: string } | { error: string } => {
      if (ctx.pipeline) {
        return { pipeline: ctx.pipeline, voiceId: '' };
      }
      // lazy 创建
      if (!ctx.sceneId || !ctx.personaId) {
        return { error: '请先在 start 消息中指定 sceneId 和 personaId' };
      }
      try {
        const persona = PERSONAS[ctx.personaId];
        if (!persona) throw new Error(`未知 personaId: ${ctx.personaId}`);
        const scene = SCENE_BY_ID[ctx.sceneId];
        if (!scene) throw new Error(`未知 sceneId: ${ctx.sceneId}`);

        const isTextMode = ctx.mode === 'text';

        // text 模式：不依赖 dashscope，voiceId 空串 + NoopTTS + ASR 客户端不启动
        // voice 模式：必须 mapper 就绪（4 voiceId）
        let voiceId = '';
        let ttsClient: CosyVoiceTTSClient | NoopTTS;
        if (isTextMode) {
          ttsClient = new NoopTTS();
        } else {
          if (!mapperReady) {
            return {
              error: '语音模式需要 DASHSCOPE_API_KEY/DASHSCOPE_WORKSPACE_ID（音色映射未就绪）；请切文字模式或配置凭证后重启',
            };
          }
          voiceId = mapper.getVoiceId(persona as unknown as VoicePersona);
          ttsClient = new CosyVoiceTTSClient({
            apiKey: env.dashscopeApiKey,
            workspaceId: env.dashscopeWorkspaceId,
            model: env.cosyvoiceModel,
          });
        }

        // ASR 客户端（text 模式创建但不调 start，不会连网）
        const asrClient = new ParaformerASRClient({
          apiKey: env.dashscopeApiKey,
          workspaceId: env.dashscopeWorkspaceId,
          model: env.paraformerModel,
        });

        // EmployeeAgent（按 sceneId:personaId:bgHash:goalHash 分桶）
        const agent = getOrCreateAgent(
          ctx.sceneId,
          ctx.personaId,
          llmConfig,
          debug,
          ctx.sessionBackground,
          ctx.sessionGoal
        );
        ctx.agent = agent;

        const pipeline = new VoicePipeline(
          {
            asrClient,
            ttsClient: ttsClient as unknown as CosyVoiceTTSClient,
            agent: agent as unknown as AgentLike,
            voiceId,
          },
          buildCallbacks()
        );
        ctx.pipeline = pipeline;
        return { pipeline, voiceId };
      } catch (err) {
        return { error: (err as Error).message };
      }
    };

    const handleMessage = async (data: unknown, isBinary: boolean): Promise<void> => {
      // 二进制帧 = audio-chunk（前端直接发 ArrayBuffer PCM Int16）
      if (isBinary) {
        console.log(`[ws ${connectionId}] ← audio-chunk ${(data as Buffer).byteLength}B`);
        if (!ctx.pipeline) {
          sendJson(ws, { type: 'error', message: '请先发 start 消息' });
          return;
        }
        try {
          const buf = data instanceof Buffer ? data : (data as { buffer?: ArrayBuffer })?.buffer;
          if (!buf) {
            sendJson(ws, { type: 'error', message: 'audio-chunk 数据无效' });
            return;
          }
          const arrayBuf = buf instanceof ArrayBuffer
            ? buf
            : (buf as Buffer).buffer.slice(
                (buf as Buffer).byteOffset,
                (buf as Buffer).byteOffset + (buf as Buffer).byteLength
              );
          const samples = new Int16Array(arrayBuf);
          ctx.pipeline.sendAudio(samples);
        } catch (err) {
          sendJson(ws, { type: 'error', message: (err as Error).message });
        }
        return;
      }

      // 文本帧 = JSON 控制消息
      let msg: VoiceClientMessage;
      try {
        const text =
          typeof data === 'string'
            ? data
            : (data as Buffer).toString('utf-8');
        msg = JSON.parse(text) as VoiceClientMessage;
        console.log(`[ws ${connectionId}] ← ${msg.type}`, msg.type === 'start' ? `scene=${msg.sceneId} persona=${msg.personaId} mode=${msg.mode}` : '');
      } catch {
        sendJson(ws, { type: 'error', message: '消息解析失败（需 JSON）' });
        return;
      }

      switch (msg.type) {
        case 'start': {
          ctx.sceneId = msg.sceneId;
          ctx.personaId = msg.personaId;
          ctx.mode = msg.mode;
          ctx.sessionBackground = msg.sessionBackground;
          ctx.sessionGoal = msg.sessionGoal;
          const result = ensurePipeline();
          if ('error' in result) {
            sendJson(ws, { type: 'error', message: result.error });
            return;
          }
          if (ctx.mode === 'text') {
            // 纯文字模式：不启动 ASR（不连 dashscope），直接确认
            sendJson(ws, {
              type: 'mode',
              mode: 'text',
              reason: `文字会话开始: scene=${msg.sceneId} persona=${msg.personaId}`,
            });
          } else {
            // 语音模式：ASR 未活跃时（首次或上一轮已 finish）启动新会话
            if (!result.pipeline.isAsrActive()) {
              const ok = await result.pipeline.startVoiceSession();
              if (!ok) {
                sendJson(ws, {
                  type: 'mode',
                  mode: 'voice-degraded',
                  reason: 'ASR 启动失败',
                });
                return;
              }
            }
            sendJson(ws, {
              type: 'mode',
              mode: ctx.mode,
              reason: `语音会话${result.pipeline.isAsrActive() ? '继续' : '开始'}: scene=${msg.sceneId} persona=${msg.personaId} voiceId=${result.voiceId}`,
            });
          }
          break;
        }
        case 'audio-chunk': {
          // 走文本路径的消息形态（JSON 包装 ArrayBuffer）—— 前端通常用二进制帧，此处兜底
          if (!ctx.pipeline) {
            sendJson(ws, { type: 'error', message: '请先发 start 消息' });
            return;
          }
          try {
            const ab = msg.data;
            const samples = new Int16Array(ab);
            ctx.pipeline.sendAudio(samples);
          } catch (err) {
            sendJson(ws, { type: 'error', message: (err as Error).message });
          }
          break;
        }
        case 'audio-end': {
          if (!ctx.pipeline) {
            sendJson(ws, { type: 'error', message: '请先发 start 消息' });
            return;
          }
          try {
            await ctx.pipeline.endVoiceSession();
          } catch (err) {
            sendJson(ws, { type: 'error', message: (err as Error).message });
          }
          break;
        }
        case 'text': {
          if (!ctx.pipeline) {
            // 文字模式下 pipeline 也需要先 start 以初始化（前端文字模式仍发 start）
            sendJson(ws, { type: 'error', message: '请先发 start 消息' });
            return;
          }
          await ctx.pipeline.handleUserText(msg.content);
          break;
        }
        case 'switch-mode': {
          ctx.mode = msg.mode;
          sendJson(ws, {
            type: 'mode',
            mode: msg.mode,
            reason: '用户手动切换模式',
          });
          break;
        }
        case 'evaluate': {
          // 学员主动请求评价：从 ctx.agent 取 history + state，调 SessionEvaluator
          if (!ctx.agent) {
            sendJson(ws, { type: 'error', message: '请先发 start 消息开始会话后再请求评价' });
            return;
          }
          if (!ctx.sceneId || !ctx.personaId) {
            sendJson(ws, { type: 'error', message: '会话未初始化（缺少 scene/persona）' });
            return;
          }
          try {
            const persona = PERSONAS[ctx.personaId];
            const scene = SCENE_BY_ID[ctx.sceneId];
            if (!persona || !scene) {
              sendJson(ws, { type: 'error', message: '场景或人设未找到' });
              return;
            }
            const history = ctx.agent.getHistory();
            // 空对话降级：直接返回，不调 LLM
            if (history.length === 0) {
              sendJson(ws, {
                type: 'evaluation',
                result: {
                  totalScore: 0,
                  dimensions: [],
                  feedback: '对话不足以评价：尚无对话轮次。',
                  strengths: [],
                  improvements: [],
                },
              });
              return;
            }
            const state = ctx.agent.getState() as Readonly<EmployeeState>;
            // 评价输出含 11 节复盘报告，token 需求远大于对话回复；
            // 复用对话 maxTokens（默认 800）会导致 JSON 被截断，解析失败。
            const evaluator = new SessionEvaluator(
              { ...llmConfig, maxTokens: Number(process.env.EVAL_MAX_TOKENS ?? 4096) },
              debug.debugResponse
            );
            const result: EvaluationResult = await evaluator.evaluate(
              history,
              persona as unknown as Persona,
              scene,
              state as EmployeeState,
              msg.criteria
            );
            sendJson(ws, { type: 'evaluation', result });
          } catch (err) {
            sendJson(ws, { type: 'error', message: `评价失败: ${(err as Error).message}` });
          }
          break;
        }
        case 'dbg': {
          // 前端诊断事件：仅记日志
          console.log(`[ws ${connectionId}] [dbg] ${JSON.stringify(msg)}`);
          break;
        }
        case 'ping': {
          sendJson(ws, { type: 'pong' });
          break;
        }
        default: {
          sendJson(ws, { type: 'error', message: `未知消息类型: ${(msg as { type: string }).type}` });
        }
      }
    };

    // ws 消息入队，保证 start→audio→audio-end 串行
    ws.on('message', (data: unknown, isBinary: boolean) => {
      // 到达即记（入队前）：队列若卡住也能看到消息到达
      if (isBinary) {
        console.log(`[ws ${connectionId}] ⇩ binary ${(data as Buffer).byteLength}B (queue=${msgQueue.length})`);
      } else {
        try {
          const t = (JSON.parse(typeof data === 'string' ? data : (data as Buffer).toString('utf-8')) as { type?: string }).type;
          console.log(`[ws ${connectionId}] ⇩ ${t} (queue=${msgQueue.length})`);
        } catch { /* ignore */ }
      }
      msgQueue.push(() => handleMessage(data, isBinary));
      void drainQueue();
    });

    ws.on('close', () => {
      console.log(`[ws ${connectionId}] 连接关闭`);
      if (ctx.pipeline) {
        // 异步清理，不阻塞 close；flush:false —— 连接已死，缓冲的分句不再触发回复
        void ctx.pipeline.endVoiceSession({ flush: false }).catch(() => {});
      }
    });

    ws.on('error', (err: Error) => {
      console.error(`[ws ${connectionId}] 错误: ${err.message}`);
    });
  });

  // 5. 启动监听
  httpServer.listen(env.voicePort, () => {
    console.log(`\n✅ 语音服务已启动: http://localhost:${env.voicePort}`);
    console.log(`   测试页: http://localhost:${env.voicePort}/`);
    console.log(`   健康检查: http://localhost:${env.voicePort}/healthz`);
    console.log(`   WebSocket: ws://localhost:${env.voicePort}/voice`);
    if (!mapperReady) {
      console.log('\n⚠️  音色映射未就绪，前端语音会话将失败。请配置 DASHSCOPE_API_KEY/DASHSCOPE_WORKSPACE_ID 后重启。');
    }
  });
}

main().catch((err) => {
  console.error('voice-server 启动失败:', err);
  process.exit(1);
});
