export function getPeriodDescription(hour: number): string {
  if (hour >= 6 && hour < 12) return '上午';
  if (hour >= 12 && hour < 14) return '中午';
  if (hour >= 14 && hour < 18) return '下午';
  if (hour >= 18 && hour < 22) return '晚上';
  return '深夜';
}

export function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function cleanUrlsAndImages(text: string): string {
  if (!text) return '';
  return text
    .replace(/\[图片\]/g, '')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi, '')
    .replace(/<image[^>]*>/gi, '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}
