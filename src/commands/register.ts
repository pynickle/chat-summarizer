import { CommandDeps } from './types';
import { handleStatusCommand } from './status';
import { handleGetUrlCommand } from './geturl';
import { handleExportCommand } from './export-command';
import {
  handleSummaryCheckCommand,
  handleSummaryGetCommand,
  handleSummaryRetryCommand,
} from './summary-command';
import { handleMdTestCommand } from './mdtest-command';
import { handleAnalysisCommand } from './analysis-command';

export function registerCommands(deps: CommandDeps): void {
  const { ctx } = deps;

  ctx.command('cs.status', '查看插件状态').action(async () => {
    return handleStatusCommand(deps);
  });

  ctx
    .command('cs.geturl', '获取回复消息中图片/文件的 S3 链接（仅管理员可用）')
    .action(async ({ session }) => {
      await handleGetUrlCommand(deps, session);
    });

  ctx
    .command('cs.export [guildId] [timeRange] [format]', '导出聊天记录（仅管理员可用）')
    .option('format', '-f <format:string>', { fallback: 'json' })
    .option('types', '-t <types:string>', { fallback: '' })
    .option('summarize', '-s, --summarize', { type: 'boolean', fallback: false })
    .option('image', '-i, --image', { type: 'boolean', fallback: false })
    .example('cs.export current yesterday - 导出当前群昨天的记录')
    .example('cs.export 123456789 2024-01-01,2024-01-31 txt - 导出指定群 1 月份记录为文本格式')
    .example('cs.export current last7days csv - 导出当前群最近 7 天记录为 CSV 格式')
    .example('cs.export current today txt -t text - 只导出文本类型消息')
    .example('cs.export current yesterday json -t text,image - 导出文本和图片消息')
    .example('cs.export current yesterday txt --summarize - 导出并生成 AI 总结')
    .example('cs.export current yesterday txt --summarize --image - 导出并生成 AI 总结图片')
    .action(async ({ session, options }, guildId, timeRange, format) => {
      await handleExportCommand(
        deps,
        session,
        guildId,
        timeRange,
        format || options?.format || 'json',
        options?.types || '',
        !!options?.summarize,
        !!options?.image
      );
    });

  ctx
    .command('cs.summary.check [days]', '检查缺失的 AI 总结（仅管理员可用）')
    .example('cs.summary.check - 检查最近 7 天的缺失总结')
    .example('cs.summary.check 30 - 检查最近 30 天的缺失总结')
    .action(async ({ session }, days) => {
      await handleSummaryCheckCommand(deps, session, days);
    });

  ctx
    .command('cs.summary.retry <date> [guildId]', '重新生成指定日期的 AI 总结（仅管理员可用）')
    .example('cs.summary.retry 2024-01-01 - 重新生成 2024-01-01 所有群组的总结')
    .example('cs.summary.retry 2024-01-01 123456789 - 重新生成指定群组的总结')
    .example('cs.summary.retry 2024-01-01 private - 重新生成私聊的总结')
    .action(async ({ session }, date, guildId) => {
      await handleSummaryRetryCommand(deps, session, date, guildId);
    });

  ctx
    .command('cs.summary.get <date> [guildId]', '获取指定日期的 AI 总结图片（仅管理员可用）')
    .example('cs.summary.get 2024-01-01 - 获取 2024-01-01 当前群的 AI 总结图片（仅在群聊中有效）')
    .example('cs.summary.get 2024-01-01 123456789 - 获取指定群组的 AI 总结图片')
    .example('cs.summary.get 2024-01-01 private - 获取私聊的 AI 总结图片')
    .example('cs.summary.get yesterday - 获取昨天当前群的 AI 总结图片')
    .action(async ({ session }, date, guildId) => {
      await handleSummaryGetCommand(deps, session, date, guildId);
    });

  ctx.command('cs.mdtest', '测试 Markdown 和 Emoji 渲染效果').action(async ({ session }) => {
    await handleMdTestCommand(deps, session);
  });

  ctx
    .command('cs.analysis <query:text>', 'AI 分析聊天记录（仅管理员可用）')
    .example('cs.analysis 昨天群里发生了什么大事？')
    .example('cs.analysis 最近一周大家聊了什么游戏？')
    .example('cs.analysis 今天谁最活跃？')
    .action(async ({ session }, query) => {
      await handleAnalysisCommand(deps, session, query);
    });
}
