import { Session, h } from 'koishi';
import { safeJsonParse } from '../core/utils';
import { CommandDeps } from './types';

export async function handleGetUrlCommand(deps: CommandDeps, session: Session): Promise<void> {
  const { ctx, config, isAdmin, sendMessage } = deps;

  try {
    if (!isAdmin(session.userId)) {
      await sendMessage(session, [h.text('权限不足，只有管理员才能使用此命令')]);
      return;
    }

    if (!session.quote) {
      await sendMessage(session, [h.text('请回复包含图片或文件的消息后使用此命令')]);
      return;
    }

    const quotedMessageId = session.quote.messageId;
    if (!quotedMessageId) {
      await sendMessage(session, [h.text('无法获取被回复消息的 ID')]);
      return;
    }

    const chatRecords = await ctx.database.get('chat_records', { messageId: quotedMessageId });
    if (chatRecords.length === 0) {
      const retentionHours = config.chatLog.dbRetentionHours;
      await sendMessage(session, [
        h.text(
          `❌ 未找到被回复消息的记录\n\n` +
            `💡 说明：数据库仅保留最近 ${retentionHours} 小时的消息记录作为缓存。\n` +
            `如果被回复的消息超过 ${retentionHours} 小时，记录可能已被自动清理。\n\n` +
            `建议：请回复最近 ${retentionHours} 小时内包含图片或文件的消息。`
        ),
      ]);
      return;
    }

    const record = chatRecords[0];
    safeJsonParse(record.imageUrls, []);
    safeJsonParse(record.fileUrls, []);

    const imageRecords = await ctx.database.get('image_records', { messageId: quotedMessageId });
    const fileRecords = await ctx.database.get('file_records', { messageId: quotedMessageId });

    let responseContent = '';
    let hasContent = false;

    if (imageRecords.length > 0) {
      responseContent += '🖼️ 图片链接:\n';
      imageRecords.forEach((img, index) => {
        responseContent += `${index + 1}. ${img.s3Url}\n`;
      });
      hasContent = true;
    }

    if (fileRecords.length > 0) {
      if (hasContent) {
        responseContent += '\n';
      }
      responseContent += '📁 文件链接:\n';
      fileRecords.forEach((file, index) => {
        responseContent += `${index + 1}. ${file.fileName}\n${file.s3Url}\n`;
        if (index < fileRecords.length - 1) {
          responseContent += '\n';
        }
      });
      hasContent = true;
    }

    if (!hasContent) {
      await sendMessage(session, [
        h.text(
          `❌ 被回复的消息中没有找到已上传的图片或文件\n\n` +
            `💡 可能原因：\n` +
            `• 该消息不包含图片或文件\n` +
            `• 图片/文件尚未上传到S3\n` +
            `• 上传过程中出现错误\n\n` +
            `说明：只能查询已成功上传到S3的图片和文件链接。`
        ),
      ]);
      return;
    }

    await sendMessage(session, [h.text(responseContent.trim())]);
  } catch (error: any) {
    console.error('处理获取URL命令失败:', error);
    await sendMessage(session, [h.text(`获取链接失败: ${error?.message || '未知错误'}`)]);
  }
}
