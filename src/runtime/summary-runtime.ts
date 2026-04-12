import axios from 'axios';
import { AIService, StructuredSummaryGenerationError } from '../ai/ai-service';
import { ChatLogFileRecord, DailyReport } from '../core/types';
import { extractHttpErrorContext, sanitizeUrlForLog } from '../core/error-utils';
import { createTimeInUTC8, getCurrentTimeInUTC8, getDateStringInUTC8 } from '../core/utils';
import { StatisticsService } from '../data/statistics';
import { CardRenderer } from '../rendering/card-renderer';
import { RuntimeDeps, SummaryRuntime } from './plugin-types';
import { getNextExecutionTime } from './upload-runtime';
import { getEffectiveGroupConfig } from './summary-common';
import { createSummaryPushService } from './summary-push';

export function createSummaryRuntime(deps: RuntimeDeps): SummaryRuntime {
  const { ctx, config, logger, dbOps, s3Service } = deps;
  const schedulers: Map<string, NodeJS.Timeout> = new Map();
  const delayedPushSchedulers: Map<string, NodeJS.Timeout> = new Map();
  const activeSummaryTasks: Map<string, Promise<string | undefined>> = new Map();
  const activePushTasks: Map<string, Promise<void>> = new Map();
  const pushedSummaryKeys: Set<string> = new Set();
  const { pushSummaryToGroup, pushSummaryToConfiguredGroups } = createSummaryPushService(
    ctx,
    config,
    logger
  );

  const getSummaryRetryMaxAttempts = (): number => {
    if (config.ai.summaryRetryEnabled === false) {
      return 1;
    }

    return Math.max(config.ai.summaryRetryMaxAttempts ?? 3, 1);
  };

  const isSummaryRetryEnabled = (): boolean => {
    return config.ai.summaryRetryEnabled !== false;
  };

  const shouldBlockAutoSummaryAfterFailure = (record: ChatLogFileRecord): boolean => {
    return config.ai.strictSummarySuccess !== false && record.summaryStatus === 'failed';
  };

  const getGroupTaskKey = (date: string, groupId?: string): string => {
    return `${date}:${groupId || 'private'}`;
  };

  const getPushedSummaryKey = (date: string, groupId: string, imageUrl: string): string => {
    return `${date}:${groupId}:${imageUrl}`;
  };

  const getDelayedPushKey = (date: string, groupId: string): string => {
    return `delayed:${date}:${groupId}`;
  };

  const runExclusiveTask = <T>(
    tasks: Map<string, Promise<T>>,
    taskKey: string,
    factory: () => Promise<T>,
    onReuse?: () => void
  ): Promise<T> => {
    const existingTask = tasks.get(taskKey);
    if (existingTask) {
      onReuse?.();
      return existingTask;
    }

    const task = factory().finally(() => {
      tasks.delete(taskKey);
    });
    tasks.set(taskKey, task);
    return task;
  };

  const markSummaryAttemptStarted = async (recordId: number): Promise<void> => {
    await dbOps.updateChatLogFileSummaryState(recordId, {
      summaryStatus: 'pending',
      summaryRetryCount: 0,
      summaryLastAttemptAt: Date.now(),
      summaryNextRetryAt: 0,
      summaryLastError: undefined,
    });
  };

  const getFailureMessage = (error: unknown): string => {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  };

  const handleSummaryFailure = async (record: ChatLogFileRecord, error: unknown): Promise<void> => {
    if (!record.id) {
      return;
    }

    const failure =
      error instanceof StructuredSummaryGenerationError
        ? error
        : new StructuredSummaryGenerationError(
            getFailureMessage(error),
            getSummaryRetryMaxAttempts(),
            getSummaryRetryMaxAttempts(),
            isSummaryRetryEnabled()
          );
    const retryCount = Math.max(failure.attempts - 1, 0);
    const maxRetryAttempts = getSummaryRetryMaxAttempts();

    await dbOps.updateChatLogFileSummaryState(record.id, {
      summaryStatus: 'failed',
      summaryRetryCount: retryCount,
      summaryLastAttemptAt: Date.now(),
      summaryNextRetryAt: 0,
      summaryLastError: failure.message,
      summaryImageUrl: undefined,
      summaryGeneratedAt: 0,
    });

    logger.error('AI 总结生成失败', {
      recordId: record.id,
      date: record.date,
      guildId: record.guildId || 'private',
      attempts: failure.attempts,
      maxAttempts: maxRetryAttempts,
      retryEnabled: failure.retryEnabled,
      error: failure.message,
    });
  };

  const generateSummaryForRecordInternal = async (
    record: ChatLogFileRecord,
    skipPush: boolean = false,
    options: { disableAiRetries?: boolean } = {}
  ): Promise<string | undefined> => {
    if (!record.s3Key && !record.s3Url) {
      logger.warn(`记录 ${record.id} 没有可用的 S3 键或 URL，跳过`);
      return;
    }

    const s3Uploader = s3Service.getUploader();
    if (!s3Uploader) {
      logger.error('S3 上传器未初始化');
      return;
    }

    if (record.id) {
      await markSummaryAttemptStarted(record.id);
    }

    try {
      const groupInfo = record.guildId ? `群组 ${record.guildId}` : '私聊';
      logger.info(`正在为 ${groupInfo} 生成增强版 AI 总结 (${record.date})`);

      let response = '';
      let sdkDownloadError: string | undefined;

      if (record.s3Key && config.s3.isPrivate) {
        const sdkResult = await s3Uploader.downloadText(record.s3Key);
        if (sdkResult.success && sdkResult.content) {
          response = sdkResult.content;
          logger.info(`聊天记录下载成功（S3 SDK 鉴权）: ${record.s3Key}`);
        } else {
          sdkDownloadError = sdkResult.error || '未知错误';
          logger.warn(`S3 SDK 下载失败，将回退到 URL 下载：${sdkDownloadError}`);
        }
      }

      if (!response) {
        if (!record.s3Url) {
          const sdkDetail = sdkDownloadError ? `，S3 SDK 错误：${sdkDownloadError}` : '';
          throw new Error(`下载聊天记录文件失败（无可用 S3 URL）${sdkDetail}`);
        }

        try {
          const downloadResponse = await axios.get<string>(record.s3Url, {
            timeout: 30000,
            responseType: 'text',
          });
          response = downloadResponse.data;
          if (!config.s3.isPrivate) {
            logger.info(`聊天记录下载成功（公开 URL 直链）: ${record.s3Url}`);
          }
        } catch (downloadError) {
          const errorContext = await extractHttpErrorContext(downloadError);
          logger.error('下载聊天记录文件失败', {
            recordId: record.id,
            date: record.date,
            guildId: record.guildId || 'private',
            s3Key: record.s3Key,
            s3Url: sanitizeUrlForLog(record.s3Url),
            sdkDownloadError,
            message: errorContext.message,
            statusCode: errorContext.statusCode,
            statusText: errorContext.statusText,
            requestUrl: errorContext.requestUrl,
            responseBody: errorContext.responseBody,
          });

          const statusLabel = errorContext.statusCode
            ? `HTTP ${errorContext.statusCode}`
            : '未知状态';
          const statusText = errorContext.statusText ? ` ${errorContext.statusText}` : '';
          const requestUrl = errorContext.requestUrl
            ? `，请求地址：${sanitizeUrlForLog(errorContext.requestUrl)}`
            : '';
          const detail = errorContext.responseBody
            ? `，响应详情：${errorContext.responseBody}`
            : '';
          const sdkDetail = sdkDownloadError ? `，S3 SDK 错误：${sdkDownloadError}` : '';

          throw new Error(
            `下载聊天记录文件失败（${statusLabel}${statusText}）${requestUrl}${detail}${sdkDetail}`
          );
        }
      }

      if (!response) {
        throw new Error('无法下载聊天记录文件');
      }

      const statisticsService = new StatisticsService(ctx.logger('chat-summarizer:statistics'));
      const aiService = new AIService(ctx, config);
      const cardRenderer = new CardRenderer(ctx);

      const messages = statisticsService.parseMessages(response);
      const statistics = statisticsService.generateStatistics(messages, 10);
      logger.info(
        `统计完成：${statistics.basicStats.totalMessages} 条消息，${statistics.basicStats.uniqueUsers} 位用户`
      );

      const aiContent = await aiService.generateStructuredSummary(
        response,
        record.date,
        statistics.basicStats.totalMessages,
        record.guildId || 'private',
        statistics.basicStats.uniqueUsers,
        {
          disableRetries: options.disableAiRetries,
        }
      );

      const dailyReport: DailyReport = {
        date: record.date,
        guildId: record.guildId || 'private',
        aiContent,
        statistics,
        metadata: {
          generatedAt: Date.now(),
          aiModel: config.ai.model || 'gpt-5.4',
        },
      };

      const imageBuffer = await cardRenderer.renderDailyReport(dailyReport);
      const imageKey = `summary-images/${record.date}/${record.guildId || 'private'}_${record.id}_${Date.now()}.png`;
      const uploadResult = await s3Uploader.uploadBuffer(imageBuffer, imageKey, 'image/png');

      if (uploadResult.success && uploadResult.url) {
        await dbOps.updateChatLogFileSummaryImage(record.id!, uploadResult.url);
        logger.info(`✅ ${groupInfo} 增强版 AI 总结生成成功：${uploadResult.url}`);
        if (!skipPush) {
          const pushed = await pushSummaryToConfiguredGroups(
            imageBuffer,
            record.guildId,
            'image/png'
          );
          if (pushed && record.guildId) {
            pushedSummaryKeys.add(
              getPushedSummaryKey(record.date, record.guildId, uploadResult.url)
            );
          }
        }
        return uploadResult.url;
      }

      throw new Error(`图片上传失败：${uploadResult.error}`);
    } catch (error: unknown) {
      await handleSummaryFailure(record, error);
      throw error;
    }
  };

  const generateSummaryForRecord = async (
    record: ChatLogFileRecord,
    skipPush: boolean = false,
    options: { disableAiRetries?: boolean } = {}
  ): Promise<string | undefined> => {
    const taskKey = getGroupTaskKey(record.date, record.guildId);

    return runExclusiveTask(
      activeSummaryTasks,
      taskKey,
      async () => generateSummaryForRecordInternal(record, skipPush, options),
      () => {
        logger.info(
          `AI 总结任务已在执行，复用现有任务（recordId=${record.id ?? 'unknown'}，date=${record.date}，guildId=${record.guildId || 'private'}）`
        );
      }
    );
  };

  const executeGroupSummary = async (groupId: string): Promise<string | undefined> => {
    if (!config.ai.enabled) {
      if (config.debug) {
        logger.info(`AI 总结功能已禁用，跳过群组 ${groupId}`);
      }
      return;
    }

    if (!s3Service.getUploader()) {
      logger.error('S3 上传器未初始化，无法执行自动总结');
      return;
    }

    const yesterday = getCurrentTimeInUTC8();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = getDateStringInUTC8(yesterday.getTime());

    return runExclusiveTask(
      activeSummaryTasks,
      getGroupTaskKey(dateStr, groupId),
      async () => {
        try {
          const record = await dbOps.getChatLogFileForRetry(dateStr, groupId);

          if (!record) {
            if (config.debug) {
              logger.info(`群组 ${groupId} 在 ${dateStr} 没有需要生成 AI 总结的记录`);
            }
            return;
          }

          if (record.summaryImageUrl) {
            if (config.debug) {
              logger.info(`群组 ${groupId} 在 ${dateStr} 已生成过 AI 总结，跳过`);
            }
            return record.summaryImageUrl;
          }

          if (shouldBlockAutoSummaryAfterFailure(record)) {
            logger.warn(
              `群组 ${groupId} 在 ${dateStr} 的 AI 总结已标记为最终失败，严格模式下跳过后续自动生成`
            );
            return;
          }

          logger.info(`开始为群组 ${groupId} 生成 AI 总结 (${dateStr})`);
          const imageUrl = await generateSummaryForRecordInternal(record, true);
          if (imageUrl) {
            logger.info(`群组 ${groupId} 的 AI 总结生成成功：${imageUrl}`);
          }
          return imageUrl;
        } catch (error) {
          logger.error(`群组 ${groupId} 在 ${dateStr} 的 AI 总结执行失败`, error);
          return;
        }
      },
      () => {
        logger.info(`群组 ${groupId} 在 ${dateStr} 的 AI 总结任务已在执行，等待现有任务完成`);
      }
    );
  };

  const executeGroupPush = async (groupId: string): Promise<void> => {
    const groupConfig = config.monitor.groups.find((g) => g.groupId === groupId);
    if (!groupConfig) {
      logger.warn(`未找到群组 ${groupId} 的配置，跳过推送`);
      return;
    }

    const effectiveConfig = getEffectiveGroupConfig(config, groupConfig);
    if (!effectiveConfig.pushEnabled) {
      if (config.debug) {
        logger.info(`群组 ${groupId} 已禁用推送`);
      }
      return;
    }

    const yesterday = getCurrentTimeInUTC8();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = getDateStringInUTC8(yesterday.getTime());

    await runExclusiveTask(activePushTasks, getGroupTaskKey(dateStr, groupId), async () => {
      try {
        const summaryImageUrl = await dbOps.getSummaryImageUrl(dateStr, groupId);

        if (!summaryImageUrl) {
          logger.warn(`群组 ${groupId} 在 ${dateStr} 没有可推送的 AI 总结图片`);
          return;
        }

        const pushedSummaryKey = getPushedSummaryKey(dateStr, groupId, summaryImageUrl);
        if (pushedSummaryKeys.has(pushedSummaryKey)) {
          if (config.debug) {
            logger.info(`群组 ${groupId} 在 ${dateStr} 的 AI 总结已推送过，跳过重复推送`);
          }
          return;
        }

        if (effectiveConfig.smartPushDelayEnabled) {
          const now = getCurrentTimeInUTC8();
          const originalPushTime = createTimeInUTC8(now, effectiveConfig.pushTime);
          const extraPushTime = createTimeInUTC8(now, effectiveConfig.smartPushDelayTime);
          const isOriginalWindow = Math.abs(now.getTime() - originalPushTime.getTime()) < 60 * 1000;
          const delayKey = getDelayedPushKey(dateStr, groupId);

          if (isOriginalWindow && extraPushTime > now) {
            const windowStart = new Date(originalPushTime.getTime());
            windowStart.setMinutes(
              windowStart.getMinutes() - effectiveConfig.smartPushDelayWindowMinutes
            );

            const messageCount = await dbOps.countMessagesByGuildAndTimeRange(
              groupId,
              windowStart.getTime(),
              originalPushTime.getTime()
            );

            if (messageCount > effectiveConfig.smartPushDelayMessageThreshold) {
              if (delayedPushSchedulers.has(delayKey)) {
                if (config.debug) {
                  logger.info(`群组 ${groupId} 的延迟推送已安排，跳过重复创建`);
                }
                return;
              }

              const delay = extraPushTime.getTime() - now.getTime();
              const timeout = setTimeout(async () => {
                delayedPushSchedulers.delete(delayKey);
                await executeGroupPush(groupId);
              }, delay);
              delayedPushSchedulers.set(delayKey, timeout);

              logger.info(
                `群组 ${groupId} 在推送前 ${effectiveConfig.smartPushDelayWindowMinutes} 分钟内消息 ${messageCount} 条，超过阈值 ${effectiveConfig.smartPushDelayMessageThreshold}，已延迟到 ${effectiveConfig.smartPushDelayTime} 推送`
              );
              return;
            }
          }
        }

        let pushImageUrl = summaryImageUrl;
        const s3Uploader = s3Service.getUploader();
        if (s3Uploader) {
          try {
            pushImageUrl = await s3Uploader.getAccessibleUrlByStoredUrl(summaryImageUrl);
          } catch (error) {
            logger.warn(`生成总结推送可访问链接失败，将回退原链接: ${error}`);
          }
        }

        logger.info(`开始推送群组 ${groupId} 的 AI 总结`);
        if (effectiveConfig.pushToSelf) {
          await pushSummaryToGroup(pushImageUrl, groupId);
        }

        for (const target of effectiveConfig.forwardGroups || []) {
          await pushSummaryToGroup(pushImageUrl, target.groupId);
        }

        pushedSummaryKeys.add(pushedSummaryKey);
      } catch (error) {
        logger.error(`推送群组 ${groupId} 的总结失败`, error);
      }
    });
  };

  const executeAutoSummary = async (): Promise<void> => {
    if (!config.ai.enabled) {
      if (config.debug) {
        logger.info('自动总结功能已禁用，跳过执行');
      }
      return;
    }

    if (!s3Service.getUploader()) {
      logger.error('S3 上传器未初始化，无法执行自动总结');
      return;
    }

    try {
      logger.info('开始执行自动 AI 总结生成');
      const yesterday = getCurrentTimeInUTC8();
      yesterday.setDate(yesterday.getDate() - 1);
      const dateStr = getDateStringInUTC8(yesterday.getTime());
      const recordsToSummarize = (await dbOps.getChatLogFilesForSummary(dateStr)).filter(
        (record) => !shouldBlockAutoSummaryAfterFailure(record)
      );

      if (recordsToSummarize.length === 0) {
        if (config.debug) {
          logger.info(`没有找到需要生成 AI 总结的记录 (${dateStr})`);
        }
        return;
      }

      logger.info(`发现 ${recordsToSummarize.length} 个文件需要生成 AI 总结`);
      const results = await Promise.allSettled(
        recordsToSummarize.map(async (record) => generateSummaryForRecord(record))
      );
      const failedCount = results.filter((result) => result.status === 'rejected').length;

      logger.info(
        `自动 AI 总结生成完成（成功 ${results.length - failedCount}，失败 ${failedCount}）`
      );
    } catch (error: unknown) {
      logger.error('执行自动 AI 总结时发生错误', error);
    }
  };

  const clearAllSchedulers = (): void => {
    for (const [time, timeout] of schedulers.entries()) {
      clearTimeout(timeout);
      if (config.debug) {
        logger.info(`已清理 ${time} 的调度器`);
      }
    }
    schedulers.clear();

    for (const timeout of delayedPushSchedulers.values()) {
      clearTimeout(timeout);
    }
    delayedPushSchedulers.clear();
  };

  const getScheduleTimePoints = (): Map<
    string,
    { summaryGroups: string[]; pushGroups: string[] }
  > => {
    const timePoints = new Map<string, { summaryGroups: string[]; pushGroups: string[] }>();

    for (const groupConfig of config.monitor.groups) {
      const effective = getEffectiveGroupConfig(config, groupConfig);
      if (effective.summaryEnabled) {
        if (!timePoints.has(effective.summaryTime)) {
          timePoints.set(effective.summaryTime, { summaryGroups: [], pushGroups: [] });
        }
        timePoints.get(effective.summaryTime)!.summaryGroups.push(effective.groupId);
      }

      if (effective.pushEnabled) {
        if (!timePoints.has(effective.pushTime)) {
          timePoints.set(effective.pushTime, { summaryGroups: [], pushGroups: [] });
        }
        timePoints.get(effective.pushTime)!.pushGroups.push(effective.groupId);
      }
    }

    return timePoints;
  };

  const scheduleTimePoint = (
    time: string,
    tasks: { summaryGroups: string[]; pushGroups: string[] }
  ): void => {
    if (schedulers.has(time)) {
      clearTimeout(schedulers.get(time)!);
    }

    const nextExecution = getNextExecutionTime(time);
    const delay = nextExecution.getTime() - Date.now();

    if (config.debug) {
      const summaryInfo =
        tasks.summaryGroups.length > 0 ? `总结: ${tasks.summaryGroups.join(', ')}` : '';
      const pushInfo = tasks.pushGroups.length > 0 ? `推送: ${tasks.pushGroups.join(', ')}` : '';
      const taskInfo = [summaryInfo, pushInfo].filter(Boolean).join(' | ');
      logger.info(`调度 ${time}: ${taskInfo} (下次执行：${nextExecution.toLocaleString('zh-CN')})`);
    }

    const timeout = setTimeout(async () => {
      logger.info(`执行 ${time} 的定时任务`);

      const summaryGroups = new Set(tasks.summaryGroups);
      const pushGroups = new Set(tasks.pushGroups);
      const groupIds = Array.from(new Set([...tasks.summaryGroups, ...tasks.pushGroups]));

      await Promise.allSettled(
        groupIds.map(async (groupId) => {
          if (summaryGroups.has(groupId)) {
            await executeGroupSummary(groupId);
          }

          if (pushGroups.has(groupId)) {
            await executeGroupPush(groupId);
          }
        })
      );

      scheduleTimePoint(time, tasks);
    }, delay);

    schedulers.set(time, timeout);
  };

  const scheduleAllTasks = (): void => {
    if (!config.ai.enabled) {
      if (config.debug) {
        logger.info('AI 功能未启用，跳过调度');
      }
      return;
    }

    if (config.monitor.groups.length === 0) {
      if (config.debug) {
        logger.info('没有配置群组，跳过调度');
      }
      return;
    }

    clearAllSchedulers();
    const timePoints = getScheduleTimePoints();

    if (timePoints.size === 0) {
      if (config.debug) {
        logger.info('没有需要调度的任务');
      }
      return;
    }

    for (const [time, tasks] of timePoints.entries()) {
      scheduleTimePoint(time, tasks);
    }
    logger.info(`已设置 ${timePoints.size} 个时间点的定时任务`);
  };

  return {
    executeGroupSummary,
    executeGroupPush,
    executeAutoSummary,
    scheduleAllTasks,
    scheduleAutoSummary: scheduleAllTasks,
    clearAllSchedulers,
    generateSummaryForRecord,
  };
}
