import { Session, h } from 'koishi';
import { deleteMessageBestEffort } from './common';
import { CommandDeps } from './types';

function getCleanupCommandLogger(deps: CommandDeps) {
  return deps.ctx.logger('chat-summarizer:cleanup-command');
}

export async function handleCleanupCommand(deps: CommandDeps, session: Session): Promise<void> {
  const { isAdmin, runDatabaseCleanup, sendMessage, config } = deps;
  const logger = getCleanupCommandLogger(deps);

  try {
    if (!isAdmin(session.userId)) {
      await sendMessage(session, [h.text('权限不足，只有管理员才能使用此命令')]);
      return;
    }

    const tempMessage = await sendMessage(session, [h.text('🧹 正在手动执行过期数据清理...')]);
    const result = await runDatabaseCleanup();
    await deleteMessageBestEffort(session, tempMessage?.[0]);

    if (!result.success) {
      await sendMessage(session, [h.text(`❌ 手动清理失败：${result.error || '未知错误'}`)]);
      return;
    }

    const lines = [
      '✅ 手动清理完成',
      '',
      `🗂️ 聊天记录：删除 ${result.deletedChatRecords} 条`,
      `🖼️ 图片记录：删除 ${result.deletedImageRecords} 条`,
      `📎 文件记录：删除 ${result.deletedFileRecords} 条`,
      `🎬 视频记录：删除 ${result.deletedVideoRecords} 条`,
      `📄 本地日志文件：检查 ${result.localFileCleanup.checkedFiles} 个，删除 ${result.localFileCleanup.deletedFiles} 个`,
    ];

    if (!result.mediaCleanupEnabled) {
      lines.push(
        '',
        `ℹ️ 当前 mediaRetentionDays=${config.chatLog.mediaRetentionDays}，S3 媒体自动清理未启用，本次不会删除 S3 媒体对象。`
      );
    } else {
      lines.push(
        `☁️ 过期媒体对象：发现 ${result.expiredMediaObjectCount} 个，可删除 ${result.deletableMediaObjectCount} 个，实际删除 ${result.deletedMediaObjectCount} 个`,
        `🔁 仍被未过期记录引用而跳过：${result.skippedSharedMediaObjectCount} 个`
      );

      if (!result.s3UploaderAvailable && result.expiredMediaObjectCount > 0) {
        lines.push('⚠️ 检测到过期媒体，但当前 S3 上传器未初始化，因此没有执行远端删除。');
      }

      if (result.s3DeletionError) {
        lines.push(`⚠️ S3 删除存在未完成项：${result.s3DeletionError}`);
      }
    }

    await sendMessage(session, [h.text(lines.join('\n'))]);
  } catch (error: any) {
    logger.error('手动执行清理失败', error);
    await sendMessage(session, [h.text(`❌ 手动清理失败：${error?.message || '未知错误'}`)]);
  }
}
