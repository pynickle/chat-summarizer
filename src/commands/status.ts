import { CommandDeps } from './types';

export async function handleStatusCommand(deps: CommandDeps): Promise<string> {
  const { dbOps, config, s3Uploader, aiService, getStorageDir, getNextExecutionTime } = deps;
  const stats = await dbOps.getPluginStats();

  let statusText = '📊 聊天记录插件状态\n\n';
  statusText += '⚙️ 配置状态:\n';
  statusText += `• 聊天记录：${config.chatLog.enabled ? '✅ 已启用' : '❌ 已禁用'}\n`;
  statusText += `• S3 存储：${config.s3.enabled ? '✅ 已启用' : '❌ 已禁用'}\n`;
  statusText += `• AI 总结：${config.ai.enabled ? '✅ 已启用' : '❌ 已禁用'}\n`;
  statusText += `• 图片上传：✅ 已启用\n`;
  statusText += `• 调试模式：${config.debug ? '✅ 已启用' : '❌ 已禁用'}\n`;
  statusText += `• 数据库缓存：${config.chatLog.dbRetentionHours} 小时\n`;

  if (config.s3.enabled) {
    statusText += '\n🌐 S3 配置:\n';
    statusText += `• 端点：${config.s3.endpoint || '未配置'}\n`;
    statusText += `• 存储桶：${config.s3.bucket}\n`;
    statusText += `• 路径前缀：${config.s3.pathPrefix}\n`;
    statusText += `• 连接状态：${s3Uploader ? '✅ 已连接' : '❌ 未连接'}\n`;
  }

  if (config.ai.enabled) {
    statusText += '\n🤖 AI 配置:\n';
    statusText += `• API 地址：${config.ai.apiUrl || '未配置'}\n`;
    statusText += `• 接口模式：${config.ai.apiMode || 'chat.completions'}\n`;
    statusText += `• 模型：${config.ai.model || 'gpt-5.4'}\n`;
    statusText += `• 最大 Token: ${config.ai.maxTokens || 2000}\n`;
    statusText += `• 默认总结时间：${config.ai.defaultSummaryTime || '03:00'}\n`;
    statusText += `• 默认推送时间：${config.ai.defaultPushTime || config.ai.defaultSummaryTime || '03:00'}\n`;
    statusText += `• 连接状态：${aiService.isEnabled() ? '✅ 已配置' : '❌ 未配置'}\n`;
  }

  statusText += '\n👁️ 监控配置:\n';
  if (config.monitor.groups.length > 0) {
    statusText += `• 配置群组数：${config.monitor.groups.length}\n`;
    for (const group of config.monitor.groups) {
      const groupName = group.name ? `${group.name}(${group.groupId})` : group.groupId;
      const parts: string[] = [];
      if (group.monitorEnabled === false) parts.push('监控关');
      if (group.summaryEnabled === false) parts.push('总结关');
      else if (group.summaryTime) parts.push(`总结@${group.summaryTime}`);
      if (group.pushEnabled === false) parts.push('推送关');
      else if (group.pushTime) parts.push(`推送@${group.pushTime}`);
      if (group.smartPushDelayEnabled) {
        const delayTime = group.smartPushDelayTime || config.ai.smartPushDelayTime || '23:00';
        const delayWindow =
          group.smartPushDelayWindowMinutes ?? config.ai.smartPushDelayWindowMinutes ?? 3;
        const delayThreshold =
          group.smartPushDelayMessageThreshold ?? config.ai.smartPushDelayMessageThreshold ?? 50;
        parts.push(`智能延迟@${delayTime}(${delayWindow}分>${delayThreshold}条)`);
      }
      if (group.pushToSelf === false) parts.push('不推本群');
      if (group.forwardGroups && group.forwardGroups.length > 0) {
        parts.push(`转发到${group.forwardGroups.length}群`);
      }
      if (group.systemPrompt) parts.push('自定义提示');
      const partsStr = parts.length > 0 ? ` (${parts.join(', ')})` : '';
      statusText += `  - ${groupName}${partsStr}\n`;
    }
  } else {
    statusText += `• 监控群组：所有群组（未配置自动总结）\n`;
  }

  statusText += `• 排除用户：${config.monitor.excludedUsers.length > 0 ? config.monitor.excludedUsers.join(', ') : '无'}\n`;
  statusText += `• 排除机器人：${config.monitor.excludeBots ? '✅ 是' : '❌ 否'}\n`;

  statusText += '\n👨‍💼 管理员配置:\n';
  statusText += `• 管理员数量：${config.admin.adminIds.length}\n`;
  statusText += `• 管理员列表：${config.admin.adminIds.length > 0 ? config.admin.adminIds.join(', ') : '无'}\n`;

  statusText += '\n📈 统计信息:\n';
  statusText += `• 总消息数：${stats.totalMessages}\n`;
  statusText += `• 今日消息数：${stats.todayMessages}\n`;
  statusText += `• 图片记录数：${stats.imageRecords}\n`;
  statusText += `• 已上传消息数：${stats.uploadedMessages}\n`;

  statusText += '\n📁 存储路径:\n';
  statusText += `• 数据目录：${getStorageDir('data')}\n`;

  if (config.chatLog.enabled && s3Uploader) {
    const nextUpload = getNextExecutionTime(config.chatLog.autoUploadTime);
    statusText += `\n⏰ 下次自动上传：${nextUpload.toLocaleString('zh-CN')}\n`;
  }

  return statusText;
}
