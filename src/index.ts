import { Context, Session } from 'koishi';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Config } from './core/types';
import { name, inject, ConfigSchema } from './core/config';
import { extendDatabase, DatabaseOperations } from './data/database';
import { LoggerService, S3Service, MessageProcessorService } from './runtime/services';
import { CommandHandler } from './commands';
import { SafeFileWriter } from './data/file-writer';
import { createChatRecordPipeline } from './runtime/chat-record-pipeline';
import { createUploadRuntime, getNextExecutionTime } from './runtime/upload-runtime';
import { createSummaryRuntime } from './runtime/summary-runtime';
import { createMessageRuntime } from './runtime/message-monitor';

export { name, inject };
export { ConfigSchema as Config };

export function apply(ctx: Context, config: Config) {
  extendDatabase(ctx);

  const logger = new LoggerService(ctx, config);
  const dbOps = new DatabaseOperations(ctx);
  const s3Service = new S3Service(config, logger);
  const messageService = new MessageProcessorService(config.chatLog.includeImages);
  const fileWriter = new SafeFileWriter(ctx.logger('chat-summarizer:file-writer'));

  const getStorageDir = (subDir: string): string => {
    return path.join(ctx.baseDir, 'data', 'chat-summarizer', subDir);
  };

  const ensureDir = async (dirPath: string): Promise<void> => {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error: any) {
      logger.error(`创建目录失败：${dirPath}`, error);
    }
  };

  const initStorageDirs = async (): Promise<void> => {
    await ensureDir(getStorageDir('data'));
    logger.info('存储目录初始化完成');
  };

  const { saveMessageToLocalFile, processFileUploadsAsync } = createChatRecordPipeline({
    config,
    logger,
    dbOps,
    s3Service,
    fileWriter,
    getStorageDir,
  });

  const uploadRuntime = createUploadRuntime({
    ctx,
    config,
    logger,
    dbOps,
    s3Service,
    messageService,
    fileWriter,
    getStorageDir,
  });

  const summaryRuntime = createSummaryRuntime({
    ctx,
    config,
    logger,
    dbOps,
    s3Service,
    messageService,
    fileWriter,
    getStorageDir,
  });

  const messageRuntime = createMessageRuntime({
    ctx,
    config,
    logger,
    dbOps,
    s3Service,
    messageService,
    fileWriter,
    getStorageDir,
    saveMessageToLocalFile,
    processFileUploadsAsync,
  });

  const initializePlugin = async (): Promise<void> => {
    try {
      await initStorageDirs();
      s3Service.init();

      const commandHandler = new CommandHandler(
        ctx,
        config,
        dbOps,
        s3Service.getUploader(),
        getStorageDir,
        getNextExecutionTime,
        summaryRuntime.generateSummaryForRecord
      );
      commandHandler.registerCommands();

      if (config.chatLog.enabled && s3Service.getUploader()) {
        uploadRuntime.scheduleAutoUpload();
      }

      if (config.chatLog.enabled) {
        uploadRuntime.scheduleDbCleanup();
        setTimeout(() => uploadRuntime.executeDatabaseCleanup(), 5000);
      }

      if (config.ai.enabled && s3Service.getUploader() && config.monitor.groups.length > 0) {
        summaryRuntime.scheduleAllTasks();
      }

      if (config.debug) {
        logger.info('插件初始化完成 (调试模式已开启)');
        logger.info(`数据库记录保留时间：${config.chatLog.dbRetentionHours} 小时`);

        for (const groupConfig of config.monitor.groups) {
          const defaultSummaryTime = config.ai.defaultSummaryTime || '03:00';
          const defaultPushTime = config.ai.defaultPushTime || defaultSummaryTime;
          const summaryEnabled =
            groupConfig.summaryEnabled !== undefined ? groupConfig.summaryEnabled : config.ai.enabled;
          const summaryTime = groupConfig.summaryTime || defaultSummaryTime;
          const pushEnabled = groupConfig.pushEnabled !== false;
          const pushTime = groupConfig.pushTime || groupConfig.summaryTime || defaultPushTime;
          const monitorEnabled = groupConfig.monitorEnabled !== false;
          const groupName = groupConfig.name
            ? `${groupConfig.name}(${groupConfig.groupId})`
            : groupConfig.groupId;

          logger.info(
            `群组 ${groupName}: 监控=${monitorEnabled}, 总结=${summaryEnabled}@${summaryTime}, 推送=${pushEnabled}@${pushTime}`
          );
        }
      } else {
        logger.info('插件初始化完成');
        if (config.monitor.groups.length > 0) {
          const summaryEnabledGroups = config.monitor.groups.filter((g) => {
            if (g.summaryEnabled !== undefined) {
              return g.summaryEnabled;
            }
            return config.ai.enabled;
          }).length;

          if (summaryEnabledGroups > 0) {
            logger.info(`自动 AI 总结已启用，${summaryEnabledGroups} 个群组已配置`);
          }
        }
      }
    } catch (error: any) {
      logger.error('插件初始化失败', error);
    }
  };

  ctx.on('message', async (session: Session) => {
    await messageRuntime.handleMessage(session);
  });

  ctx.on('ready', initializePlugin);

  ctx.on('dispose', async () => {
    uploadRuntime.clearUploadScheduler();
    uploadRuntime.clearCleanupScheduler();
    summaryRuntime.clearAllSchedulers();

    try {
      await fileWriter.flush();
      fileWriter.dispose();
      logger.info('所有文件写入操作已完成，文件写入器已清理');
    } catch (error: any) {
      logger.error('等待文件写入完成时发生错误', error);
    }

    logger.info('聊天记录插件已卸载，已清理所有定时任务');
  });
}
