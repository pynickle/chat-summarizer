import { buildAnalysisParsePrompts, buildAnalyzeChatPrompts } from './ai-prompts';

type GenerateTextWithMessages = (options: {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature: number;
  timeoutSeconds: number;
}) => Promise<string>;

type LoggerLike = {
  debug: (message: string, data?: unknown) => void;
  info: (message: string, data?: unknown) => void;
  error: (message: string, data?: unknown) => void;
};

type AnalysisDeps = {
  isEnabled: (guildId?: string) => boolean;
  hasApiConfig: () => boolean;
  getApiMode: () => 'chat.completions' | 'responses';
  getTimeout: (fallback: number) => number;
  getApiUrl: () => string;
  getGroupInfo: (guildId: string) => string;
  generateTextWithMessages: GenerateTextWithMessages;
  logger: LoggerLike;
};

export async function parseAnalysisQuery(
  deps: AnalysisDeps,
  userQuery: string,
  guildId: string
): Promise<{ timeRange: string; analysisPrompt: string }> {
  if (!deps.isEnabled(guildId)) {
    throw new Error('AI 功能未启用或该群组已禁用 AI 功能');
  }

  if (!deps.hasApiConfig()) {
    throw new Error('AI 配置不完整，请检查 API URL 和密钥');
  }

  try {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const { systemPrompt, userPrompt } = buildAnalysisParsePrompts(today, yesterdayStr, userQuery);

    deps.logger.debug('发送查询解析请求', {
      url: deps.getApiUrl(),
      mode: deps.getApiMode(),
      userQuery,
    });

    const content = await deps.generateTextWithMessages({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      timeoutSeconds: deps.getTimeout(30),
    });

    if (!content) {
      throw new Error('AI 返回内容为空');
    }

    let parsedResult: any;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('响应中未找到 JSON 格式');
      }
      parsedResult = JSON.parse(jsonMatch[0]);
    } catch (parseError: any) {
      deps.logger.error('解析 AI 返回的 JSON 失败', { content, error: parseError });
      throw new Error(`解析 AI 响应失败：${parseError.message}`);
    }

    if (!parsedResult.timeRange || !parsedResult.analysisPrompt) {
      throw new Error('AI 返回的 JSON 缺少必需字段');
    }

    deps.logger.info('查询解析成功', {
      userQuery,
      timeRange: parsedResult.timeRange,
      analysisPromptLength: parsedResult.analysisPrompt.length,
    });

    return {
      timeRange: parsedResult.timeRange,
      analysisPrompt: parsedResult.analysisPrompt,
    };
  } catch (error: any) {
    deps.logger.error('解析用户查询失败', {
      error: error.message,
      stack: error.stack,
    });
    throw new Error(`解析查询失败：${error.message}`);
  }
}

export async function analyzeChat(
  deps: AnalysisDeps,
  content: string,
  analysisPrompt: string,
  timeRange: string,
  messageCount: number,
  guildId: string
): Promise<string> {
  if (!deps.isEnabled(guildId)) {
    throw new Error('AI 功能未启用或该群组已禁用 AI 功能');
  }

  if (!deps.hasApiConfig()) {
    throw new Error('AI 配置不完整，请检查 API URL 和密钥');
  }

  try {
    const groupInfo = deps.getGroupInfo(guildId);
    const prompts = buildAnalyzeChatPrompts(
      analysisPrompt,
      timeRange,
      messageCount,
      groupInfo,
      content
    );

    deps.logger.debug('发送分析请求', {
      url: deps.getApiUrl(),
      mode: deps.getApiMode(),
      contentLength: content.length,
      timeRange,
    });

    const analysisResult = await deps.generateTextWithMessages({
      messages: [
        { role: 'system', content: prompts.systemPrompt },
        { role: 'user', content: prompts.userPrompt },
      ],
      temperature: 0.7,
      timeoutSeconds: deps.getTimeout(60),
    });

    if (!analysisResult) {
      throw new Error('AI 返回内容为空');
    }

    deps.logger.info('分析完成', {
      inputLength: content.length,
      outputLength: analysisResult.length,
    });

    return analysisResult;
  } catch (error: any) {
    deps.logger.error('聊天记录分析失败', {
      error: error.message,
      stack: error.stack,
    });
    throw new Error(`分析失败：${error.message}`);
  }
}
