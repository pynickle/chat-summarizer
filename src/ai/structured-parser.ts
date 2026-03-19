import { AISummaryOutput } from '../core/types';

type LoggerLike = {
  error: (message: string, data?: unknown) => void;
};

export function parseStructuredResponse(content: string, logger: LoggerLike): AISummaryOutput {
  try {
    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    } else {
      const objMatch = content.match(/\{[\s\S]*\}/);
      if (objMatch) {
        jsonStr = objMatch[0];
      }
    }

    const parsed = JSON.parse(jsonStr);
    return validateAndNormalizeOutput(parsed);
  } catch (parseError: any) {
    logger.error('解析 AI 结构化响应失败', {
      content: content.substring(0, 500),
      error: parseError.message,
    });
    throw new Error(`JSON 解析失败：${parseError.message}`);
  }
}

function validateAndNormalizeOutput(parsed: any): AISummaryOutput {
  const summary = parsed.summary || {};

  const output: AISummaryOutput = {
    summary: {
      overview: summary.overview || '今日群内互动平稳，主要以日常交流为主。',
      highlights: Array.isArray(summary.highlights) ? summary.highlights : [],
      atmosphere: summary.atmosphere || '轻松日常',
    },
    hotTopics: [],
    importantInfo: [],
    quotes: [],
  };

  if (Array.isArray(parsed.hotTopics)) {
    output.hotTopics = parsed.hotTopics
      .filter((t: any) => t && t.topic)
      .map((t: any) => ({
        topic: t.topic || '',
        description: t.description || '',
        participants: Array.isArray(t.participants) ? t.participants : [],
        heatLevel: ['high', 'medium', 'low'].includes(t.heatLevel) ? t.heatLevel : 'medium',
      }))
      .slice(0, 5);
  }

  if (Array.isArray(parsed.importantInfo)) {
    output.importantInfo = parsed.importantInfo
      .filter((i: any) => i && i.content)
      .map((i: any) => ({
        type: ['announcement', 'link', 'resource', 'decision', 'other'].includes(i.type)
          ? i.type
          : 'other',
        content: i.content || '',
        source: i.source,
      }))
      .slice(0, 10);
  }

  if (Array.isArray(parsed.quotes)) {
    output.quotes = parsed.quotes
      .filter((q: any) => q && q.content && q.author)
      .map((q: any) => ({
        content: q.content || '',
        author: q.author || '匿名',
      }))
      .slice(0, 5);
  }

  return output;
}

export function getDefaultAISummaryOutput(): AISummaryOutput {
  return {
    summary: {
      overview: '今日群内互动情况已记录，AI 分析暂时不可用。',
      highlights: ['群内有日常交流活动'],
      atmosphere: '日常',
    },
    hotTopics: [],
    importantInfo: [],
    quotes: [],
  };
}
