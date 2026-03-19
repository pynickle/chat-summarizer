import { Session, h } from 'koishi';
import { parseDate } from './common';
import { CommandDeps } from './types';

export async function handleSummaryCheckCommand(
  deps: CommandDeps,
  session: Session,
  days?: string
): Promise<void> {
  const { isAdmin, aiService, dbOps, sendMessage } = deps;

  try {
    if (!isAdmin(session.userId)) {
      await sendMessage(session, [h.text('权限不足，只有管理员才能使用此命令')]);
      return;
    }

    if (!aiService.isEnabled()) {
      await sendMessage(session, [h.text('❌ AI 功能未启用，无法检查总结状态')]);
      return;
    }

    const checkDays = days ? parseInt(days) : 7;
    if (isNaN(checkDays) || checkDays <= 0 || checkDays > 365) {
      await sendMessage(session, [h.text('❌ 无效的天数，请输入 1-365 之间的数字')]);
      return;
    }

    const tempMessage = await sendMessage(session, [h.text('🔍 正在检查缺失的 AI 总结...')]);
    const today = new Date();
    const endDate = today.toISOString().split('T')[0];
    const startDateObj = new Date(today);
    startDateObj.setDate(startDateObj.getDate() - checkDays + 1);
    const startDate = startDateObj.toISOString().split('T')[0];

    const missingSummaries = await dbOps.getMissingSummaryRecords(startDate, endDate);

    if (tempMessage && tempMessage[0]) {
      await session.bot.deleteMessage(session.channelId, tempMessage[0]);
    }

    if (missingSummaries.length === 0) {
      await sendMessage(session, [
        h.text(`✅ 最近${checkDays}天内所有已上传的聊天记录都已生成 AI 总结`),
      ]);
      return;
    }

    const missingByGroup: Record<string, string[]> = {};
    missingSummaries.forEach((record) => {
      const groupKey = record.guildId || 'private';
      if (!missingByGroup[groupKey]) {
        missingByGroup[groupKey] = [];
      }
      missingByGroup[groupKey].push(record.date);
    });

    let responseText = `📊 最近${checkDays}天缺失 AI 总结的记录：\n\n`;
    for (const [groupKey, dates] of Object.entries(missingByGroup)) {
      const groupName = groupKey === 'private' ? '私聊' : `群组 ${groupKey}`;
      responseText += `🔸 ${groupName}：\n`;
      responseText += `   📅 ${dates.join(', ')}\n\n`;
    }

    responseText += `💡 使用命令重新生成：\n`;
    responseText += `cs.summary.retry <日期> [群组 ID]\n\n`;
    responseText += `📝 示例：\n`;
    responseText += `cs.summary.retry ${missingSummaries[0].date}\n`;
    if (missingSummaries[0].guildId) {
      responseText += `cs.summary.retry ${missingSummaries[0].date} ${missingSummaries[0].guildId}`;
    }

    await sendMessage(session, [h.text(responseText)]);
  } catch (error: any) {
    console.error('检查 AI 总结失败：', error);
    await sendMessage(session, [h.text(`❌ 检查失败：${error?.message || '未知错误'}`)]);
  }
}

export async function handleSummaryRetryCommand(
  deps: CommandDeps,
  session: Session,
  date: string,
  guildId?: string
): Promise<void> {
  const { isAdmin, aiService, dbOps, generateSummaryForRecord, sendMessage } = deps;

  try {
    if (!isAdmin(session.userId)) {
      await sendMessage(session, [h.text('权限不足，只有管理员才能使用此命令')]);
      return;
    }

    if (!aiService.isEnabled()) {
      await sendMessage(session, [h.text('❌ AI 功能未启用，无法生成总结')]);
      return;
    }

    if (!date || !date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      await sendMessage(session, [
        h.text('❌ 无效的日期格式，请使用 YYYY-MM-DD 格式（如：2024-01-01）'),
      ]);
      return;
    }

    let targetGuildId: string | undefined;
    if (guildId === 'private') {
      targetGuildId = undefined;
    } else if (guildId) {
      targetGuildId = guildId;
    }

    const tempMessage = await sendMessage(session, [h.text('🔄 正在重新生成 AI 总结...')]);

    if (targetGuildId !== undefined) {
      const record = await dbOps.getChatLogFileForRetry(date, targetGuildId);
      if (!record) {
        if (tempMessage && tempMessage[0]) {
          await session.bot.deleteMessage(session.channelId, tempMessage[0]);
        }
        const groupInfo = targetGuildId ? `群组 ${targetGuildId}` : '私聊';
        await sendMessage(session, [h.text(`❌ 未找到 ${groupInfo} 在 ${date} 的聊天记录文件`)]);
        return;
      }

      if (record.summaryImageUrl) {
        await dbOps.clearSummaryImage(record.id!);
      }

      const imageUrl = await generateSummaryForRecord(record, true);
      if (tempMessage && tempMessage[0]) {
        await session.bot.deleteMessage(session.channelId, tempMessage[0]);
      }

      const groupInfo = targetGuildId ? `群组 ${targetGuildId}` : '私聊';
      if (imageUrl) {
        await sendMessage(session, [
          h.text(`✅ ${groupInfo} 在 ${date} 的 AI 总结重新生成完成\n\n`),
          h.image(imageUrl),
        ]);
      } else {
        await sendMessage(session, [h.text(`✅ ${groupInfo} 在 ${date} 的 AI 总结重新生成完成`)]);
      }
      return;
    }

    const allRecords = await dbOps.getChatLogFilesForSummary(date);
    if (allRecords.length === 0) {
      if (tempMessage && tempMessage[0]) {
        await session.bot.deleteMessage(session.channelId, tempMessage[0]);
      }
      await sendMessage(session, [h.text(`❌ 未找到 ${date} 的任何聊天记录文件`)]);
      return;
    }

    let successCount = 0;
    const generatedUrls: Array<{ guildId: string | undefined; url: string }> = [];

    for (const record of allRecords) {
      try {
        if (record.summaryImageUrl) {
          await dbOps.clearSummaryImage(record.id!);
        }
        const imageUrl = await generateSummaryForRecord(record, true);
        successCount++;
        if (imageUrl) {
          generatedUrls.push({ guildId: record.guildId, url: imageUrl });
        }
      } catch (error: any) {
        console.error(`重新生成总结失败 (${record.guildId || 'private'}):`, error);
      }
    }

    if (tempMessage && tempMessage[0]) {
      await session.bot.deleteMessage(session.channelId, tempMessage[0]);
    }

    const messageElements: any[] = [
      h.text(`✅ ${date} 的 AI 总结重新生成完成：${successCount}/${allRecords.length} 个成功\n\n`),
    ];

    for (const item of generatedUrls) {
      const groupInfo = item.guildId ? `群组 ${item.guildId}` : '私聊';
      messageElements.push(h.text(`📸 ${groupInfo}:\n`));
      messageElements.push(h.image(item.url));
      messageElements.push(h.text('\n'));
    }

    await sendMessage(session, messageElements);
  } catch (error: any) {
    console.error('重新生成 AI 总结失败：', error);
    await sendMessage(session, [h.text(`❌ 重新生成失败：${error?.message || '未知错误'}`)]);
  }
}

