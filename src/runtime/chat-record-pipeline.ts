import * as path from 'path';
import { S3Uploader } from '../storage/s3-uploader';
import type { ChatRecord, Config, FileRecord, ImageRecord, VideoRecord } from '../core/types';
import {
  formatDateInUTC8,
  getDateStringInUTC8,
  replaceImageUrl,
  safeJsonParse,
  safeJsonStringify,
} from '../core/utils';

type LoggerLike = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string, error?: unknown) => void;
};

type DbOpsLike = {
  createImageRecord: (record: Omit<ImageRecord, 'id'>) => Promise<unknown>;
  createFileRecord: (record: Omit<FileRecord, 'id'>) => Promise<unknown>;
  createVideoRecord: (record: Omit<VideoRecord, 'id'>) => Promise<unknown>;
  updateChatRecord: (messageId: string, updates: Partial<ChatRecord>) => Promise<void>;
};

type FileWriterLike = {
  safeAppend: (filePath: string, content: string) => Promise<void>;
  safeUpdate: (filePath: string, messageId: string, newContent: string) => Promise<void>;
};

type PipelineDeps = {
  config: Config;
  logger: LoggerLike;
  dbOps: DbOpsLike;
  s3Service: {
    getUploader: () => S3Uploader | null;
  };
  fileWriter: FileWriterLike;
  getStorageDir: (subDir: string) => string;
};

type FileUrlInfo = { url: string; fileName: string };

