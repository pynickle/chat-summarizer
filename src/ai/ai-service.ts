import { Context, Logger } from 'koishi';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText, type FilePart, type ImagePart, type ModelMessage, type TextPart } from 'ai';
import { Config, AISummaryOutput } from '../core/types';
import { handleError } from '../core/utils';
import { CONSTANTS, STRUCTURED_SYSTEM_PROMPT } from '../core/config';
import { extractHttpErrorContext, trimForLog } from '../core/error-utils';
import {
  buildStructuredSummaryPrompt,
  getDefaultFilePrompt,
  getDefaultSystemPrompt,
  getDefaultUserPromptTemplate,
} from './ai-prompts';
import { getDefaultAISummaryOutput, parseStructuredResponse } from './structured-parser';
import {
  analyzeChat as analyzeChatHelper,
  parseAnalysisQuery as parseAnalysisQueryHelper,
} from './analysis-service';
import { S3Uploader } from '../storage/s3-uploader';

type MessageRecord = {
  time?: string;
  timestamp?: number;
  userId?: string;
  username?: string;
  content?: string;
  message?: string;
  imageUrls?: unknown;
  fileUrls?: unknown;
  videoUrls?: unknown;
};

type PreparedChatPayload = {
  textContent: string;
  mediaParts: Array<ImagePart | FilePart>;
};

type MediaBuildResult = {
  mediaParts: Array<ImagePart | FilePart>;
  expiredImageUrls: string[];
};

const EXPIRED_IMAGE_MARKER = '[图片已失效:external_image_url_unavailable]';

export class AIService {
  private logger: Logger;
  private globalConfig: Config;
  private s3Uploader: S3Uploader | null;

  constructor(ctx: Context, config: Config) {
    this.logger = ctx.logger('chat-summarizer:ai');
    this.globalConfig = config;
    this.s3Uploader = this.createInternalS3Uploader();
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

  private createInternalS3Uploader(): S3Uploader | null {
    if (
      !this.globalConfig.s3.enabled ||
      !this.globalConfig.s3.bucket ||
      !this.globalConfig.s3.accessKeyId ||
      !this.globalConfig.s3.secretAccessKey
    ) {
      return null;
    }

    return new S3Uploader({
      region: CONSTANTS.S3_REGION,
      bucket: this.globalConfig.s3.bucket,
      isPrivate: this.globalConfig.s3.isPrivate,
      accessKeyId: this.globalConfig.s3.accessKeyId,
      secretAccessKey: this.globalConfig.s3.secretAccessKey,
      endpoint: this.globalConfig.s3.endpoint,
      pathPrefix: this.globalConfig.s3.pathPrefix,
    });
  }

  private isResponsesContentBlocksEnabled(): boolean {
    return this.getApiMode() === 'responses' && this.config.useResponsesContentBlocks !== false;
  }

  private isAudioUrl(url: string): boolean {
    return /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac|amr|webm)(\?|$)/i.test(url);
  }

  private inferAudioMediaType(url: string): string {
    if (/\.wav(\?|$)/i.test(url)) return 'audio/wav';
    if (/\.m4a(\?|$)/i.test(url)) return 'audio/mp4';
    if (/\.aac(\?|$)/i.test(url)) return 'audio/aac';
    if (/\.(ogg|oga)(\?|$)/i.test(url)) return 'audio/ogg';
    if (/\.opus(\?|$)/i.test(url)) return 'audio/opus';
    if (/\.flac(\?|$)/i.test(url)) return 'audio/flac';
    if (/\.amr(\?|$)/i.test(url)) return 'audio/amr';
    if (/\.webm(\?|$)/i.test(url)) return 'audio/webm';
    return 'audio/mpeg';
  }

