/**
 * LLM 网关：封装 OpenAI 兼容 API 调用
 * 支持 OpenAI 官方 + 任何 OpenAI 兼容端点（如 Azure、中转代理）
 */

import OpenAI from 'openai';
import type { LLMConfig } from './types.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class LLMGateway {
  private client: OpenAI;
  private model: string;
  private temperature: number;
  private maxTokens: number;

  constructor(config: LLMConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl ?? 'https://api.openai.com/v1',
    });
    this.model = config.model ?? 'gpt-4o-mini';
    this.temperature = config.temperature ?? 0.7;
    this.maxTokens = config.maxTokens ?? 800;
  }

  /**
   * 单轮对话调用
   * @returns LLM 原始文本输出（理论上是 JSON 字符串）
   */
  async chat(
    systemPrompt: string,
    userPrompt: string,
    history?: ChatMessage[]
  ): Promise<string> {
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...(history ?? []),
      { role: 'user', content: userPrompt },
    ];

    let lastError: Error | null = null;
    const maxRetries = 2;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.client.chat.completions.create({
          model: this.model,
          messages,
          temperature: this.temperature,
          max_tokens: this.maxTokens,
          response_format: { type: 'json_object' },
        });

        const content = response.choices[0]?.message?.content ?? '';
        if (!content) {
          throw new Error('LLM 返回空内容');
        }
        return content;
      } catch (err) {
        lastError = err as Error;
        if (attempt < maxRetries) {
          const backoff = 800 * (attempt + 1);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
      }
    }

    throw lastError ?? new Error('LLM 调用失败');
  }

  /** 多轮对话（保留历史） */
  async chatWithHistory(
    systemPrompt: string,
    userPrompt: string,
    history: ChatMessage[]
  ): Promise<string> {
    return this.chat(systemPrompt, userPrompt, history);
  }
}
