import { Session, h } from 'koishi';
import { deleteMessageBestEffort, parseDate } from './common';
import { CommandDeps } from './types';

async function resolveSummaryImageUrl(
  deps: CommandDeps,
  storedUrl: string,
  expiresInSeconds: number = 3600
): Promise<string> {
  if (!deps.s3Uploader) {
    return storedUrl;
  }

  try {
    return await deps.s3Uploader.getAccessibleUrlByStoredUrl(storedUrl, expiresInSeconds);
  } catch {
    return storedUrl;
  }
}

function isPrivateSession(session: Session): boolean {
  return session.channelId?.startsWith('private:') || !session.guildId;
}

function getSummaryCommandLogger(deps: CommandDeps) {
  return deps.ctx.logger('chat-summarizer:summary-command');
}

function resetSummaryRetryState<
  T extends {
    summaryRetryCount?: number;
    summaryStatus?: string;
    summaryNextRetryAt?: number;
    summaryLastError?: string;
    summaryLastAttemptAt?: number;
    summaryGeneratedAt?: number;
    summaryImageUrl?: string;
  },
>(record: T): T {
  return {
    ...record,
    summaryRetryCount: 0,
    summaryStatus: 'pending',
    summaryNextRetryAt: 0,
    summaryLastError: undefined,
    summaryLastAttemptAt: 0,
    summaryGeneratedAt: 0,
    summaryImageUrl: undefined,
  };
}

