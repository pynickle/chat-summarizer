import { Session, h } from 'koishi';
import { deleteMessageBestEffort } from './common';
import { CommandDeps } from './types';

export async function handleAnalysisCommand(
  deps: CommandDeps,
  session: Session,
  query?: string
): Promise<void> {
  const { isAdmin, aiService, exportManager, sendMessage } = deps;

  try {
    if (!isAdmin(session.userId)) {
      await sendMessage(session, [h.text('权限不足，只有管理员才能使用此命令')]);
      return;
    }

    if (!query || query.trim() === '') {
      await sendMessage(session, [
        h.text(
          '请提供分析查询内容\n\n💡 示例：\ncs.analysis 昨天群里发生了什么大事？\ncs.analysis 最近一周大家聊了什么游戏？'
        ),
      ]);
      return;
    }

    const targetGuildId = session.guildId || undefined;

    if (!aiService.isEnabled(targetGuildId || 'private')) {
      const guildInfo = targetGuildId ? `群组 ${targetGuildId}` : '私聊';
      await sendMessage(session, [
        h.text(`❌ AI 功能未启用，或${guildInfo}已禁用 AI 功能，请检查 AI 配置`),
      ]);
      return;
    }

    const parseMessage = await sendMessage(session, [h.text('🔍 正在解析您的查询...')]);

    let parsedQuery: { timeRange: string; analysisPrompt: string };
    try {
      parsedQuery = await aiService.parseAnalysisQuery(query, targetGuildId || 'private');
    } catch (error: any) {
      await deleteMessageBestEffort(session, parseMessage?.[0]);
      await sendMessage(session, [h.text(`❌ 查询解析失败：${error?.message || '未知错误'}`)]);
      return;
    }

    await deleteMessageBestEffort(session, parseMessage?.[0]);

    const fetchMessage = await sendMessage(session, [h.text(`📥 正在获取聊天记录...`)]);

    let chatContent: string;
    let messageCount: number;
    let dateRangeStr: string;
    try {
      const dateStrings = parsedQuery.timeRange.split(',').map((d) => d.trim());
      dateRangeStr = dateStrings.join(', ');

      const localFiles = await exportManager['checkLocalFiles'](targetGuildId, dateStrings);
      const s3Files = await exportManager['checkS3Files'](targetGuildId, dateStrings);

      let filesToProcess = localFiles;
      if (localFiles.length === 0 && s3Files.length > 0) {
        const downloadedFiles = await exportManager['downloadFromS3'](s3Files);
        filesToProcess = downloadedFiles;
      }

      if (filesToProcess.length === 0) {
        await deleteMessageBestEffort(session, fetchMessage?.[0]);
        const guildInfo = targetGuildId ? `群组 ${targetGuildId}` : '私聊';
        await sendMessage(session, [
          h.text(`❌ 未找到 ${guildInfo} 在 ${dateRangeStr} 的聊天记录`),
        ]);
        return;
      }

      const messages = await exportManager['parseMessageFiles'](filesToProcess);
      if (messages.length === 0) {
        await deleteMessageBestEffort(session, fetchMessage?.[0]);
        await sendMessage(session, [h.text(`❌ 该时间段没有聊天记录`)]);
        return;
      }

      messageCount = messages.length;
      chatContent = exportManager['formatExportContent'](messages, 'txt');
    } catch (error: any) {
      await deleteMessageBestEffort(session, fetchMessage?.[0]);
      await sendMessage(session, [h.text(`❌ 获取聊天记录失败：${error?.message || '未知错误'}`)]);
      return;
    }

    await deleteMessageBestEffort(session, fetchMessage?.[0]);

    const analyzeMessage = await sendMessage(session, [h.text('🤖 正在进行 AI 分析，请稍候...')]);

    try {
      const analysisResult = await aiService.analyzeChat(
        chatContent,
        parsedQuery.analysisPrompt,
        dateRangeStr,
        messageCount,
        targetGuildId || 'private'
      );

      await deleteMessageBestEffort(session, analyzeMessage?.[0]);

      const resultMessage =
        `📊 AI 分析结果：\n` +
        `${analysisResult}\n` +
        `────────────────\n` +
        `📅 日期：${dateRangeStr}\n` +
        `📝 消息数量：${messageCount} 条`;

      await sendMessage(session, [h.text(resultMessage)]);
    } catch (error: any) {
      await deleteMessageBestEffort(session, analyzeMessage?.[0]);
      await sendMessage(session, [h.text(`❌ AI 分析失败：${error?.message || '未知错误'}`)]);
    }
  } catch (error: any) {
    console.error('处理分析命令失败：', error);
    await sendMessage(session, [h.text(`❌ 命令处理失败：${error?.message || '未知错误'}`)]);
  }
}