export async function handleSummaryGetCommand(
  deps: CommandDeps,
  session: Session,
  date: string,
  guildId?: string
): Promise<void> {
  const { isAdmin, aiService, dbOps, sendMessage } = deps;

  try {
    if (!isAdmin(session.userId)) {
      await sendMessage(session, [h.text('权限不足，只有管理员才能使用此命令')]);
      return;
    }

    if (!aiService.isEnabled()) {
      await sendMessage(session, [h.text('❌ AI 功能未启用，无法获取总结')]);
      return;
    }

    const parsedDate = parseDate(date);
    if (!parsedDate) {
      await sendMessage(session, [
        h.text('❌ 无效的日期格式，请使用 YYYY-MM-DD 格式或预设值（如：yesterday、today）'),
      ]);
      return;
    }

    let targetGuildId: string | undefined;
    if (guildId === 'current') {
      if (!session.guildId) {
        await sendMessage(session, [h.text('❌ 当前不在群聊中，无法使用 "current" 参数')]);
        return;
      }
      targetGuildId = session.guildId;
    } else if (guildId === 'private') {
      targetGuildId = undefined;
    } else if (guildId) {
      targetGuildId = guildId;
    } else if (session.guildId) {
      targetGuildId = session.guildId;
    } else {
      await sendMessage(session, [
        h.text(
          '❌ 请指定群组 ID 或在群聊中使用命令\n\n💡 使用方式：\n• cs.summary.get 2024-01-01 123456789\n• cs.summary.get 2024-01-01 private\n• 在群聊中：cs.summary.get 2024-01-01'
        ),
      ]);
      return;
    }

    const tempMessage = await sendMessage(session, [h.text('🔍 正在获取 AI 总结图片...')]);
    const summaryImageUrl = await dbOps.getSummaryImageUrl(parsedDate, targetGuildId);

    if (tempMessage && tempMessage[0]) {
      await session.bot.deleteMessage(session.channelId, tempMessage[0]);
    }

    if (!summaryImageUrl) {
      const groupInfo = targetGuildId ? `群组 ${targetGuildId}` : '私聊';
      await sendMessage(session, [
        h.text(
          `❌ 未找到 ${groupInfo} 在 ${parsedDate} 的 AI 总结图片\n\n💡 可能原因：\n• 该日期没有聊天记录\n• 聊天记录尚未上传\n• AI 总结尚未生成\n\n🔧 解决方法：\n• 使用 cs.summary.check 检查缺失的总结\n• 使用 cs.summary.retry ${parsedDate}${targetGuildId ? ` ${targetGuildId}` : ''} 重新生成`
        ),
      ]);
      return;
    }

    try {
      const groupInfo = targetGuildId ? `群组 ${targetGuildId}` : '私聊';
      await sendMessage(session, [
        h.text(`📊 ${groupInfo} - ${parsedDate} AI 总结：`),
        h.image(summaryImageUrl),
      ]);
    } catch (error: any) {
      console.error('发送总结图片失败：', error);
      await sendMessage(session, [
        h.text(
          `❌ 发送图片失败：${error?.message || '未知错误'}\n\n🔗 图片链接：${summaryImageUrl}`
        ),
      ]);
    }
  } catch (error: any) {
    console.error('获取 AI 总结失败：', error);
    await sendMessage(session, [h.text(`❌ 获取失败：${error?.message || '未知错误'}`)]);
  }
}