async function pushSummaryImageToGroup(
  deps: CommandDeps,
  groupId: string,
  imageUrl: string,
  date: string
): Promise<boolean> {
  const logger = getSummaryCommandLogger(deps);
  const messageElements = [h.text(`📊 ${date} AI 总结补发`), h.image(imageUrl)];

  for (const bot of deps.ctx.bots) {
    try {
      await bot.sendMessage(groupId, messageElements);
      return true;
    } catch (error) {
      if (deps.config.debug) {
        logger.warn(
          `补发总结到群 ${groupId} 失败：${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  return false;
}

export async function handleSummaryCheckCommand(
  deps: CommandDeps,
  session: Session,
  days?: string
): Promise<void> {
  const { isAdmin, aiService, dbOps, sendMessage } = deps;
  const logger = getSummaryCommandLogger(deps);

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

    await deleteMessageBestEffort(session, tempMessage?.[0]);

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
    logger.error('检查 AI 总结失败', error);
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
  const logger = getSummaryCommandLogger(deps);

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
        await deleteMessageBestEffort(session, tempMessage?.[0]);
        const groupInfo = targetGuildId ? `群组 ${targetGuildId}` : '私聊';
        await sendMessage(session, [h.text(`❌ 未找到 ${groupInfo} 在 ${date} 的聊天记录文件`)]);
        return;
      }

      if (record.summaryImageUrl) {
        await dbOps.clearSummaryImage(record.id!);
      }

      const imageUrl = await generateSummaryForRecord(resetSummaryRetryState(record), true, {
        disableAiRetries: true,
      });
      await deleteMessageBestEffort(session, tempMessage?.[0]);

      const groupInfo = targetGuildId ? `群组 ${targetGuildId}` : '私聊';
      if (!imageUrl) {
        logger.error('重新生成 AI 总结未返回图片地址', {
          recordId: record.id,
          date,
          guildId: targetGuildId || 'private',
        });
        await sendMessage(session, [
          h.text(`❌ ${groupInfo} 在 ${date} 的 AI 总结未生成成功，请检查运行日志`),
        ]);
        return;
      }

      const accessibleImageUrl = await resolveSummaryImageUrl(deps, imageUrl);
      await sendMessage(session, [
        h.text(`✅ ${groupInfo} 在 ${date} 的 AI 总结重新生成完成\n\n`),
        h.image(accessibleImageUrl),
      ]);
      return;
    }

    const allRecords = await dbOps.getChatLogFilesForSummary(date);
    if (allRecords.length === 0) {
      await deleteMessageBestEffort(session, tempMessage?.[0]);
      await sendMessage(session, [h.text(`❌ 未找到 ${date} 的任何聊天记录文件`)]);
      return;
    }

    let successCount = 0;
    const generatedUrls: Array<{ guildId: string | undefined; url: string }> = [];
    const failedItems: string[] = [];

    for (const record of allRecords) {
      try {
        if (record.summaryImageUrl) {
          await dbOps.clearSummaryImage(record.id!);
        }
        const imageUrl = await generateSummaryForRecord(resetSummaryRetryState(record), true, {
          disableAiRetries: true,
        });
        if (!imageUrl) {
          failedItems.push(`${record.date} ${record.guildId || 'private'}（未返回图片地址）`);
          logger.error('批量重新生成 AI 总结未返回图片地址', {
            recordId: record.id,
            date: record.date,
            guildId: record.guildId || 'private',
          });
          continue;
        }

        successCount++;
        const accessibleImageUrl = await resolveSummaryImageUrl(deps, imageUrl);
        generatedUrls.push({ guildId: record.guildId, url: accessibleImageUrl });
      } catch (error: any) {
        logger.error(`重新生成总结失败 (${record.guildId || 'private'})`, error);
        failedItems.push(
          `${record.date} ${record.guildId || 'private'}：${error?.message || '未知错误'}`
        );
      }
    }

    await deleteMessageBestEffort(session, tempMessage?.[0]);

    const messageElements: any[] = [
      h.text(`✅ ${date} 的 AI 总结重新生成完成：${successCount}/${allRecords.length} 个成功\n\n`),
    ];

    for (const item of generatedUrls) {
      const groupInfo = item.guildId ? `群组 ${item.guildId}` : '私聊';
      messageElements.push(h.text(`📸 ${groupInfo}:\n`));
      messageElements.push(h.image(item.url));
      messageElements.push(h.text('\n'));
    }

    if (failedItems.length > 0) {
      messageElements.push(
        h.text(
          `\n⚠️ 失败记录：\n${failedItems
            .slice(0, 10)
            .map((item) => `- ${item}`)
            .join('\n')}`
        )
      );
    }

    await sendMessage(session, messageElements);
  } catch (error: any) {
    logger.error('重新生成 AI 总结失败', error);
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
  const logger = getSummaryCommandLogger(deps);

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

    await deleteMessageBestEffort(session, tempMessage?.[0]);

    if (!summaryImageUrl) {
      const groupInfo = targetGuildId ? `群组 ${targetGuildId}` : '私聊';
      await sendMessage(session, [
        h.text(
          `❌ 未找到 ${groupInfo} 在 ${parsedDate} 的 AI 总结图片\n\n💡 可能原因：\n• 该日期没有聊天记录\n• 聊天记录尚未上传\n• AI 总结尚未生成\n\n🔧 解决方法：\n• 使用 cs.summary.check 检查缺失的总结\n• 使用 cs.summary.retry ${parsedDate}${targetGuildId ? ` ${targetGuildId}` : ''} 重新生成`
        ),
      ]);
      return;
    }

    const accessibleSummaryImageUrl = await resolveSummaryImageUrl(deps, summaryImageUrl);

    try {
      const groupInfo = targetGuildId ? `群组 ${targetGuildId}` : '私聊';
      await sendMessage(session, [
        h.text(`📊 ${groupInfo} - ${parsedDate} AI 总结：`),
        h.image(accessibleSummaryImageUrl),
      ]);
    } catch (error: any) {
      logger.error('发送总结图片失败', error);
      await sendMessage(session, [
        h.text(
          `❌ 发送图片失败：${error?.message || '未知错误'}\n\n🔗 图片链接：${accessibleSummaryImageUrl}`
        ),
      ]);
    }
  } catch (error: any) {
    logger.error('获取 AI 总结失败', error);
    await sendMessage(session, [h.text(`❌ 获取失败：${error?.message || '未知错误'}`)]);
  }
}

export async function handleSummaryRetryPendingCommand(
  deps: CommandDeps,
  session: Session,
  date?: string,
  guildId?: string
): Promise<void> {
  const { isAdmin, aiService, dbOps, generateSummaryForRecord, sendMessage } = deps;
  const logger = getSummaryCommandLogger(deps);

  try {
    if (!isAdmin(session.userId)) {
      await sendMessage(session, [h.text('权限不足，只有管理员才能使用此命令')]);
      return;
    }

    if (!isPrivateSession(session)) {
      await sendMessage(session, [h.text('❌ 此命令仅限管理员私聊中使用')]);
      return;
    }

    if (!aiService.isEnabled()) {
      await sendMessage(session, [h.text('❌ AI 功能未启用，无法重试未成功的总结')]);
      return;
    }

    let parsedDate: string | undefined;
    if (date) {
      parsedDate = parseDate(date);
      if (!parsedDate) {
        await sendMessage(session, [
          h.text('❌ 无效的日期格式，请使用 YYYY-MM-DD 格式或预设值（如：yesterday、today）'),
        ]);
        return;
      }
    }

    const tempMessage = await sendMessage(session, [
      h.text('🔄 正在重试未成功的 AI 总结并补发到对应群聊...'),
    ]);

    let records = await dbOps.getUnsuccessfulSummaryRecords(
      parsedDate,
      guildId && guildId !== 'private' ? guildId : undefined
    );
    if (guildId === 'private') {
      records = records.filter((record) => !record.guildId);
    } else if (!guildId) {
      records = records.filter((record) => !!record.guildId);
    }

    if (records.length === 0) {
      await deleteMessageBestEffort(session, tempMessage?.[0]);

      const dateInfo = parsedDate ? `${parsedDate} ` : '';
      const scopeInfo = guildId === 'private' ? '私聊' : guildId ? `群组 ${guildId}` : '群聊';
      await sendMessage(session, [
        h.text(`✅ 没有找到 ${dateInfo}${scopeInfo}范围内未成功的 AI 总结记录`),
      ]);
      return;
    }

    let retriedCount = 0;
    let pushedCount = 0;
    let privateCount = 0;
    const failedItems: string[] = [];
    const pushFailedItems: string[] = [];

    for (const record of records) {
      const groupLabel = record.guildId ? `群组 ${record.guildId}` : '私聊';

      try {
        logger.info('开始重试未成功的 AI 总结记录', {
          recordId: record.id,
          date: record.date,
          guildId: record.guildId || 'private',
        });

        if (record.id) {
          await dbOps.clearSummaryImage(record.id);
        }

        const imageUrl = await generateSummaryForRecord(resetSummaryRetryState(record), true, {
          disableAiRetries: true,
        });
        retriedCount += 1;

        if (!record.guildId) {
          privateCount += 1;
          logger.info('私聊总结重试完成，按设计跳过群发', {
            recordId: record.id,
            date: record.date,
          });
          continue;
        }

        if (!imageUrl) {
          pushFailedItems.push(`${record.date} ${groupLabel}（生成成功但未返回图片地址）`);
          continue;
        }

        const accessibleImageUrl = await resolveSummaryImageUrl(deps, imageUrl);
        const pushed = await pushSummaryImageToGroup(
          deps,
          record.guildId,
          accessibleImageUrl,
          record.date
        );
        if (pushed) {
          pushedCount += 1;
          logger.info('未成功的 AI 总结已重试并补发到群聊', {
            recordId: record.id,
            date: record.date,
            guildId: record.guildId,
          });
        } else {
          pushFailedItems.push(`${record.date} ${groupLabel}`);
          logger.warn('AI 总结重试成功，但补发到群聊失败', {
            recordId: record.id,
            date: record.date,
            guildId: record.guildId,
          });
        }
      } catch (error: any) {
        logger.error('重试未成功的 AI 总结记录失败', {
          recordId: record.id,
          date: record.date,
          guildId: record.guildId || 'private',
          error: error?.message || '未知错误',
        });
        failedItems.push(`${record.date} ${groupLabel}：${error?.message || '未知错误'}`);
      }
    }

    await deleteMessageBestEffort(session, tempMessage?.[0]);

    const summaryLines = [
      `✅ 未成功总结补发完成`,
      `• 重试成功：${retriedCount}/${records.length}`,
      `• 已补发到群：${pushedCount}`,
    ];

    if (privateCount > 0) {
      summaryLines.push(`• 私聊记录跳过群发：${privateCount}`);
    }

    if (pushFailedItems.length > 0) {
      summaryLines.push(`• 补发失败：${pushFailedItems.length}`);
      summaryLines.push('', '未能补发到群的记录：');
      summaryLines.push(...pushFailedItems.slice(0, 10).map((item) => `- ${item}`));
    }

    if (failedItems.length > 0) {
      summaryLines.push('', '重试失败的记录：');
      summaryLines.push(...failedItems.slice(0, 10).map((item) => `- ${item}`));
    }

    await sendMessage(session, [h.text(summaryLines.join('\n'))]);
  } catch (error: any) {
    logger.error('重试未成功 AI 总结失败', error);
    await sendMessage(session, [h.text(`❌ 重试失败：${error?.message || '未知错误'}`)]);
  }
}