const withTimeout = async <T>(
  task: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void
): Promise<T | null> => {
  let isCompleted = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => {
      if (isCompleted) {
        return;
      }

      isCompleted = true;
      onTimeout();
      resolve(null);
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([task, timeoutPromise]);
    isCompleted = true;
    return result;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

export const createChatRecordPipeline = (deps: PipelineDeps) => {
  const { config, logger, dbOps, s3Service, fileWriter, getStorageDir } = deps;

  const updateLocalFileRecord = async (record: ChatRecord): Promise<void> => {
    try {
      const dateStr = getDateStringInUTC8(record.timestamp);
      const groupKey = record.guildId || 'private';
      const fileName = `${groupKey}_${dateStr}.jsonl`;
      const filePath = path.join(getStorageDir('data'), fileName);

      const updatedRecord = {
        timestamp: record.timestamp,
        time: formatDateInUTC8(record.timestamp),
        messageId: record.messageId,
        guildId: record.guildId,
        channelId: record.channelId,
        userId: record.userId,
        username: record.username,
        content: record.content,
        messageType: record.messageType,
        imageUrls: safeJsonParse(record.imageUrls, []),
        fileUrls: safeJsonParse(record.fileUrls, []),
        videoUrls: safeJsonParse(record.videoUrls, []),
        originalElements: safeJsonParse(record.originalElements, []),
      };

      const updatedLine = safeJsonStringify(updatedRecord) + '\n';
      await fileWriter.safeUpdate(filePath, record.messageId, updatedLine);

      if (config.debug) {
        logger.info(`已更新本地文件记录：${fileName}`);
      }
    } catch (error: any) {
      logger.error('更新本地文件记录失败', error);
    }
  };

  const uploadImageToS3 = async (
    imageUrl: string,
    messageId: string,
    guildId?: string
  ): Promise<string | null> => {
    const s3Uploader = s3Service.getUploader();
    if (!s3Uploader) {
      logger.error('S3 上传器未初始化');
      return null;
    }

    try {
      const s3Key = S3Uploader.generateImageKey(messageId, imageUrl, guildId);
      const result = await s3Uploader.uploadImageFromUrl(imageUrl, s3Key);

      if (result.success && result.url) {
        const finalUrl = replaceImageUrl(result.url);

        const imageRecord: Omit<ImageRecord, 'id'> = {
          originalUrl: imageUrl,
          s3Url: finalUrl,
          s3Key: result.key || s3Key,
          fileSize: result.fileSize || 0,
          uploadedAt: Date.now(),
          messageId,
        };

        await dbOps.createImageRecord(imageRecord);

        if (config.debug) {
          logger.info(`✅ 图片上传成功：${finalUrl}`);
        }

        return finalUrl;
      }

      logger.error(`❌ 图片上传失败：${result.error}`);
      return null;
    } catch (error: any) {
      logger.error('❌ 上传图片时发生错误', error);
      return null;
    }
  };

  const uploadFileToS3 = async (
    fileUrl: string,
    fileName: string,
    messageId: string,
    guildId?: string
  ): Promise<string | null> => {
    const s3Uploader = s3Service.getUploader();
    if (!s3Uploader) {
      logger.error('S3 上传器未初始化');
      return null;
    }

    try {
      const s3Key = S3Uploader.generateFileKey(messageId, fileUrl, fileName, guildId);
      const result = await s3Uploader.uploadFileFromUrl(fileUrl, s3Key, fileName);

      if (result.success && result.url) {
        const finalUrl = replaceImageUrl(result.url);

        const fileRecord: Omit<FileRecord, 'id'> = {
          originalUrl: fileUrl,
          s3Url: finalUrl,
          s3Key: result.key || s3Key,
          fileName,
          fileSize: result.fileSize || 0,
          uploadedAt: Date.now(),
          messageId,
        };

        await dbOps.createFileRecord(fileRecord);

        if (config.debug) {
          logger.info(`✅ 文件上传成功：${fileName} -> ${finalUrl}`);
        }

        return finalUrl;
      }

      logger.error(`❌ 文件上传失败：${fileName} - ${result.error}`);
      return null;
    } catch (error: any) {
      logger.error(`❌ 上传文件时发生错误：${fileName}`, error);
      return null;
    }
  };

  const uploadVideoToS3 = async (
    videoUrl: string,
    fileName: string,
    messageId: string,
    guildId?: string
  ): Promise<string | null> => {
    const s3Uploader = s3Service.getUploader();
    if (!s3Uploader) {
      logger.error('S3 上传器未初始化');
      return null;
    }

    try {
      const s3Key = S3Uploader.generateVideoKey(messageId, videoUrl, fileName, guildId);
      const result = await s3Uploader.uploadVideoFromUrl(videoUrl, s3Key, fileName);

      if (result.success && result.url) {
        const finalUrl = replaceImageUrl(result.url);

        const videoRecord: Omit<VideoRecord, 'id'> = {
          originalUrl: videoUrl,
          s3Url: finalUrl,
          s3Key: result.key || s3Key,
          fileName,
          fileSize: result.fileSize || 0,
          uploadedAt: Date.now(),
          messageId,
        };

        await dbOps.createVideoRecord(videoRecord);

        if (config.debug) {
          logger.info(`✅ 视频上传成功：${fileName} -> ${finalUrl}`);
        }

        return finalUrl;
      }

      logger.error(`❌ 视频上传失败：${fileName} - ${result.error}`);
      return null;
    } catch (error: any) {
      logger.error(`❌ 上传视频时发生错误：${fileName}`, error);
      return null;
    }
  };

  const saveMessageToLocalFile = async (record: ChatRecord): Promise<void> => {
    try {
      const dateStr = getDateStringInUTC8(record.timestamp);
      const groupKey = record.guildId || 'private';
      const fileName = `${groupKey}_${dateStr}.jsonl`;
      const filePath = path.join(getStorageDir('data'), fileName);

      const logEntry = {
        timestamp: record.timestamp,
        time: formatDateInUTC8(record.timestamp),
        messageId: record.messageId,
        guildId: record.guildId,
        channelId: record.channelId,
        userId: record.userId,
        username: record.username,
        content: record.content,
        messageType: record.messageType,
        imageUrls: safeJsonParse(record.imageUrls, []),
        fileUrls: safeJsonParse(record.fileUrls, []),
        videoUrls: safeJsonParse(record.videoUrls, []),
        originalElements: safeJsonParse(record.originalElements, []),
      };

      const logLine = safeJsonStringify(logEntry) + '\n';
      await fileWriter.safeAppend(filePath, logLine);

      if (config.debug) {
        logger.info(`已保存到本地文件：${fileName}`);
      }
    } catch (error: any) {
      logger.error('保存消息到本地文件失败', error);
    }
  };

  const processFileUploadsAsync = async (
    imageUrls: string[],
    fileUrls: FileUrlInfo[],
    videoUrls: FileUrlInfo[],
    messageId: string,
    guildId: string | undefined,
    originalRecord: ChatRecord
  ): Promise<void> => {
    if (imageUrls.length === 0 && fileUrls.length === 0 && videoUrls.length === 0) {
      return;
    }

    try {
      const urlMapping: Record<string, string> = {};
      const successfulImageUploads: string[] = [];
      const successfulFileUploads: string[] = [];
      const successfulVideoUploads: string[] = [];

      if (imageUrls.length > 0) {
        const imageUploadPromises = imageUrls.map((imageUrl) =>
          withTimeout(uploadImageToS3(imageUrl, messageId, guildId), 120000, () => {
            if (config.debug) {
              logger.warn(`图片上传超时：${imageUrl}`);
            }
          })
        );

        const imageUploadResults = await Promise.allSettled(imageUploadPromises);
        imageUploadResults.forEach((result, index) => {
          if (result.status === 'fulfilled' && result.value) {
            successfulImageUploads.push(result.value);
            urlMapping[imageUrls[index]] = result.value;
          }
        });
      }

      if (fileUrls.length > 0) {
        const fileUploadPromises = fileUrls.map((fileInfo) =>
          withTimeout(
            uploadFileToS3(fileInfo.url, fileInfo.fileName, messageId, guildId),
            180000,
            () => {
              if (config.debug) {
                logger.warn(`文件上传超时：${fileInfo.fileName}`);
              }
            }
          )
        );

        const fileUploadResults = await Promise.allSettled(fileUploadPromises);
        fileUploadResults.forEach((result, index) => {
          if (result.status === 'fulfilled' && result.value) {
            successfulFileUploads.push(result.value);
            urlMapping[fileUrls[index].url] = result.value;
          }
        });
      }

      if (videoUrls.length > 0) {
        const videoUploadPromises = videoUrls.map((videoInfo) =>
          withTimeout(
            uploadVideoToS3(videoInfo.url, videoInfo.fileName, messageId, guildId),
            300000,
            () => {
              if (config.debug) {
                logger.warn(`视频上传超时：${videoInfo.fileName}`);
              }
            }
          )
        );

        const videoUploadResults = await Promise.allSettled(videoUploadPromises);
        videoUploadResults.forEach((result, index) => {
          if (result.status === 'fulfilled' && result.value) {
            successfulVideoUploads.push(result.value);
            urlMapping[videoUrls[index].url] = result.value;
          }
        });
      }

      if (
        successfulImageUploads.length > 0 ||
        successfulFileUploads.length > 0 ||
        successfulVideoUploads.length > 0
      ) {
        let updatedContent = originalRecord.content;
        Object.entries(urlMapping).forEach(([originalUrl, newUrl]) => {
          updatedContent = updatedContent.replace(originalUrl, newUrl);
        });

        const updateData: Partial<ChatRecord> = {
          content: updatedContent,
        };

        if (successfulImageUploads.length > 0) {
          updateData.imageUrls = safeJsonStringify(successfulImageUploads);
        }

        if (successfulFileUploads.length > 0) {
          updateData.fileUrls = safeJsonStringify(successfulFileUploads);
        }

        if (successfulVideoUploads.length > 0) {
          updateData.videoUrls = safeJsonStringify(successfulVideoUploads);
        }

        await dbOps.updateChatRecord(messageId, updateData);

        await updateLocalFileRecord({
          ...originalRecord,
          content: updatedContent,
          imageUrls:
            successfulImageUploads.length > 0
              ? safeJsonStringify(successfulImageUploads)
              : originalRecord.imageUrls,
          fileUrls:
            successfulFileUploads.length > 0
              ? safeJsonStringify(successfulFileUploads)
              : originalRecord.fileUrls,
          videoUrls:
            successfulVideoUploads.length > 0
              ? safeJsonStringify(successfulVideoUploads)
              : originalRecord.videoUrls,
        });
      }
    } catch (error: any) {
      logger.error('批量上传文件时发生错误', error);
    }
  };

  return {
    saveMessageToLocalFile,
    processFileUploadsAsync,
  };
};
