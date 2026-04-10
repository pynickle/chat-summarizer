import { Context } from 'koishi';
import {
  ChatRecord,
  ImageRecord,
  FileRecord,
  VideoRecord,
  ChatLogFileRecord,
  PluginStats,
  SummaryStatus,
} from '../core/types';

// 扩展数据库模型
export function extendDatabase(ctx: Context) {
  ctx.model.extend(
    'chat_records',
    {
      id: 'unsigned',
      messageId: 'string',
      guildId: 'string',
      channelId: 'string',
      userId: 'string',
      username: 'string',
      content: 'text',
      originalElements: 'text',
      timestamp: 'unsigned',
      messageType: 'string',
      imageUrls: 'text',
      fileUrls: 'text',
      videoUrls: 'text',
      uploadedAt: 'unsigned',
      isUploaded: 'boolean',
    },
    {
      autoInc: true,
    }
  );

  ctx.model.extend(
    'image_records',
    {
      id: 'unsigned',
      originalUrl: 'string',
      s3Url: 'string',
      s3Key: 'string',
      fileSize: 'unsigned',
      uploadedAt: 'unsigned',
      messageId: 'string',
    },
    {
      autoInc: true,
    }
  );

  ctx.model.extend(
    'file_records',
    {
      id: 'unsigned',
      originalUrl: 'string',
      s3Url: 'string',
      s3Key: 'string',
      fileName: 'string',
      fileSize: 'unsigned',
      uploadedAt: 'unsigned',
      messageId: 'string',
    },
    {
      autoInc: true,
    }
  );

  ctx.model.extend(
    'video_records',
    {
      id: 'unsigned',
      originalUrl: 'string',
      s3Url: 'string',
      s3Key: 'string',
      fileName: 'string',
      fileSize: 'unsigned',
      uploadedAt: 'unsigned',
      messageId: 'string',
    },
    {
      autoInc: true,
    }
  );

  ctx.model.extend(
    'chat_log_files',
    {
      id: 'unsigned',
      guildId: 'string',
      date: 'string',
      filePath: 'string',
      s3Key: 'string',
      s3Url: 'string',
      fileSize: 'unsigned',
      recordCount: 'unsigned',
      uploadedAt: 'unsigned',
      status: 'string',
      error: 'text',
      summaryImageUrl: 'string',
      summaryGeneratedAt: 'unsigned',
      summaryStatus: 'string',
      summaryRetryCount: 'unsigned',
      summaryLastAttemptAt: 'unsigned',
      summaryNextRetryAt: 'unsigned',
      summaryLastError: 'text',
    },
    {
      autoInc: true,
    }
  );
}

// 数据库操作类
export class DatabaseOperations {
  constructor(private ctx: Context) {}

