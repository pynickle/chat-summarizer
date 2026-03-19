import { getDateStringInUTC8 } from '../core/utils';
import { getFileExtension, getImageExtension, getVideoExtension } from './s3-file-utils';

export function generateImageKey(
  messageId: string,
  originalUrl: string,
  guildId?: string,
  index: number = 0
): string {
  const extension = getImageExtension(originalUrl);
  const now = Date.now();
  const dateStr = getDateStringInUTC8(now);
  const suffix = index > 0 ? `_${index}` : '';
  const groupPath = guildId || 'private';
  return `images/${dateStr}/${groupPath}/${messageId}_${now}${suffix}.${extension}`;
}

export function generateFileKey(
  messageId: string,
  originalUrl: string,
  fileName?: string,
  guildId?: string,
  index: number = 0
): string {
  const extension = getFileExtension(originalUrl, fileName);
  const now = Date.now();
  const dateStr = getDateStringInUTC8(now);
  const suffix = index > 0 ? `_${index}` : '';
  const groupPath = guildId || 'private';
  return `files/${dateStr}/${groupPath}/${messageId}_${now}${suffix}.${extension}`;
}

export function generateVideoKey(
  messageId: string,
  originalUrl: string,
  fileName?: string,
  guildId?: string,
  index: number = 0
): string {
  const extension = getVideoExtension(originalUrl, fileName);
  const now = Date.now();
  const dateStr = getDateStringInUTC8(now);
  const suffix = index > 0 ? `_${index}` : '';
  const groupPath = guildId || 'private';
  return `videos/${dateStr}/${groupPath}/${messageId}_${now}${suffix}.${extension}`;
}

export function generateChatLogKey(date: Date, guildId?: string): string {
  const timestamp = date.getTime();
  const dateStr = getDateStringInUTC8(timestamp);
  if (guildId) {
    return `chat-logs/${dateStr}/guild_${guildId}_${timestamp}.json`;
  }
  return `chat-logs/${dateStr}/private_${timestamp}.json`;
}
