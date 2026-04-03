import { Context, Session } from 'koishi';
import { ChatLogFileRecord, Config } from '../core/types';
import { DatabaseOperations } from '../data/database';
import { S3Uploader } from '../storage/s3-uploader';
import { ExportManager } from '../export/export-manager';
import { AIService } from '../ai/ai-service';
import { MarkdownToImageService } from '../rendering/md-to-image';

export interface CommandDeps {
  ctx: Context;
  config: Config;
  dbOps: DatabaseOperations;
  s3Uploader: S3Uploader | null;
  getStorageDir: (subDir: string) => string;
  getNextExecutionTime: (targetTime: string) => Date;
  generateSummaryForRecord: (
    record: ChatLogFileRecord,
    skipPush?: boolean,
    options?: { disableAiRetries?: boolean }
  ) => Promise<string | undefined>;
  exportManager: ExportManager;
  aiService: AIService;
  mdToImageService: MarkdownToImageService;
  isAdmin: (userId: string) => boolean;
  sendMessage: (session: Session, content: any[]) => Promise<string[]>;
}
