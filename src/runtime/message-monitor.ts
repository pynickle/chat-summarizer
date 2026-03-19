import { Session } from 'koishi';
import { ChatRecord } from '../core/types';
import { safeJsonStringify } from '../core/utils';
import { CONSTANTS } from '../core/config';
import { MessageRuntime, MessageRuntimeDeps } from './plugin-types';

export function createMessageRuntime(deps: MessageRuntimeDeps): MessageRuntime {
  const {
    ctx,
    config,
    logger,
    dbOps,
    messageService,
    saveMessageToLocalFile,
    processFileUploadsAsync,
  } = deps;

  const shouldMonitorMessage = (session: Session): boolean => {
    if (!config.chatLog.enabled) {
      return false;
    }

    if (!session.guildId) {
      return false;
    }

    if (config.monitor.groups.length > 0) {
      const groupConfig = config.monitor.groups.find((group) => group.groupId === session.guildId);
      if (!groupConfig) {
        return false;
      }

      if (groupConfig.monitorEnabled === false) {
        return false;
      }
    }

    if (config.monitor.excludedUsers.length > 0) {
      const normalizedUserId = messageService.normalizeUserId(session.userId);
      if (config.monitor.excludedUsers.includes(normalizedUserId)) {
        return false;
      }
    }

    if (config.monitor.excludeBots && session.bot && session.userId === session.bot.userId) {
      return false;
    }

    return true;
  };

  const addReplyPrefix = async (content: string, session: Session): Promise<string> => {
    if (!session.quote) {
      return content;
    }

    const quoteAuthor =
      session.quote.user?.name ||
      session.quote.user?.username ||
      CONSTANTS.DEFAULTS.QUOTE_AUTHOR_FALLBACK;
    const quoteId = session.quote.messageId || '';
    let quoteContent = session.quote.content || '';

    if (quoteId) {
      try {
        const existingRecord = await ctx.database.get('chat_records', { messageId: quoteId });
        if (existingRecord.length > 0) {
          quoteContent = existingRecord[0].content;
        }
      } catch {
        if (config.debug) {
          logger.debug(`无法从数据库获取回复消息内容：${quoteId}`);
        }
      }
    }

    let replyPrefix = '';
    if (quoteContent) {
      const truncatedContent =
        quoteContent.length > 50 ? `${quoteContent.substring(0, 50)}...` : quoteContent;
      replyPrefix = `[回复 ${quoteAuthor}: ${truncatedContent}] `;
    } else if (quoteId) {
      replyPrefix = `[回复 ${quoteAuthor} 的消息] `;
    } else {
      replyPrefix = `[回复 ${quoteAuthor}] `;
    }

    return replyPrefix + content;
  };

  const handleMessage = async (session: Session): Promise<void> => {
    if (!shouldMonitorMessage(session)) {
      return;
    }

    try {
      const messageId = session.messageId || `${session.userId}_${Date.now()}`;
      const timestamp = session.timestamp || Date.now();
      const username = session.username || '未知用户';
      const userId = messageService.normalizeUserId(session.userId);
      const guildId = session.guildId;
      const channelId = session.channelId || session.userId;

      const processed = messageService.processElements(session.elements);

      let content = processed.content;
      content = await addReplyPrefix(content, session);

      const record: Omit<ChatRecord, 'id'> = {
        messageId,
        guildId,
        channelId,
        userId,
        username,
        content,
        originalElements: safeJsonStringify(session.elements),
        timestamp,
        messageType: processed.messageType,
        imageUrls:
          processed.imageUrls.length > 0 ? safeJsonStringify(processed.imageUrls) : undefined,
        fileUrls: processed.fileUrls.length > 0 ? safeJsonStringify(processed.fileUrls) : undefined,
        videoUrls:
          processed.videoUrls.length > 0 ? safeJsonStringify(processed.videoUrls) : undefined,
        isUploaded: false,
      };

      await dbOps.createChatRecord(record);
      await saveMessageToLocalFile(record);

      if (
        processed.imageUrls.length > 0 ||
        processed.fileUrls.length > 0 ||
        processed.videoUrls.length > 0
      ) {
        Promise.resolve()
          .then(() =>
            processFileUploadsAsync(
              processed.imageUrls,
              processed.fileUrls,
              processed.videoUrls,
              messageId,
              guildId,
              record
            )
          )
          .catch((error) => {
            logger.error('异步文件上传处理失败', error);
          });
      }

      if (config.debug) {
        logger.info(
          `消息处理完成：${username} - ${content.substring(0, 50)}${content.length > 50 ? '...' : ''}`
        );
      }
    } catch (error: any) {
      logger.error('处理消息时发生错误', error);
    }
  };

  return {
    shouldMonitorMessage,
    addReplyPrefix,
    handleMessage,
  };
}
