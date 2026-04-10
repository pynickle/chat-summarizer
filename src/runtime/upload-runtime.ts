import * as fs from 'fs/promises';
import * as path from 'path';
import {
  DatabaseCleanupSummary,
  FileRecord,
  ImageRecord,
  LocalFileCleanupSummary,
  VideoRecord,
} from '../core/types';
import { getCurrentTimeInUTC8, getDateStringInUTC8 } from '../core/utils';
import { expandObjectKeyCandidates, normalizeObjectKeyForComparison } from '../storage/s3-object-ops';
import { S3Uploader, UploadResult } from '../storage/s3-uploader';
import { RuntimeDeps, UploadRuntime } from './plugin-types';

export function getNextExecutionTime(targetTime: string): Date {
  const now = getCurrentTimeInUTC8();
  const [hours, minutes] = targetTime.split(':').map(Number);

  const next = new Date(now);
  next.setHours(hours, minutes, 0, 0);

  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }

  return next;
}

export function createUploadRuntime(deps: RuntimeDeps): UploadRuntime {
  const { ctx, config, logger, dbOps, s3Service, getStorageDir } = deps;
  const managedMediaKeyRoots = ['images/', 'files/', 'videos/'];

  let uploadScheduler: NodeJS.Timeout | null = null;
  let cleanupScheduler: NodeJS.Timeout | null = null;

  const isManagedMediaRecord = (
    record: Pick<ImageRecord | FileRecord | VideoRecord, 's3Key' | 's3Url'>,
    s3Uploader: S3Uploader | null
  ): boolean => {
    const normalizedKey = normalizeObjectKeyForComparison(config.s3, record.s3Key || '');
    const hasManagedKeyRoot = managedMediaKeyRoots.some((root) => normalizedKey.startsWith(root));

    if (hasManagedKeyRoot) {
      return true;
    }

    if (s3Uploader && record.s3Url) {
      return s3Uploader.isManagedStoredUrl(record.s3Url);
    }

    return false;
  };

  const handleFileRetention = async (filePath: string): Promise<void> => {
    try {
      if (config.chatLog.retentionDays > 0) {
        const fileStats = await fs.stat(filePath).catch(() => null);
        if (!fileStats) {
          logger.warn(`无法获取文件状态，跳过清理：${path.basename(filePath)}`);
          return;
        }

        const fileModifiedTime = fileStats.mtime;
        const retentionDate = getCurrentTimeInUTC8();
        retentionDate.setDate(retentionDate.getDate() - config.chatLog.retentionDays);

        if (fileModifiedTime <= retentionDate) {
          await fs.unlink(filePath);
          if (config.debug) {
            logger.info(
              `已删除过期文件: ${path.basename(filePath)} (保留${config.chatLog.retentionDays}天，文件修改时间: ${fileModifiedTime.toLocaleString('zh-CN')})`
            );
          }
        } else if (config.debug) {
          const remainingDays = Math.ceil(
            (fileModifiedTime.getTime() - retentionDate.getTime()) / (1000 * 60 * 60 * 24)
          );
          logger.info(
            `保留文件: ${path.basename(filePath)} (还需保留${remainingDays}天，文件修改时间: ${fileModifiedTime.toLocaleString('zh-CN')})`
          );
        }
      }
    } catch (error: any) {
      logger.error(`处理文件保留策略失败: ${filePath}`, error);
    }
  };

  const checkIfDateGroupAlreadyUploaded = async (
    date: Date,
    groupKey: string
  ): Promise<boolean> => {
    try {
      const dateStr = getDateStringInUTC8(date.getTime());
      const guildIdCondition = groupKey === 'private' ? undefined : groupKey;
      const isAlreadyUploaded = await dbOps.checkChatLogFileUploaded(dateStr, guildIdCondition);

      if (isAlreadyUploaded) {
        logger.debug(`群组 ${groupKey} 在 ${dateStr} 的记录已上传`);
        return true;
      }

      const startTime = new Date(date);
      startTime.setHours(0, 0, 0, 0);
      const endTime = new Date(date);
      endTime.setHours(23, 59, 59, 999);

      const totalRecords = await ctx.database.get('chat_records', {
        timestamp: { $gte: startTime.getTime(), $lte: endTime.getTime() },
        guildId: guildIdCondition,
      });

      if (totalRecords.length === 0) {
        logger.debug(`群组 ${groupKey} 在 ${dateStr} 没有消息记录`);
        return true;
      }

      logger.debug(`群组 ${groupKey} 在 ${dateStr} 有 ${totalRecords.length} 条记录待上传`);
      return false;
    } catch (error: any) {
      logger.error(`检查上传状态失败 (群组：${groupKey})`, error);
      return false;
    }
  };

  const createOrUpdateChatLogFileRecord = async (
    date: Date,
    groupKey: string,
    filePath: string,
    s3Key: string,
    fileSize: number,
    recordCount: number,
    s3Url?: string,
    status: 'pending' | 'uploading' | 'uploaded' | 'failed' = 'pending',
    error?: string
  ): Promise<void> => {
    try {
      const dateStr = getDateStringInUTC8(date.getTime());
      const guildIdCondition = groupKey === 'private' ? undefined : groupKey;
      const existingRecord = await dbOps.getChatLogFileRecord(dateStr, guildIdCondition);

      if (existingRecord) {
        await dbOps.updateChatLogFileRecord(existingRecord.id!, {
          s3Url,
          fileSize,
          recordCount,
          status,
          error,
          uploadedAt: status === 'uploaded' ? Date.now() : existingRecord.uploadedAt,
        });

        if (config.debug) {
          logger.info(
            `已更新聊天记录文件上传记录 (群组：${groupKey}, 日期：${dateStr}, 状态：${status})`
          );
        }
      } else {
        await dbOps.createChatLogFileRecord({
          guildId: guildIdCondition,
          date: dateStr,
          filePath,
          s3Key,
          s3Url,
          fileSize,
          recordCount,
          uploadedAt: status === 'uploaded' ? Date.now() : 0,
          status,
          error,
        });

        if (config.debug) {
          logger.info(
            `已创建聊天记录文件上传记录 (群组：${groupKey}, 日期：${dateStr}, 状态：${status})`
          );
        }
      }
    } catch (error: any) {
      logger.error(`创建或更新聊天记录文件上传记录失败 (群组：${groupKey})`, error);
    }
  };

  const executeAutoUpload = async (): Promise<void> => {
    const s3Uploader = s3Service.getUploader();
    if (!s3Uploader) {
      logger.error('S3 上传器未初始化，无法执行自动上传');
      return;
    }

    try {
      logger.info('开始执行聊天记录自动上传');

      const yesterday = getCurrentTimeInUTC8();
      yesterday.setDate(yesterday.getDate() - 1);
      const dateStr = getDateStringInUTC8(yesterday.getTime());

      const dataDir = getStorageDir('data');
      const files = await fs.readdir(dataDir);

      const targetFiles = files.filter(
        (file) => file.endsWith(`_${dateStr}.jsonl`) && file !== `.${dateStr}.jsonl`
      );

      if (targetFiles.length === 0) {
        if (config.debug) {
          logger.info(`没有找到昨天 (${dateStr}) 的聊天记录文件`);
        }
        return;
      }

      if (config.debug) {
        logger.info(`发现 ${targetFiles.length} 个待上传文件：${targetFiles.join(', ')}`);
      } else {
        logger.info(`发现 ${targetFiles.length} 个待上传文件`);
      }

      const filesToUpload: Array<{ filePath: string; key: string; groupKey: string }> = [];

      for (const fileName of targetFiles) {
        const groupKey = fileName.replace(`_${dateStr}.jsonl`, '');
        const filePath = path.join(dataDir, fileName);

        try {
          const fileStats = await fs.stat(filePath);
          if (fileStats.size === 0) {
            logger.warn(`跳过空文件：${fileName}`);
            continue;
          }
        } catch {
          logger.warn(`文件状态检查失败：${fileName}`);
          continue;
        }

        const isAlreadyUploaded = await checkIfDateGroupAlreadyUploaded(yesterday, groupKey);
        if (isAlreadyUploaded) {
          if (config.debug) {
            logger.info(`跳过已上传文件：${fileName} (群组 ${groupKey} 的 ${dateStr} 记录已上传)`);
          }
          continue;
        }

        const s3Key = S3Uploader.generateChatLogKey(
          yesterday,
          groupKey === 'private' ? undefined : groupKey
        );

        filesToUpload.push({ filePath, key: s3Key, groupKey });
      }

      if (filesToUpload.length === 0) {
        if (config.debug) {
          logger.info('没有有效的文件需要上传');
        }
        return;
      }

      logger.info(`开始上传 ${filesToUpload.length} 个文件`);

      const uploadPromises = filesToUpload.map(async (fileToUpload) => {
        try {
          if (config.debug) {
            logger.info(`正在上传：${path.basename(fileToUpload.filePath)} -> ${fileToUpload.key}`);
          }

          const uploadPromise = s3Uploader.uploadFile(
            fileToUpload.filePath,
            fileToUpload.key,
            'application/x-ndjson; charset=utf-8'
          );

          const timeoutPromise = new Promise<UploadResult>((_, reject) => {
            setTimeout(() => reject(new Error('上传超时（60 秒）')), 60000);
          });

          const result = await Promise.race([uploadPromise, timeoutPromise]);
          const resultWithMeta = {
            ...result,
            groupKey: fileToUpload.groupKey,
            filePath: fileToUpload.filePath,
          };

          if (result.success) {
            if (config.debug) {
              logger.info(`✅ 群组 ${fileToUpload.groupKey} 上传成功：${result.url}`);
            }

            const fileStats = await fs.stat(fileToUpload.filePath);
            const fileContent = await fs.readFile(fileToUpload.filePath, 'utf-8');
            const recordCount = fileContent
              .split('\n')
              .filter((line) => line.trim().length > 0).length;

            await createOrUpdateChatLogFileRecord(
              yesterday,
              fileToUpload.groupKey,
              fileToUpload.filePath,
              fileToUpload.key,
              fileStats.size,
              recordCount,
              result.url,
              'uploaded'
            );

            await handleFileRetention(fileToUpload.filePath);
          } else {
            logger.error(`❌ 群组 ${fileToUpload.groupKey} 上传失败：${result.error}`);
            const fileStats = await fs.stat(fileToUpload.filePath).catch(() => ({ size: 0 }));
            await createOrUpdateChatLogFileRecord(
              yesterday,
              fileToUpload.groupKey,
              fileToUpload.filePath,
              fileToUpload.key,
              fileStats.size,
              0,
              undefined,
              'failed',
              result.error
            );
          }

          return resultWithMeta;
        } catch (error: any) {
          logger.error(`处理文件 ${fileToUpload.groupKey} 时发生错误`, error);
          return {
            success: false,
            error: error.message,
            groupKey: fileToUpload.groupKey,
            filePath: fileToUpload.filePath,
          };
        }
      });

      const settledResults = await Promise.allSettled(uploadPromises);
      const finalResults = settledResults.map((result) =>
        result.status === 'fulfilled' ? result.value : { success: false, error: '上传异常' }
      );

      const successCount = finalResults.filter((r) => r.success).length;
      logger.info(`聊天记录自动上传完成：${successCount}/${finalResults.length} 个文件上传成功`);
    } catch (error: any) {
      logger.error('执行聊天记录自动上传时发生错误', error);
    }
  };

  const executeLocalFileCleanup = async (): Promise<LocalFileCleanupSummary> => {
    try {
      if (config.chatLog.retentionDays <= 0) {
        return {
          checkedFiles: 0,
          deletedFiles: 0,
        };
      }

      const dataDir = getStorageDir('data');
      const files = await fs.readdir(dataDir).catch(() => []);
      if (files.length === 0) {
        return {
          checkedFiles: 0,
          deletedFiles: 0,
        };
      }

      const retentionDate = getCurrentTimeInUTC8();
      retentionDate.setDate(retentionDate.getDate() - config.chatLog.retentionDays);

      let deletedCount = 0;
      let checkedCount = 0;

      for (const fileName of files) {
        if (!fileName.endsWith('.jsonl')) {
          continue;
        }

        const filePath = path.join(dataDir, fileName);
        try {
          const fileStats = await fs.stat(filePath);
          checkedCount++;
          if (fileStats.mtime <= retentionDate) {
            await fs.unlink(filePath);
            deletedCount++;

            if (config.debug) {
              logger.info(
                `已清理过期本地文件: ${fileName} (修改时间: ${fileStats.mtime.toLocaleString('zh-CN')})`
              );
            }
          }
        } catch (error: any) {
          if (config.debug) {
            logger.warn(`处理本地文件失败: ${fileName} - ${error.message}`);
          }
        }
      }

      if (deletedCount > 0) {
        logger.info(
          `本地文件清理完成：检查 ${checkedCount} 个文件，删除 ${deletedCount} 个过期文件 (保留${config.chatLog.retentionDays}天)`
        );
      } else if (config.debug) {
        logger.info(`本地文件清理完成：检查 ${checkedCount} 个文件，无过期文件需要删除`);
      }

      return {
        checkedFiles: checkedCount,
        deletedFiles: deletedCount,
      };
    } catch (error: any) {
      logger.error('执行本地文件清理时发生错误', error);
      return {
        checkedFiles: 0,
        deletedFiles: 0,
      };
    }
  };

  const executeDatabaseCleanup = async (): Promise<DatabaseCleanupSummary> => {
    try {
      if (config.debug) {
        logger.info('开始执行数据库清理');
      }

      const result = await dbOps.cleanupExpiredRecords(
        config.chatLog.dbRetentionHours,
        config.chatLog.mediaRetentionDays
      );
      const s3Uploader = s3Service.getUploader();
      const expiredImageRecords = result.expiredImageRecords.filter((record) =>
        isManagedMediaRecord(record, s3Uploader)
      );
      const expiredFileRecords = result.expiredFileRecords.filter((record) =>
        isManagedMediaRecord(record, s3Uploader)
      );
      const expiredVideoRecords = result.expiredVideoRecords.filter((record) =>
        isManagedMediaRecord(record, s3Uploader)
      );
      const mediaKeys = [
        ...expiredImageRecords.map((record) => record.s3Key),
        ...expiredFileRecords.map((record) => record.s3Key),
        ...expiredVideoRecords.map((record) => record.s3Key),
      ];

      let deletedImageRecords = config.chatLog.mediaRetentionDays > 0 ? 0 : result.deletedImageRecords;
      let deletedFileRecords = config.chatLog.mediaRetentionDays > 0 ? 0 : result.deletedFileRecords;
      let deletedVideoRecords = config.chatLog.mediaRetentionDays > 0 ? 0 : result.deletedVideoRecords;
      let deletableMediaObjectCount = 0;
      let deletedMediaObjectCount = 0;
      let skippedSharedMediaObjectCount = 0;
      let s3DeletionError: string | undefined;

      if (config.chatLog.mediaRetentionDays > 0 && mediaKeys.length > 0) {
        if (!s3Uploader) {
          logger.warn(
            `检测到 ${mediaKeys.length} 个过期媒体对象，但 S3 上传器未初始化，已跳过媒体清理`
          );
        } else {
          const expiredImageRecordIds = new Set(
            expiredImageRecords
              .map((record) => record.id)
              .filter((id): id is number => typeof id === 'number')
          );
          const expiredFileRecordIds = new Set(
            expiredFileRecords
              .map((record) => record.id)
              .filter((id): id is number => typeof id === 'number')
          );
          const expiredVideoRecordIds = new Set(
            expiredVideoRecords
              .map((record) => record.id)
              .filter((id): id is number => typeof id === 'number')
          );

          const normalizeMediaKey = (key: string) => normalizeObjectKeyForComparison(config.s3, key);
          const uniqueMediaKeys = Array.from(
            new Set(mediaKeys.map((key) => key.trim()).filter((key) => key.length > 0))
          );
          const referenceSnapshot = await dbOps.getMediaReferenceSnapshotByKeys(
            Array.from(
              new Set(uniqueMediaKeys.flatMap((key) => expandObjectKeyCandidates(config.s3, key)))
            )
          );
          const deletableKeys = Array.from(
            new Set(
              uniqueMediaKeys.filter((key) => {
                const referencedByActiveImage = referenceSnapshot.imageRecords.some(
                  (record) =>
                    normalizeMediaKey(record.s3Key) === normalizeMediaKey(key) &&
                    typeof record.id === 'number' &&
                    !expiredImageRecordIds.has(record.id)
                );
                const referencedByActiveFile = referenceSnapshot.fileRecords.some(
                  (record) =>
                    normalizeMediaKey(record.s3Key) === normalizeMediaKey(key) &&
                    typeof record.id === 'number' &&
                    !expiredFileRecordIds.has(record.id)
                );
                const referencedByActiveVideo = referenceSnapshot.videoRecords.some(
                  (record) =>
                    normalizeMediaKey(record.s3Key) === normalizeMediaKey(key) &&
                    typeof record.id === 'number' &&
                    !expiredVideoRecordIds.has(record.id)
                );

                return !referencedByActiveImage && !referencedByActiveFile && !referencedByActiveVideo;
              })
            )
          );
          deletableMediaObjectCount = deletableKeys.length;
          skippedSharedMediaObjectCount = uniqueMediaKeys.length - deletableKeys.length;

          const deleteResult = await s3Uploader.deleteObjects(deletableKeys);
          const deletedKeySet = new Set(
            (deleteResult.deletedKeys || []).map((key) => normalizeMediaKey(key))
          );
          deletedMediaObjectCount = deletedKeySet.size;

          if (deletedKeySet.size > 0) {
            const mediaDeleteSummary = await dbOps.deleteMediaRecordsByIds({
              imageRecordIds: expiredImageRecords
                .filter((record) => deletedKeySet.has(normalizeMediaKey(record.s3Key)))
                .map((record) => record.id)
                .filter((id): id is number => typeof id === 'number'),
              fileRecordIds: expiredFileRecords
                .filter((record) => deletedKeySet.has(normalizeMediaKey(record.s3Key)))
                .map((record) => record.id)
                .filter((id): id is number => typeof id === 'number'),
              videoRecordIds: expiredVideoRecords
                .filter((record) => deletedKeySet.has(normalizeMediaKey(record.s3Key)))
                .map((record) => record.id)
                .filter((id): id is number => typeof id === 'number'),
            });
            deletedImageRecords = mediaDeleteSummary.deletedImageRecords;
            deletedFileRecords = mediaDeleteSummary.deletedFileRecords;
            deletedVideoRecords = mediaDeleteSummary.deletedVideoRecords;

            if (config.debug) {
              logger.info(
                `已清理 ${deletedKeySet.size} 个过期媒体对象 (保留${config.chatLog.mediaRetentionDays}天)`
              );
            }
          }

          if (deleteResult.error) {
            s3DeletionError = deleteResult.error;
            logger.warn(`媒体文件清理存在未完成项：${deleteResult.error}`);
          }

          if (config.debug && skippedSharedMediaObjectCount > 0) {
            logger.info(`跳过 ${skippedSharedMediaObjectCount} 个仍被未过期记录引用的媒体对象`);
          }
        }
      } else if (config.chatLog.mediaRetentionDays > 0) {
        deletedImageRecords = 0;
        deletedFileRecords = 0;
        deletedVideoRecords = 0;
      }

      const totalDeleted =
        result.deletedChatRecords +
        deletedImageRecords +
        deletedFileRecords +
        deletedVideoRecords;

      if (totalDeleted > 0) {
        logger.info(
          `数据库清理完成：删除 ${result.deletedChatRecords} 条聊天记录，${deletedImageRecords} 条图片记录，${deletedFileRecords} 条文件记录，${deletedVideoRecords} 条视频记录`
        );
      } else if (config.debug) {
        logger.info('数据库清理完成：没有过期记录需要清理');
      }

      const localFileCleanup = await executeLocalFileCleanup();

      return {
        success: true,
        deletedChatRecords: result.deletedChatRecords,
        deletedImageRecords,
        deletedFileRecords,
        deletedVideoRecords,
        expiredMediaObjectCount: Array.from(
          new Set(mediaKeys.map((key) => key.trim()).filter((key) => key.length > 0))
        ).length,
        deletableMediaObjectCount,
        deletedMediaObjectCount,
        skippedSharedMediaObjectCount,
        mediaCleanupEnabled: config.chatLog.mediaRetentionDays > 0,
        s3UploaderAvailable: Boolean(s3Uploader),
        localFileCleanup,
        s3DeletionError,
      };
    } catch (error: any) {
      logger.error('执行数据库清理时发生错误', error);
      return {
        success: false,
        deletedChatRecords: 0,
        deletedImageRecords: 0,
        deletedFileRecords: 0,
        deletedVideoRecords: 0,
        expiredMediaObjectCount: 0,
        deletableMediaObjectCount: 0,
        deletedMediaObjectCount: 0,
        skippedSharedMediaObjectCount: 0,
        mediaCleanupEnabled: config.chatLog.mediaRetentionDays > 0,
        s3UploaderAvailable: Boolean(s3Service.getUploader()),
        localFileCleanup: {
          checkedFiles: 0,
          deletedFiles: 0,
        },
        error: error?.message || '未知错误',
      };
    }
  };

  const scheduleAutoUpload = (): void => {
    if (uploadScheduler) {
      clearTimeout(uploadScheduler);
    }

    const nextExecution = getNextExecutionTime(config.chatLog.autoUploadTime);
    const delay = nextExecution.getTime() - Date.now();

    if (config.debug) {
      logger.info(`下次聊天记录自动上传时间：${nextExecution.toLocaleString('zh-CN')}`);
    }

    uploadScheduler = setTimeout(async () => {
      await executeAutoUpload();
      await executeDatabaseCleanup();
      scheduleAutoUpload();
    }, delay);
  };

  const scheduleDbCleanup = (): void => {
    if (cleanupScheduler) {
      clearInterval(cleanupScheduler);
    }

    cleanupScheduler = setInterval(
      async () => {
        await executeDatabaseCleanup();
      },
      60 * 60 * 1000
    );

    if (config.debug) {
      logger.info('数据库清理任务已启动，每小时执行一次');
    }
  };

  return {
    executeAutoUpload,
    scheduleAutoUpload,
    executeDatabaseCleanup,
    scheduleDbCleanup,
    clearUploadScheduler: () => {
      if (uploadScheduler) {
        clearTimeout(uploadScheduler);
        uploadScheduler = null;
      }
    },
    clearCleanupScheduler: () => {
      if (cleanupScheduler) {
        clearInterval(cleanupScheduler);
        cleanupScheduler = null;
      }
    },
  };
}
