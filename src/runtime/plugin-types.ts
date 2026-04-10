import { Context, Session } from 'koishi';
import { Config, ChatLogFileRecord, ChatRecord, DatabaseCleanupSummary } from '../core/types';
import { DatabaseOperations } from '../data/database';
import { LoggerService, MessageProcessorService, S3Service } from './services';
import { SafeFileWriter } from '../data/file-writer';

export interface RuntimeDeps {
  ctx: Context;
  config: Config;
  logger: LoggerService;
  dbOps: DatabaseOperations;
  s3Service: S3Service;
  messageService: MessageProcessorService;
  fileWriter: SafeFileWriter;
  getStorageDir: (subDir: string) => string;
}

export interface SummaryRuntime {
  executeGroupSummary: (groupId: string) => Promise<string | undefined>;
  executeGroupPush: (groupId: string) => Promise<void>;
  executeAutoSummary: () => Promise<void>;
  scheduleAllTasks: () => void;
  scheduleAutoSummary: () => void;
  clearAllSchedulers: () => void;
  generateSummaryForRecord: (
    record: ChatLogFileRecord,
    skipPush?: boolean,
    options?: { disableAiRetries?: boolean }
  ) => Promise<string | undefined>;
}

export interface UploadRuntime {
  executeAutoUpload: () => Promise<void>;
  scheduleAutoUpload: () => void;
  executeDatabaseCleanup: () => Promise<DatabaseCleanupSummary>;
  scheduleDbCleanup: () => void;
  clearUploadScheduler: () => void;
  clearCleanupScheduler: () => void;
}

export interface MessageRuntime {
  shouldMonitorMessage: (session: Session) => boolean;
  addReplyPrefix: (content: string, session: Session) => Promise<string>;
  handleMessage: (session: Session) => Promise<void>;
}

export interface MessageRuntimeDeps extends RuntimeDeps {
  saveMessageToLocalFile: (record: ChatRecord) => Promise<void>;
  processFileUploadsAsync: (
    imageUrls: string[],
    fileUrls: Array<{ url: string; fileName: string }>,
    videoUrls: Array<{ url: string; fileName: string }>,
    messageId: string,
    guildId: string | undefined,
    originalRecord: ChatRecord
  ) => Promise<void>;
}
