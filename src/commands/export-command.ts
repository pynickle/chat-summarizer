import axios from 'axios';
import { Session, h } from 'koishi';
import { ExportRequest } from '../export/export-manager';
import { extractMessageCount, sendSummaryAsForward } from './common';
import { CommandDeps } from './types';

async function downloadExportContent(url: string): Promise<string | null> {
  try {
    const response = await axios.get(url, {
      timeout: 30000,
      responseType: 'text',
    });
    return response.data;
  } catch (error) {
    console.error('下载导出文件失败：', error);
    return null;
  }
}

export async function handleExportCommand(
  deps: CommandDeps,
  session: Session,
  guildId?: string,
  timeRange?: string,
  format: string = 'json',
  types: string = '',
  enableSummarize: boolean = false,
  enableImageSummary: boolean = false
): Promise<void> {
  const { isAdmin, sendMessage, aiService, exportManager, mdToImageService, config, s3Uploader } =
    deps;

  try {
    if (!isAdmin(session.userId)) {
      await sendMessage(session, [h.text('权限不足，只有管理员才能使用此命令')]);
      return;
    }

    if (!guildId || !timeRange) {
      await sendMessage(session, [
        h.text('🔧 命令格式：cs.export <群组> <时间范围> [格式] [选项]'),
      ]);
      return;
    }

    const validFormats = ['json', 'txt', 'csv'];
    if (!validFormats.includes(format.toLowerCase())) {
      await sendMessage(session, [
        h.text(`❌ 无效的导出格式：${format}\n\n支持的格式：${validFormats.join(', ')}`),
      ]);
      return;
    }

    let targetGuildId: string | undefined;
    if (guildId.toLowerCase() === 'current') {
      if (!session.guildId) {
        await sendMessage(session, [h.text('❌ 当前不在群聊中，无法使用 "current" 参数')]);
        return;
      }
      targetGuildId = session.guildId;
    } else if (guildId.toLowerCase() === 'private') {
      targetGuildId = undefined;
    } else {
      targetGuildId = guildId;
    }

    if (enableSummarize && !aiService.isEnabled(targetGuildId)) {
      const guildInfo = targetGuildId ? `群组 ${targetGuildId}` : '私聊';
      await sendMessage(session, [
        h.text(`❌ AI 总结功能未启用或配置不完整，或${guildInfo}已禁用 AI 功能，请检查 AI 配置`),
      ]);
      return;
    }

    const processingMessage = enableSummarize
      ? '🔄 正在导出聊天记录并生成 AI 总结，请稍候...'
      : '🔄 正在处理导出请求，请稍候...';
    const tempMessage = await sendMessage(session, [h.text(processingMessage)]);

    const exportRequest: ExportRequest = {
      guildId: targetGuildId,
      timeRange,
      format: format.toLowerCase() as 'json' | 'txt' | 'csv',
      messageTypes: types
        ? types
            .split(',')
            .map((t) => t.trim())
            .filter((t) => t)
        : undefined,
    };

    const result = await exportManager.exportChatData(exportRequest);
    if (!result.success || !result.s3Url) {
      if (tempMessage && tempMessage[0]) {
        await session.bot.deleteMessage(session.channelId, tempMessage[0]);
      }
      await sendMessage(session, [h.text(result.error || '导出失败')]);
      return;
    }

    let downloadUrl = result.s3Url;
    if (s3Uploader && result.s3Key) {
      try {
        downloadUrl = await s3Uploader.getAccessibleUrl(result.s3Key);
      } catch (error) {
        console.warn('生成导出文件可访问链接失败，回退到原始链接:', error);
      }
    }

    let responseMessage = result.message || '导出成功！';
    responseMessage += `\n\n📥 下载链接：${downloadUrl}`;

    if (enableSummarize) {
      let aiTempMessage: string[] = [];
      try {
        aiTempMessage = await sendMessage(session, [h.text('📝 正在生成 AI 总结...')]);
        const fileContent =
          config.s3.isPrivate && result.s3Key
            ? await exportManager.downloadTextByS3Key(result.s3Key)
            : await downloadExportContent(downloadUrl);

        if (!fileContent) {
          responseMessage += '\n\n⚠️ 无法下载导出文件进行 AI 总结';
        } else {
          const summary = await aiService.generateSummary(
            fileContent,
            timeRange,
            extractMessageCount(result.message || ''),
            targetGuildId || 'private'
          );

          if (enableImageSummary) {
            let imgTempMessage: string[] = [];
            try {
              imgTempMessage = await sendMessage(session, [h.text('🖼️ 正在生成总结图片...')]);
              const imageBuffer = await mdToImageService.convertToImage(summary);

              if (imgTempMessage && imgTempMessage[0]) {
                await session.bot.deleteMessage(session.channelId, imgTempMessage[0]);
              }

              await sendMessage(session, [h.image(imageBuffer, 'image/png')]);
              responseMessage += '\n\n✅ AI 总结已生成并发送为图片';
            } catch (error: any) {
              if (imgTempMessage && imgTempMessage[0]) {
                await session.bot.deleteMessage(session.channelId, imgTempMessage[0]);
              }

              const errorMessage =
                responseMessage + '\n\n❌ 图片生成失败：' + (error?.message || '未知错误');
              await sendSummaryAsForward(session, errorMessage, summary, sendMessage);
              responseMessage = '';
            }
          } else {
            await sendSummaryAsForward(session, responseMessage, summary, sendMessage);
            responseMessage = '';
          }

          if (aiTempMessage && aiTempMessage[0]) {
            await session.bot.deleteMessage(session.channelId, aiTempMessage[0]);
          }
        }
      } catch (error: any) {
        if (aiTempMessage && aiTempMessage[0]) {
          await session.bot.deleteMessage(session.channelId, aiTempMessage[0]);
        }
        responseMessage += '\n\n❌ AI 总结过程中发生错误：' + (error?.message || '未知错误');
      }
    }

    if (tempMessage && tempMessage[0]) {
      await session.bot.deleteMessage(session.channelId, tempMessage[0]);
    }

    if (responseMessage.trim()) {
      await sendMessage(session, [h.text(responseMessage)]);
    }
  } catch (error: any) {
    console.error('处理导出命令失败：', error);
    await sendMessage(session, [h.text(`❌ 导出过程中发生错误：${error?.message || '未知错误'}`)]);
  }
}