  private chunkArray<T>(items: T[], chunkSize: number): T[][] {
    if (items.length === 0) return [];

    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += chunkSize) {
      chunks.push(items.slice(index, index + chunkSize));
    }
    return chunks;
  }

  private getMediaRetentionCutoff(mediaRetentionDays: number): number {
    return Date.now() - mediaRetentionDays * 24 * 60 * 60 * 1000;
  }

  // 创建聊天记录
  async createChatRecord(record: Omit<ChatRecord, 'id'>): Promise<ChatRecord> {
    const result = await this.ctx.database.create('chat_records', record);
    return (result as any)[0] as ChatRecord;
  }

  // 创建图片记录
  async createImageRecord(record: Omit<ImageRecord, 'id'>): Promise<ImageRecord> {
    const result = await this.ctx.database.create('image_records', record);
    return (result as any)[0] as ImageRecord;
  }

  // 创建文件记录
  async createFileRecord(record: Omit<FileRecord, 'id'>): Promise<FileRecord> {
    const result = await this.ctx.database.create('file_records', record);
    return (result as any)[0] as FileRecord;
  }

  // 创建视频记录
  async createVideoRecord(record: Omit<VideoRecord, 'id'>): Promise<VideoRecord> {
    const result = await this.ctx.database.create('video_records', record);
    return (result as any)[0] as VideoRecord;
  }

  // 创建聊天记录文件上传记录
  async createChatLogFileRecord(record: Omit<ChatLogFileRecord, 'id'>): Promise<ChatLogFileRecord> {
    const result = await this.ctx.database.create('chat_log_files', record);
    return (result as any)[0] as ChatLogFileRecord;
  }

  // 更新聊天记录文件上传记录
  async updateChatLogFileRecord(id: number, updates: Partial<ChatLogFileRecord>): Promise<void> {
    await this.ctx.database.set('chat_log_files', { id }, updates);
  }

  // 检查某日期某群组的文件是否已上传
  async checkChatLogFileUploaded(date: string, guildId?: string): Promise<boolean> {
    const records = await this.ctx.database.get('chat_log_files', {
      date,
      guildId,
      status: 'uploaded',
    });
    return records.length > 0;
  }

  // 获取聊天记录文件上传记录
  async getChatLogFileRecord(date: string, guildId?: string): Promise<ChatLogFileRecord | null> {
    const records = await this.ctx.database.get('chat_log_files', {
      date,
      guildId,
    });
    return records.length > 0 ? records[0] : null;
  }

  // 更新 AI 总结图片 URL
  async updateChatLogFileSummaryImage(id: number, summaryImageUrl: string): Promise<void> {
    await this.ctx.database.set(
      'chat_log_files',
      { id },
      {
        summaryImageUrl,
        summaryGeneratedAt: Date.now(),
        summaryStatus: 'success',
        summaryLastAttemptAt: Date.now(),
        summaryNextRetryAt: 0,
        summaryLastError: undefined,
      }
    );
  }

  async updateChatLogFileSummaryState(
    id: number,
    updates: {
      summaryStatus?: SummaryStatus;
      summaryRetryCount?: number;
      summaryLastAttemptAt?: number;
      summaryNextRetryAt?: number;
      summaryLastError?: string;
      summaryGeneratedAt?: number;
      summaryImageUrl?: string;
    }
  ): Promise<void> {
    await this.ctx.database.set('chat_log_files', { id }, updates);
  }

  // 获取需要生成 AI 总结的聊天记录文件
  async getChatLogFilesForSummary(date: string): Promise<ChatLogFileRecord[]> {
    const records = await this.ctx.database.get('chat_log_files', {
      date,
      status: 'uploaded',
    });
    // 只返回还没有生成 AI 总结的记录
    return records.filter((record) => !record.summaryImageUrl);
  }

  // 获取指定日期范围内缺失 AI 总结的记录
  async getMissingSummaryRecords(startDate: string, endDate: string): Promise<ChatLogFileRecord[]> {
    const records = await this.ctx.database.get('chat_log_files', {
      date: { $gte: startDate, $lte: endDate },
      status: 'uploaded',
    });
    // 只返回还没有生成 AI 总结的记录
    return records.filter((record) => !record.summaryImageUrl);
  }

  // 获取指定日期和群组的聊天记录文件（用于重新生成总结）
  async getChatLogFileForRetry(date: string, guildId?: string): Promise<ChatLogFileRecord | null> {
    const records = await this.ctx.database.get('chat_log_files', {
      date,
      guildId,
      status: 'uploaded',
    });
    return records.length > 0 ? records[0] : null;
  }

  // 清除 AI 总结记录（用于重新生成）
  async clearSummaryImage(id: number): Promise<void> {
    await this.ctx.database.set(
      'chat_log_files',
      { id },
      {
        summaryImageUrl: undefined,
        summaryGeneratedAt: 0,
        summaryStatus: 'pending',
        summaryRetryCount: 0,
        summaryLastAttemptAt: 0,
        summaryNextRetryAt: 0,
        summaryLastError: undefined,
      }
    );
  }

  async getChatLogFileById(id: number): Promise<ChatLogFileRecord | null> {
    const records = await this.ctx.database.get('chat_log_files', { id });
    return records.length > 0 ? records[0] : null;
  }

  async getUnsuccessfulSummaryRecords(
    date?: string,
    guildId?: string
  ): Promise<ChatLogFileRecord[]> {
    const query: {
      date?: string;
      guildId?: string;
      status: 'uploaded';
    } = {
      status: 'uploaded',
    };

    if (date) {
      query.date = date;
    }

    if (guildId !== undefined) {
      query.guildId = guildId;
    }

    const records = await this.ctx.database.get('chat_log_files', query);
    return records.filter((record) => !record.summaryImageUrl);
  }

  async getSummaryRecordsPendingRetry(currentTime: number): Promise<ChatLogFileRecord[]> {
    const records = await this.ctx.database.get('chat_log_files', {
      status: 'uploaded',
      summaryStatus: 'retrying',
    });

    return records.filter(
      (record) =>
        !record.summaryImageUrl &&
        typeof record.summaryNextRetryAt === 'number' &&
        record.summaryNextRetryAt > 0 &&
        record.summaryNextRetryAt <= currentTime
    );
  }

  async getAllSummaryRecordsPendingRetry(): Promise<ChatLogFileRecord[]> {
    const records = await this.ctx.database.get('chat_log_files', {
      status: 'uploaded',
      summaryStatus: 'retrying',
    });

    return records.filter(
      (record) =>
        !record.summaryImageUrl &&
        typeof record.summaryNextRetryAt === 'number' &&
        record.summaryNextRetryAt > 0
    );
  }

  // 获取指定日期和群组的 AI 总结图片 URL
  async getSummaryImageUrl(date: string, guildId?: string): Promise<string | null> {
    const records = await this.ctx.database.get('chat_log_files', {
      date,
      guildId,
      status: 'uploaded',
    });

    const record = records.find((r) => r.summaryImageUrl);
    return record?.summaryImageUrl || null;
  }

  // 获取指定日期范围内有 AI 总结的记录
  async getRecordsWithSummary(startDate: string, endDate: string): Promise<ChatLogFileRecord[]> {
    const records = await this.ctx.database.get('chat_log_files', {
      date: { $gte: startDate, $lte: endDate },
      status: 'uploaded',
    });
    // 只返回已生成 AI 总结的记录
    return records.filter((record) => record.summaryImageUrl);
  }

  // 更新聊天记录
  async updateChatRecord(messageId: string, updates: Partial<ChatRecord>): Promise<void> {
    await this.ctx.database.set('chat_records', { messageId }, updates);
  }

  // 获取未上传的记录
  async getUnuploadedRecords(startTime: number, endTime: number): Promise<ChatRecord[]> {
    return await this.ctx.database.get('chat_records', {
      timestamp: { $gte: startTime, $lte: endTime },
      isUploaded: false,
    });
  }

  // 批量标记为已上传 - 使用分页处理避免内存溢出
  async markAsUploaded(recordIds: number[]): Promise<void> {
    if (recordIds.length === 0) return;

    // 分页处理，每次最多处理 1000 条记录
    const batchSize = 1000;
    const totalBatches = Math.ceil(recordIds.length / batchSize);

    for (let i = 0; i < totalBatches; i++) {
      const start = i * batchSize;
      const end = Math.min(start + batchSize, recordIds.length);
      const batch = recordIds.slice(start, end);

      await this.ctx.database.set(
        'chat_records',
        { id: { $in: batch } },
        {
          isUploaded: true,
          uploadedAt: Date.now(),
        }
      );

      // 如果有多个批次，添加小延迟避免数据库压力
      if (totalBatches > 1 && i < totalBatches - 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
  }

  // 获取插件统计信息
  async getPluginStats(): Promise<PluginStats> {
    try {
      const totalMessages = await this.ctx.database
        .get('chat_records', {})
        .then((records) => records.length);

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayMessages = await this.ctx.database
        .get('chat_records', {
          timestamp: { $gte: today.getTime() },
        })
        .then((records) => records.length);

      const imageRecords = await this.ctx.database
        .get('image_records', {})
        .then((records) => records.length);

      const uploadedMessages = await this.ctx.database
        .get('chat_records', {
          isUploaded: true,
        })
        .then((records) => records.length);

      return {
        totalMessages,
        todayMessages,
        imageRecords,
        uploadedMessages,
      };
    } catch (error: any) {
      return {
        totalMessages: 0,
        todayMessages: 0,
        imageRecords: 0,
        uploadedMessages: 0,
      };
    }
  }

  // 清理过期的数据库记录
  async cleanupExpiredRecords(retentionHours: number, mediaRetentionDays: number): Promise<{
    deletedChatRecords: number;
    deletedImageRecords: number;
    deletedFileRecords: number;
    deletedVideoRecords: number;
    expiredImageRecords: ImageRecord[];
    expiredFileRecords: FileRecord[];
    expiredVideoRecords: VideoRecord[];
  }> {
    try {
      const cutoffTime = Date.now() - retentionHours * 60 * 60 * 1000;

      // 查找需要删除的聊天记录
      const expiredChatRecords = await this.ctx.database.get('chat_records', {
        timestamp: { $lt: cutoffTime },
      });

      const expiredMessageIds = expiredChatRecords.map((record) => record.messageId);

      // 删除聊天记录
      await this.ctx.database.remove('chat_records', {
        timestamp: { $lt: cutoffTime },
      });

      const shouldCleanupMedia = mediaRetentionDays > 0;
      const mediaCutoffTime = shouldCleanupMedia
        ? this.getMediaRetentionCutoff(mediaRetentionDays)
        : cutoffTime;

      const expiredImageRecords = shouldCleanupMedia
        ? await this.ctx.database.get('image_records', {
            uploadedAt: { $lt: mediaCutoffTime },
          })
        : expiredMessageIds.length > 0
          ? await this.ctx.database.get('image_records', {
              messageId: { $in: expiredMessageIds },
            })
          : [];
      const expiredFileRecords = shouldCleanupMedia
        ? await this.ctx.database.get('file_records', {
            uploadedAt: { $lt: mediaCutoffTime },
          })
        : expiredMessageIds.length > 0
          ? await this.ctx.database.get('file_records', {
              messageId: { $in: expiredMessageIds },
            })
          : [];
      const expiredVideoRecords = shouldCleanupMedia
        ? await this.ctx.database.get('video_records', {
            uploadedAt: { $lt: mediaCutoffTime },
          })
        : expiredMessageIds.length > 0
          ? await this.ctx.database.get('video_records', {
              messageId: { $in: expiredMessageIds },
            })
          : [];

      const deletedImageRecords = expiredImageRecords.length;
      const deletedFileRecords = expiredFileRecords.length;
      const deletedVideoRecords = expiredVideoRecords.length;

      if (!shouldCleanupMedia) {
        if (deletedImageRecords > 0) {
          await this.ctx.database.remove('image_records', {
            messageId: { $in: expiredMessageIds },
          });
        }

        if (deletedFileRecords > 0) {
          await this.ctx.database.remove('file_records', {
            messageId: { $in: expiredMessageIds },
          });
        }

        if (deletedVideoRecords > 0) {
          await this.ctx.database.remove('video_records', {
            messageId: { $in: expiredMessageIds },
          });
        }
      }

      return {
        deletedChatRecords: expiredChatRecords.length,
        deletedImageRecords,
        deletedFileRecords,
        deletedVideoRecords,
        expiredImageRecords,
        expiredFileRecords,
        expiredVideoRecords,
      };
    } catch (error: any) {
      throw new Error(`清理过期记录失败：${error?.message || '未知错误'}`);
    }
  }

  async deleteMediaRecordsByIds(input: {
    imageRecordIds?: number[];
    fileRecordIds?: number[];
    videoRecordIds?: number[];
  }): Promise<{
    deletedImageRecords: number;
    deletedFileRecords: number;
    deletedVideoRecords: number;
  }> {
    const imageRecordIds = input.imageRecordIds?.filter((id) => Number.isFinite(id)) || [];
    const fileRecordIds = input.fileRecordIds?.filter((id) => Number.isFinite(id)) || [];
    const videoRecordIds = input.videoRecordIds?.filter((id) => Number.isFinite(id)) || [];
    const queryBatchSize = 200;

    for (const batch of this.chunkArray(imageRecordIds, queryBatchSize)) {
      await this.ctx.database.remove('image_records', {
        id: { $in: batch },
      });
    }

    for (const batch of this.chunkArray(fileRecordIds, queryBatchSize)) {
      await this.ctx.database.remove('file_records', {
        id: { $in: batch },
      });
    }

    for (const batch of this.chunkArray(videoRecordIds, queryBatchSize)) {
      await this.ctx.database.remove('video_records', {
        id: { $in: batch },
      });
    }

    return {
      deletedImageRecords: imageRecordIds.length,
      deletedFileRecords: fileRecordIds.length,
      deletedVideoRecords: videoRecordIds.length,
    };
  }

  async getMediaReferenceSnapshotByKeys(keys: string[]): Promise<{
    imageRecords: ImageRecord[];
    fileRecords: FileRecord[];
    videoRecords: VideoRecord[];
  }> {
    const uniqueKeys = Array.from(new Set(keys.map((key) => key.trim()).filter((key) => key.length > 0)));
    const queryBatchSize = 200;

    if (uniqueKeys.length === 0) {
      return {
        imageRecords: [],
        fileRecords: [],
        videoRecords: [],
      };
    }

    const imageRecords: ImageRecord[] = [];
    const fileRecords: FileRecord[] = [];
    const videoRecords: VideoRecord[] = [];

    for (const batch of this.chunkArray(uniqueKeys, queryBatchSize)) {
      const [imageBatch, fileBatch, videoBatch] = await Promise.all([
        this.ctx.database.get('image_records', { s3Key: { $in: batch } }),
        this.ctx.database.get('file_records', { s3Key: { $in: batch } }),
        this.ctx.database.get('video_records', { s3Key: { $in: batch } }),
      ]);

      imageRecords.push(...imageBatch);
      fileRecords.push(...fileBatch);
      videoRecords.push(...videoBatch);
    }

    return {
      imageRecords,
      fileRecords,
      videoRecords,
    };
  }
}
