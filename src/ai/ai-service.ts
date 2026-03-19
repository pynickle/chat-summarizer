import { Context, Logger } from 'koishi';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText, type ModelMessage } from 'ai';
import { Config, AISummaryOutput } from '../core/types';
import { handleError } from '../core/utils';
import { STRUCTURED_SYSTEM_PROMPT } from '../core/config';
import { extractHttpErrorContext, trimForLog } from '../core/error-utils';
import {
  buildStructuredSummaryPrompt,
  getDefaultFilePrompt,
  getDefaultSystemPrompt,
  getDefaultUserPromptTemplate,
} from './ai-prompts';
import { getDefaultAISummaryOutput, parseStructuredResponse } from './structured-parser';
import { analyzeChat as analyzeChatHelper, parseAnalysisQuery as parseAnalysisQueryHelper } from './analysis-service';

export class AIService {
  private logger: Logger;
  private globalConfig: Config;

  constructor(ctx: Context, config: Config) {
    this.logger = ctx.logger('chat-summarizer:ai');
    this.globalConfig = config;
  }

  /**
   * 获取全局 AI 配置
   */
  private get config(): Config['ai'] {
    return this.globalConfig.ai;
  }

  /**
   * 获取群组专用的 AI 配置
   */
  private getGroupAIConfig(guildId: string): {
    systemPrompt?: string;
    userPromptTemplate?: string;
    enabled?: boolean;
  } {
    const groupConfig = this.globalConfig.monitor.groups.find((group) => group.groupId === guildId);

    return {
      systemPrompt: groupConfig?.systemPrompt || this.config.systemPrompt,
      userPromptTemplate: groupConfig?.userPromptTemplate || this.config.userPromptTemplate,
      enabled:
        groupConfig?.summaryEnabled !== undefined
          ? groupConfig.summaryEnabled
          : this.config.enabled,
    };
  }

  /**
   * 检查 AI 服务是否已启用并配置正确
   */
  isEnabled(guildId?: string): boolean {
    const globalEnabled = this.config.enabled && !!this.config.apiUrl && !!this.config.apiKey;

    if (!globalEnabled) return false;

    // 如果提供了群组 ID，检查群组专用配置
    if (guildId) {
      const groupConfig = this.getGroupAIConfig(guildId);
      return groupConfig.enabled !== false; // 只有明确设置为 false 才禁用
    }

    return true;
  }

  /**
   * 替换模板变量
   */
  private replaceTemplate(template: string, variables: Record<string, string>): string {
    return template.replace(/\{(\w+)\}/g, (match, key) => {
      return variables[key] || match;
    });
  }

  /**
   * 获取群组信息描述
   */
  private getGroupInfo(guildId: string): string {
    if (guildId === 'private') return '私聊记录';
    return `群组 ${guildId}`;
  }

  private getApiMode(): 'chat.completions' | 'responses' {
    return this.config.apiMode === 'responses' ? 'responses' : 'chat.completions';
  }

