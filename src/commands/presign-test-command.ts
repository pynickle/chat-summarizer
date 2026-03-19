import { Session, h } from 'koishi';
import { CommandDeps } from './types';

const DEFAULT_EXPIRES_SECONDS = 3600;
const MAX_EXPIRES_SECONDS = 7 * 24 * 60 * 60;
const MIN_EXPIRES_SECONDS = 60;

export async function handlePresignTestCommand(
  deps: CommandDeps,
  session: Session,
  expiresInput?: string
): Promise<void> {
  const { ctx, isAdmin, s3Uploader, sendMessage } = deps;

  try {
    if (!isAdmin(session.userId)) {
      await sendMessage(session, [h.text('权限不足，只有管理员才能使用此命令')]);
      return;
    }

    if (!s3Uploader) {
      await sendMessage(session, [h.text('❌ S3 上传器未初始化，无法生成预签名链接')]);
      return;
    }

    if (!session.quote) {
      await sendMessage(session, [h.text('请先回复一条包含图片或文件的消息，再执行测试命令')]);
      return;
    }

    const quotedMessageId = session.quote.messageId;
    if (!quotedMessageId) {
      await sendMessage(session, [h.text('❌ 无法获取被回复消息的 ID')]);
      return;
    }

    const expiresInSeconds = parseExpiresInSeconds(expiresInput);
    if (expiresInSeconds === null) {
      await sendMessage(session, [
        h.text(
          `❌ 过期时间无效，请输入 ${MIN_EXPIRES_SECONDS}-${MAX_EXPIRES_SECONDS} 之间的秒数\n` +
            `示例：cs.test.presign 3600`
        ),
      ]);
      return;
    }

    const imageRecords = await ctx.database.get('image_records', { messageId: quotedMessageId });
    const fileRecords = await ctx.database.get('file_records', { messageId: quotedMessageId });

    if (imageRecords.length === 0 && fileRecords.length === 0) {
      await sendMessage(session, [
        h.text(
          '❌ 被回复消息中没有找到已上传到 S3 的图片或文件\n\n' +
            '请确认该消息里的资源已经上传成功。'
        ),
      ]);
      return;
    }

    let response = `🧪 S3 预签名链接测试（有效期 ${expiresInSeconds} 秒）\n\n`;

    if (imageRecords.length > 0) {
      response += '🖼️ 图片:\n';
      for (const [index, item] of imageRecords.entries()) {
        const presignedUrl = await s3Uploader.getAccessibleUrl(item.s3Key, expiresInSeconds);
        response += `${index + 1}. ${presignedUrl}\n`;
      }
      response += '\n';
    }

    if (fileRecords.length > 0) {
      response += '📁 文件:\n';
      for (const [index, item] of fileRecords.entries()) {
        const presignedUrl = await s3Uploader.getAccessibleUrl(item.s3Key, expiresInSeconds);
        response += `${index + 1}. ${item.fileName}\n${presignedUrl}\n`;
        if (index < fileRecords.length - 1) {
          response += '\n';
        }
      }
    }

    await sendMessage(session, [h.text(response.trim())]);
  } catch (error: any) {
    console.error('处理 S3 预签名测试命令失败:', error);
    await sendMessage(session, [h.text(`❌ 生成预签名链接失败：${error?.message || '未知错误'}`)]);
  }
}

function parseExpiresInSeconds(expiresInput?: string): number | null {
  if (!expiresInput) {
    return DEFAULT_EXPIRES_SECONDS;
  }

  const value = Number(expiresInput);
  if (!Number.isInteger(value) || value < MIN_EXPIRES_SECONDS || value > MAX_EXPIRES_SECONDS) {
    return null;
  }

  return value;
}