  private parseUrlArray(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === 'string' && !!item.trim());
    }

    if (typeof value === 'string' && value.trim().startsWith('[')) {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          return parsed.filter((item): item is string => typeof item === 'string' && !!item.trim());
        }
      } catch {
        return [];
      }
    }

    return [];
  }

  private parseRecords(content: string): MessageRecord[] | null {
    const trimmed = content.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed as MessageRecord[];
        }
      } catch {
        return null;
      }
    }

    const lines = content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      return null;
    }

    const records: MessageRecord[] = [];

    for (const line of lines) {
      try {
        const record = JSON.parse(line) as MessageRecord;
        records.push(record);
      } catch {
        return null;
      }
    }

    return records;
  }

  private formatRecordsAsText(records: MessageRecord[]): string {
    return records
      .map((record) => {
        const time =
          record.time ||
          (typeof record.timestamp === 'number'
            ? new Date(record.timestamp).toISOString()
            : '未知时间');
        const userId = record.userId || 'unknown';
        const username = record.username || '未知用户';
        const message = record.content || record.message || '';
        const videos = this.parseUrlArray(record.videoUrls);
        const videoText = videos.length > 0 ? ` | 视频链接: ${videos.join(' ')}` : '';

        return `时间: ${time} | userId: ${userId} | username: ${username} | 消息: ${message}${videoText}`;
      })
      .join('\n');
  }

  private async toAccessibleUrl(url: string): Promise<string> {
    if (!this.globalConfig.s3.isPrivate || !this.s3Uploader) {
      return url;
    }

    try {
      return await this.s3Uploader.getAccessibleUrlByStoredUrl(url);
    } catch {
      return url;
    }
  }

  private isConfiguredS3Url(url: string): boolean {
    return this.s3Uploader?.isManagedStoredUrl(url) ?? false;
  }

  private isLikelyImageContentType(contentType: string): boolean {
    return contentType.startsWith('image/') || contentType.includes('application/octet-stream');
  }

  private isExpiredImagePayload(payload: string): boolean {
    try {
      const parsed = JSON.parse(payload) as {
        retcode?: unknown;
        retmsg?: unknown;
      };

      const retCode = typeof parsed.retcode === 'number' ? parsed.retcode : null;
      const retMsg = typeof parsed.retmsg === 'string' ? parsed.retmsg.toLowerCase() : '';

      return retCode === -5503007 || retMsg.includes('download url has expired');
    } catch {
      return false;
    }
  }

  private async isImageUrlExpired(url: string): Promise<boolean> {
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), 8000);

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: abortController.signal,
        redirect: 'follow',
        headers: {
          Accept: 'image/*,application/json;q=0.9,*/*;q=0.1',
        },
      });

      const contentType = response.headers.get('content-type')?.toLowerCase() || '';
      const isLikelyImage = this.isLikelyImageContentType(contentType);

      if (response.ok && !isLikelyImage) {
        return true;
      }

      if (!response.ok && response.status >= 400 && response.status < 500) {
        const body = await response.text();
        if (this.isExpiredImagePayload(body)) {
          return true;
        }
        return !isLikelyImage;
      }

      const shouldReadAsText =
        contentType.includes('application/json') ||
        contentType.includes('text/json') ||
        contentType.includes('text/plain');

      if (!shouldReadAsText) {
        return false;
      }

      const body = await response.text();
      return this.isExpiredImagePayload(body);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        this.logger.warn('检测图片链接是否失效超时，保留原链接');
      }
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  private async buildMediaParts(records: MessageRecord[]): Promise<MediaBuildResult> {
    const mediaParts: Array<ImagePart | FilePart> = [];
    const expiredImageUrls: string[] = [];

    for (const record of records) {
      const imageUrls = this.parseUrlArray(record.imageUrls);
      const fileUrls = this.parseUrlArray(record.fileUrls);

      for (const imageUrl of imageUrls) {
        const isManagedS3Url = this.isConfiguredS3Url(imageUrl);
        const accessibleUrl = await this.toAccessibleUrl(imageUrl);
        const isExpired = isManagedS3Url ? false : await this.isImageUrlExpired(accessibleUrl);
        if (isExpired) {
          expiredImageUrls.push(imageUrl, accessibleUrl);
          continue;
        }

        try {
          mediaParts.push({
            type: 'image',
            image: new URL(accessibleUrl),
          });
        } catch {
          continue;
        }
      }

      for (const fileUrl of fileUrls) {
        if (!this.isAudioUrl(fileUrl)) {
          continue;
        }

        const accessibleUrl = await this.toAccessibleUrl(fileUrl);
        try {
          mediaParts.push({
            type: 'file',
            data: new URL(accessibleUrl),
            mediaType: this.inferAudioMediaType(fileUrl),
          });
        } catch {
          continue;
        }
      }
    }

    return {
      mediaParts,
      expiredImageUrls,
    };
  }

  private applyExpiredImageMarkers(textContent: string, expiredImageUrls: string[]): string {
    if (expiredImageUrls.length === 0) {
      return textContent;
    }

    const uniqueUrls = Array.from(new Set(expiredImageUrls.filter(Boolean)));
    let sanitizedText = textContent;

    for (const expiredUrl of uniqueUrls) {
      sanitizedText = sanitizedText.split(expiredUrl).join(EXPIRED_IMAGE_MARKER);
    }

    const markerSummary =
      `\n\n[图片处理标记] 检测到 ${uniqueUrls.length} 个外部图片链接已失效，` +
      `已从多模态输入中移除，统一标记为 ${EXPIRED_IMAGE_MARKER}`;

    this.logger.warn(
      `检测到 ${uniqueUrls.length} 个外部图片链接已失效，跳过传递给 AI（使用标记 ${EXPIRED_IMAGE_MARKER}）`
    );

    return sanitizedText + markerSummary;
  }

  private async prepareChatPayload(content: string): Promise<PreparedChatPayload> {
    const records = this.parseRecords(content);
    const useTextFormat = this.config.formatChatContentAsText !== false;
    const textContent = records && useTextFormat ? this.formatRecordsAsText(records) : content;

    if (!records) {
      return {
        textContent,
        mediaParts: [],
      };
    }

    const mediaBuildResult = await this.buildMediaParts(records);
    const sanitizedText = this.applyExpiredImageMarkers(
      textContent,
      mediaBuildResult.expiredImageUrls
    );

    if (!this.isResponsesContentBlocksEnabled()) {
      return {
        textContent: sanitizedText,
        mediaParts: [],
      };
    }

    return {
      textContent: sanitizedText,
      mediaParts: mediaBuildResult.mediaParts,
    };
  }

  private buildOpenAIProvider() {
    if (!this.config.apiKey || !this.config.apiUrl) {
      throw new Error('AI 配置不完整，请检查 API URL 和密钥');
    }

    return createOpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.apiUrl,
    });
  }

  private buildModel() {
    const modelName = this.config.model || 'gpt-5.4';
    const openai = this.buildOpenAIProvider();
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
      const openai = this.buildOpenAIProvider();
      const canUseWebSearch =
        this.getApiMode() === 'responses' && this.config.webSearchEnabled !== false;

      const result = await generateText({
        model:
          this.getApiMode() === 'responses'
            ? openai.responses(this.config.model || 'gpt-5.4')
            : openai.chat(this.config.model || 'gpt-5.4'),
        messages: options.messages,
        temperature: options.temperature,
        maxOutputTokens:
          this.config.maxTokens && this.config.maxTokens > 0 ? this.config.maxTokens : undefined,
        tools: canUseWebSearch
          ? {
              web_search: openai.tools.webSearch(),
            }
          : undefined,
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
      const preparedPayload = await this.prepareChatPayload(content);

      if (this.config.useFileMode) {
        // 文件模式：使用云雾 API 的聊天 + 读取文件接口格式
        this.logger.debug('使用文件模式发送请求');

        // 构建文件模式的用户提示词，将内容直接包含在文本中
        const filePrompt = this.buildFilePrompt(timeRange, messageCount, guildId);
        userPrompt = `${filePrompt}\n\n📄 **聊天记录内容：**\n\n${preparedPayload.textContent}`;
      } else {
        // 传统模式：直接发送文本内容
        this.logger.debug('使用传统模式发送请求');

        const userPromptTemplate = groupConfig.userPromptTemplate || getDefaultUserPromptTemplate();
        userPrompt = this.replaceTemplate(userPromptTemplate, {
          timeRange,
          messageCount: messageCount.toString(),
          groupInfo: this.getGroupInfo(guildId),
          content: preparedPayload.textContent,
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

      const userContent: string | Array<TextPart | ImagePart | FilePart> =
        this.isResponsesContentBlocksEnabled() && preparedPayload.mediaParts.length > 0
          ? [{ type: 'text', text: userPrompt }, ...preparedPayload.mediaParts]
          : userPrompt;

      const summary = await this.generateTextWithMessages({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
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
        useResponsesContentBlocks: this.isResponsesContentBlocksEnabled(),
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

        const preparedPayload = await this.prepareChatPayload(content);

        const userPrompt = buildStructuredSummaryPrompt(
          timeRange,
          messageCount,
          uniqueUsers,
          groupInfo,
          preparedPayload.textContent
        );

        this.logger.debug(`发送结构化总结请求 (尝试 ${attempt}/${maxRetries})`, {
          url: this.config.apiUrl,
          mode: this.getApiMode(),
          model: this.config.model || 'gpt-5.4',
          contentLength: content.length,
        });

        const timeoutSeconds = Math.max(this.config.timeout || 120, 120);

        const userContent: string | Array<TextPart | ImagePart | FilePart> =
          this.isResponsesContentBlocksEnabled() && preparedPayload.mediaParts.length > 0
            ? [{ type: 'text', text: userPrompt }, ...preparedPayload.mediaParts]
            : userPrompt;

        const responseContent = await this.generateTextWithMessages({
          messages: [
            { role: 'system', content: STRUCTURED_SYSTEM_PROMPT },
            { role: 'user', content: userContent },
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