  private buildModel() {
    if (!this.config.apiKey || !this.config.apiUrl) {
      throw new Error('AI 配置不完整，请检查 API URL 和密钥');
    }

    const modelName = this.config.model || 'gpt-5.4';
    const openai = createOpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.apiUrl,
    });

    return this.getApiMode() === 'responses' ? openai.responses(modelName) : openai.chat(modelName);
  }

  private async generateTextWithMessages(options: {
    messages: ModelMessage[];
    temperature: number;
    timeoutSeconds: number;
  }): Promise<string> {
    const abortController = new AbortController();
    const timeoutMs = Math.max(1, options.timeoutSeconds) * 1000;
    const timer = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      const result = await generateText({
        model: this.buildModel(),
        messages: options.messages,
        temperature: options.temperature,
        maxOutputTokens:
          this.config.maxTokens && this.config.maxTokens > 0 ? this.config.maxTokens : undefined,
        abortSignal: abortController.signal,
      });

      return result.text.trim();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`请求超时（>${options.timeoutSeconds} 秒）`);
      }

      const errorContext = await extractHttpErrorContext(error);
      const responseBody =
        errorContext.responseBody && errorContext.responseBody.trim()
          ? trimForLog(errorContext.responseBody)
          : undefined;

      this.logger.error('AI 请求失败', {
        message: errorContext.message,
        statusCode: errorContext.statusCode,
        code: errorContext.code,
        requestUrl: errorContext.requestUrl,
        responseBody,
        mode: this.getApiMode(),
        model: this.config.model || 'gpt-3.5-turbo',
      });

      if (errorContext.statusCode || errorContext.code || responseBody) {
        const statusPart = errorContext.statusCode ? `HTTP ${errorContext.statusCode}` : '未知状态';
        const codePart = errorContext.code ? `, code=${errorContext.code}` : '';
        const bodyPart = responseBody ? `\n响应详情：${responseBody}` : '';
        throw new Error(`AI API 请求失败（${statusPart}${codePart}）${bodyPart}`);
      }

      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 生成聊天记录总结
   */
  async generateSummary(
    content: string,
    timeRange: string,
    messageCount: number,
    guildId: string
  ): Promise<string> {
    // 检查群组级别的 AI 启用状态
    if (!this.isEnabled(guildId)) {
      throw new Error('AI 总结功能未启用或该群组已禁用 AI 功能');
    }

    if (!this.config.apiUrl || !this.config.apiKey) {
      throw new Error('AI 配置不完整，请检查 API URL 和密钥');
    }

    try {
      // 获取群组专用配置
      const groupConfig = this.getGroupAIConfig(guildId);
      const systemPrompt = groupConfig.systemPrompt || getDefaultSystemPrompt();

      let userPrompt: string;

      if (this.config.useFileMode) {
        // 文件模式：使用云雾 API 的聊天 + 读取文件接口格式
        this.logger.debug('使用文件模式发送请求');

        // 构建文件模式的用户提示词，将内容直接包含在文本中
        const filePrompt = this.buildFilePrompt(timeRange, messageCount, guildId);
        userPrompt = `${filePrompt}\n\n📄 **聊天记录内容：**\n\n${content}`;
      } else {
        // 传统模式：直接发送文本内容
        this.logger.debug('使用传统模式发送请求');

        const userPromptTemplate =
          groupConfig.userPromptTemplate || getDefaultUserPromptTemplate();
        userPrompt = this.replaceTemplate(userPromptTemplate, {
          timeRange,
          messageCount: messageCount.toString(),
          groupInfo: this.getGroupInfo(guildId),
          content,
        });
      }

      this.logger.debug('发送 AI 请求', {
        url: this.config.apiUrl,
        mode: this.getApiMode(),
        model: this.config.model || 'gpt-5.4',
        fileMode: this.config.useFileMode,
        contentLength: content.length,
        hasFile: !!(this.config.useFileMode && content),
        timeout: this.config.timeout || 60,
      });

      // 文件模式需要更长的超时时间
      const timeoutMs = this.config.useFileMode
        ? Math.max((this.config.timeout || 120) * 1000, 120000) // 文件模式最少 2 分钟
        : (this.config.timeout || 60) * 1000;

      this.logger.debug(`设置超时时间：${timeoutMs}ms`);

      const summary = await this.generateTextWithMessages({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        timeoutSeconds: Math.ceil(timeoutMs / 1000),
      });

      if (!summary) {
        throw new Error('AI 响应内容为空');
      }

      this.logger.info('AI 总结生成成功', {
        inputLength: content.length,
        outputLength: summary.length,
        fileMode: this.config.useFileMode,
      });

      return summary;
    } catch (error) {
      // 增强错误信息处理
      let errorMessage = error.message || '未知错误';
      let suggestion = '';

      if (errorMessage.includes('context disposed')) {
        suggestion = `建议：文件模式请求被中断。可能原因：
1. 请求时间过长，建议减少聊天记录内容长度
2. 网络连接不稳定，建议重试
3. 尝试切换到文本模式：设置 useFileMode: false`;
      } else if (errorMessage.includes('Service Unavailable')) {
        suggestion = '建议：API 服务暂时不可用，请稍后重试或检查服务状态';
      } else if (errorMessage.includes('Unauthorized') || errorMessage.includes('401')) {
        suggestion = '建议：API 密钥无效，请检查配置中的 apiKey 是否正确';
      } else if (errorMessage.includes('Forbidden') || errorMessage.includes('403')) {
        suggestion = '建议：API 密钥权限不足，请检查密钥是否有访问该模型的权限';
      } else if (errorMessage.includes('Not Found') || errorMessage.includes('404')) {
        suggestion = '建议：API 接口地址错误，请检查 apiUrl 配置是否正确';
      } else if (errorMessage.includes('timeout')) {
        suggestion = this.config.useFileMode
          ? '建议：文件模式请求超时，可尝试减少内容长度或增加 timeout 配置，或切换到文本模式'
          : '建议：请求超时，可以尝试增加 timeout 配置或检查网络连接';
      } else if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('ECONNREFUSED')) {
        suggestion = '建议：网络连接失败，请检查网络连接和 API 地址是否可访问';
      } else if (
        errorMessage.includes('Rate limit') ||
        errorMessage.includes('Too Many Requests')
      ) {
        suggestion = '建议：API 调用频率过高，请稍后重试';
      }

      this.logger.error('AI 总结生成失败', {
        error: errorMessage,
        suggestion,
        stack: error.stack,
        config: {
          apiUrl: this.config.apiUrl,
          model: this.config.model,
          fileMode: this.config.useFileMode,
          hasApiKey: !!this.config.apiKey,
          timeout: this.config.timeout,
          contentLength: content.length,
        },
      });

      const finalMessage = suggestion
        ? `AI 总结生成失败：${errorMessage}\n\n${suggestion}`
        : `AI 总结生成失败：${errorMessage}`;

      throw new Error(finalMessage);
    }
  }

  /**
   * 构建文件模式的用户提示词
   */
  private buildFilePrompt(timeRange: string, messageCount: number, guildId: string): string {
    const groupInfo = this.getGroupInfo(guildId);
    const groupConfig = this.getGroupAIConfig(guildId);

    if (groupConfig.userPromptTemplate) {
      return this.replaceTemplate(groupConfig.userPromptTemplate, {
        timeRange,
        messageCount: messageCount.toString(),
        groupInfo,
        content: '',
      });
    }
    return getDefaultFilePrompt(timeRange, messageCount, groupInfo);
  }

  /**
   * 测试 AI 接口连接
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    if (!this.isEnabled()) {
      return {
        success: false,
        error: 'AI 功能未启用或配置不完整',
      };
    }

    try {
      const result = await this.generateSummary(
        '用户 A: 你好\n用户 B: 你好，今天天气不错',
        '测试',
        2,
        'private'
      );

      if (result) {
        return { success: true };
      } else {
        return {
          success: false,
          error: '测试失败',
        };
      }
    } catch (error: any) {
      return {
        success: false,
        error: handleError(error, '连接测试失败'),
      };
    }
  }

  /**
   * 解析用户的自然语言分析查询
   * 返回时间范围和分析提示词
   */
  async parseAnalysisQuery(
    userQuery: string,
    guildId: string
  ): Promise<{
    timeRange: string;
    analysisPrompt: string;
  }> {
    return parseAnalysisQueryHelper(
      {
        isEnabled: this.isEnabled.bind(this),
        hasApiConfig: () => !!this.config.apiUrl && !!this.config.apiKey,
        getApiMode: this.getApiMode.bind(this),
        getTimeout: (fallback) => this.config.timeout || fallback,
        getApiUrl: () => this.config.apiUrl,
        getGroupInfo: this.getGroupInfo.bind(this),
        generateTextWithMessages: this.generateTextWithMessages.bind(this),
        logger: this.logger,
      },
      userQuery,
      guildId
    );
  }

  /**
   * 执行聊天记录分析
   */
  async analyzeChat(
    content: string,
    analysisPrompt: string,
    timeRange: string,
    messageCount: number,
    guildId: string
  ): Promise<string> {
    return analyzeChatHelper(
      {
        isEnabled: this.isEnabled.bind(this),
        hasApiConfig: () => !!this.config.apiUrl && !!this.config.apiKey,
        getApiMode: this.getApiMode.bind(this),
        getTimeout: (fallback) => this.config.timeout || fallback,
        getApiUrl: () => this.config.apiUrl,
        getGroupInfo: this.getGroupInfo.bind(this),
        generateTextWithMessages: this.generateTextWithMessages.bind(this),
        logger: this.logger,
      },
      content,
      analysisPrompt,
      timeRange,
      messageCount,
      guildId
    );
  }

  /**
   * 生成结构化的 AI 总结
   * 返回固定格式的 JSON 数据，由前端代码负责渲染
   */
  async generateStructuredSummary(
    content: string,
    timeRange: string,
    messageCount: number,
    guildId: string,
    uniqueUsers: number
  ): Promise<AISummaryOutput> {
    if (!this.isEnabled(guildId)) {
      throw new Error('AI 总结功能未启用或该群组已禁用 AI 功能');
    }

    if (!this.config.apiUrl || !this.config.apiKey) {
      throw new Error('AI 配置不完整，请检查 API URL 和密钥');
    }

    const maxRetries = 2;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const groupInfo = this.getGroupInfo(guildId);

        const userPrompt = buildStructuredSummaryPrompt(
          timeRange,
          messageCount,
          uniqueUsers,
          groupInfo,
          content
        );

        this.logger.debug(`发送结构化总结请求 (尝试 ${attempt}/${maxRetries})`, {
          url: this.config.apiUrl,
          mode: this.getApiMode(),
          model: this.config.model || 'gpt-5.4',
          contentLength: content.length,
        });

        const timeoutSeconds = Math.max(this.config.timeout || 120, 120);

        const responseContent = await this.generateTextWithMessages({
          messages: [
            { role: 'system', content: STRUCTURED_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.5,
          timeoutSeconds,
        });

        if (!responseContent) {
          throw new Error('AI 响应内容为空');
        }

        // 解析 JSON 响应
        const parsed = parseStructuredResponse(responseContent, this.logger);

        this.logger.info('结构化 AI 总结生成成功', {
          inputLength: content.length,
          hotTopicsCount: parsed.hotTopics.length,
          quotesCount: parsed.quotes.length,
        });

        return parsed;
      } catch (error: any) {
        lastError = error;
        this.logger.warn(`结构化总结生成失败 (尝试 ${attempt}/${maxRetries})`, {
          error: error.message,
        });

        if (attempt < maxRetries) {
          // 等待一会儿再重试
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
    }

    this.logger.error('结构化总结生成最终失败，使用默认结构', {
      error: lastError?.message,
    });

    return getDefaultAISummaryOutput();
  }
}
