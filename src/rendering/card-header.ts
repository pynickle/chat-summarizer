import { DailyReport } from '../core/types';

export function renderHeaderCard(report: DailyReport): string {
  const stats = report.statistics.basicStats;
  const guildInfo = report.guildId === 'private' ? '私聊记录' : `群 ${report.guildId}`;

  return `
      <div class="card header-card">
        <div class="header-title">📰 群日报</div>
        <div class="header-date">${report.date} · ${guildInfo}</div>
        <div class="header-stats">
          <div class="stat-item">
            <div class="stat-value">${stats.totalMessages}</div>
            <div class="stat-label">消息总数</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">${stats.uniqueUsers}</div>
            <div class="stat-label">参与人数</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">${stats.avgMessagesPerUser}</div>
            <div class="stat-label">人均发言</div>
          </div>
        </div>
      </div>
    `;
}
