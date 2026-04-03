import { Context, h } from 'koishi';
import { Config } from '../core/types';
import { getEffectiveGroupConfig } from './summary-common';

type LoggerLike = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string, error?: unknown) => void;
};

export function createSummaryPushService(ctx: Context, config: Config, logger: LoggerLike) {
  const pushSummaryToGroup = async (
    imageSource: string | Buffer,
    groupId: string,
    channelId?: string,
    platform?: string,
    contentType: string = 'image/png'
  ): Promise<boolean> => {
    const messageElements = [
      Buffer.isBuffer(imageSource) ? h.image(imageSource, contentType) : h.image(imageSource),
    ];

    for (const bot of ctx.bots) {
      try {
        if (platform && bot.platform !== platform) {
          continue;
        }

        const targetId = channelId || groupId;
        await bot.sendMessage(targetId, messageElements);
        logger.info(`成功推送总结到群 ${groupId}${channelId ? ` (频道: ${channelId})` : ''}`);
        return true;
      } catch (err) {
        if (config.debug) {
          logger.warn(`Bot ${bot.sid} 推送到 ${groupId} 失败：${err}`);
        }
      }
    }

    logger.error(`所有 Bot 均无法推送到群 ${groupId}`);
    return false;
  };

  const pushSummaryToConfiguredGroups = async (
    imageSource: string | Buffer,
    sourceGroupId: string | undefined,
    contentType: string = 'image/png'
  ): Promise<boolean> => {
    if (!sourceGroupId) {
      if (config.debug) {
        logger.info('源群组 ID 为空，跳过推送');
      }
      return false;
    }

    const groupConfig = config.monitor.groups.find((g) => g.groupId === sourceGroupId);
    if (!groupConfig) {
      if (config.debug) {
        logger.info(`群组 ${sourceGroupId} 不在配置列表中，跳过推送`);
      }
      return false;
    }

    const effectiveConfig = getEffectiveGroupConfig(config, groupConfig);
    if (!effectiveConfig.pushEnabled) {
      if (config.debug) {
        logger.info(`群组 ${sourceGroupId} 已禁用推送`);
      }
      return false;
    }

    const targets: string[] = [];
    if (effectiveConfig.pushToSelf) {
      targets.push(sourceGroupId);
    }

    for (const target of effectiveConfig.forwardGroups || []) {
      targets.push(target.groupId);
    }

    if (targets.length === 0) {
      if (config.debug) {
        logger.info(`群组 ${sourceGroupId} 没有配置推送目标`);
      }
      return false;
    }

    logger.info(`开始推送群组 ${sourceGroupId} 的总结到 ${targets.length} 个目标`);
    let hasSuccess = false;
    for (const targetGroupId of targets) {
      try {
        const pushed = await pushSummaryToGroup(
          imageSource,
          targetGroupId,
          undefined,
          undefined,
          contentType
        );
        hasSuccess = hasSuccess || pushed;
      } catch (error: any) {
        logger.error(`推送到群组 ${targetGroupId} 失败`, error);
      }
    }

    return hasSuccess;
  };

  return {
    pushSummaryToGroup,
    pushSummaryToConfiguredGroups,
  };
}
