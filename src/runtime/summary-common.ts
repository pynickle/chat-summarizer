import { Config, GroupConfig } from '../core/types';

export type EffectiveGroupConfig = {
  groupId: string;
  name?: string;
  monitorEnabled: boolean;
  summaryEnabled: boolean;
  summaryTime: string;
  pushEnabled: boolean;
  pushTime: string;
  pushToSelf: boolean;
  forwardGroups: GroupConfig['forwardGroups'];
  systemPrompt?: string;
  userPromptTemplate?: string;
};

export function getEffectiveGroupConfig(config: Config, groupConfig: GroupConfig): EffectiveGroupConfig {
  const defaultSummaryTime = config.ai.defaultSummaryTime || '03:00';
  const defaultPushTime = config.ai.defaultPushTime || defaultSummaryTime;

  return {
    groupId: groupConfig.groupId,
    name: groupConfig.name,
    monitorEnabled: groupConfig.monitorEnabled !== false,
    summaryEnabled: groupConfig.summaryEnabled !== undefined ? groupConfig.summaryEnabled : config.ai.enabled,
    summaryTime: groupConfig.summaryTime || defaultSummaryTime,
    pushEnabled: groupConfig.pushEnabled !== false,
    pushTime: groupConfig.pushTime || groupConfig.summaryTime || defaultPushTime,
    pushToSelf: groupConfig.pushToSelf !== false,
    forwardGroups: groupConfig.forwardGroups || [],
    systemPrompt: groupConfig.systemPrompt,
    userPromptTemplate: groupConfig.userPromptTemplate,
  };
}

type LoggerLike = {
  error: (message: string, error?: unknown) => void;
};

export function filterMessagesForSummary(jsonContent: string, logger: LoggerLike): string {
  try {
    const lines = jsonContent.split('\n').filter((line) => line.trim());
    const filteredMessages: any[] = [];

    for (const line of lines) {
      try {
        const record = JSON.parse(line);
        if (record.messageType === 'text' && record.content && record.content.trim()) {
          filteredMessages.push({
            time: record.time,
            username: record.username,
            content: record.content,
            guildId: record.guildId,
            messageType: record.messageType,
          });
        }
      } catch {}
    }

    return filteredMessages
      .map((msg) => {
        const time = msg.time.split(' ')[1] || msg.time;
        return `${time} ${msg.username}: ${msg.content}`;
      })
      .join('\n');
  } catch (error) {
    logger.error('过滤聊天记录失败', error);
    return jsonContent;
  }
}
