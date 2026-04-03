import { Context, Session, h } from 'koishi';
import { ChatLogFileRecord, Config } from './core/types';
import { DatabaseOperations } from './data/database';
import { S3Uploader } from './storage/s3-uploader';
import { normalizePlatformUserId } from './core/utils';
import { ExportManager } from './export/export-manager';
import { AIService } from './ai/ai-service';
import { MarkdownToImageService } from './rendering/md-to-image';
import { registerCommands } from './commands/register';
import { CommandDeps } from './commands/types';

export class CommandHandler {
  private deps: CommandDeps;

  constructor(
    private ctx: Context,
    private config: Config,
    private dbOps: DatabaseOperations,
    private s3Uploader: S3Uploader | null,
    private getStorageDir: (subDir: string) => string,
    private getNextExecutionTime: (targetTime: string) => Date,
    private generateSummaryForRecord: (
      record: ChatLogFileRecord,
      skipPush?: boolean,
      options?: { disableAiRetries?: boolean }
    ) => Promise<string | undefined>
  ) {
    const exportManager = new ExportManager(ctx, s3Uploader, getStorageDir);
    const aiService = new AIService(ctx, config);
    const mdToImageService = new MarkdownToImageService(ctx);

    this.deps = {
      ctx,
      config,
      dbOps,
      s3Uploader,
      getStorageDir,
      getNextExecutionTime,
      generateSummaryForRecord,
      exportManager,
      aiService,
      mdToImageService,
      isAdmin: this.isAdmin.bind(this),
      sendMessage: this.sendMessage.bind(this),
    };
  }

  private isAdmin(userId: string): boolean {
    const normalizedId = normalizePlatformUserId(userId);
    return this.config.admin.adminIds.includes(normalizedId);
  }

  private async sendMessage(session: Session, content: any[]): Promise<string[]> {
    try {
      const promptMessage = session.channelId?.startsWith('private:')
        ? [h.quote(session.messageId), ...content]
        : [h.quote(session.messageId), h.at(session.userId), '\n', ...content];

      return await session.send(promptMessage);
    } catch (error: any) {
      const normalizedUserId = normalizePlatformUserId(session.userId);
      console.error(`向 QQ(${normalizedUserId}) 发送消息失败：${error?.message || '未知错误'}`);
      return [];
    }
  }

  registerCommands(): void {
    registerCommands(this.deps);
  }
}
