import * as path from 'path';

const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.yml': 'text/plain; charset=utf-8',
  '.yaml': 'text/plain; charset=utf-8',
  '.ini': 'text/plain; charset=utf-8',
  '.cfg': 'text/plain; charset=utf-8',
  '.conf': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.rtf': 'application/rtf',
  '.zip': 'application/zip',
  '.rar': 'application/x-rar-compressed',
  '.7z': 'application/x-7z-compressed',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.bz2': 'application/x-bzip2',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wma': 'audio/x-ms-wma',
  '.mp4': 'video/mp4',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv',
  '.webm': 'video/webm',
  '.m4v': 'video/mp4',
  '.exe': 'application/x-msdownload',
  '.msi': 'application/x-msdownload',
  '.dmg': 'application/x-apple-diskimage',
  '.deb': 'application/x-debian-package',
  '.rpm': 'application/x-rpm',
};

export function getContentTypeFromExtension(ext: string): string {
  return MIME_TYPES[ext.toLowerCase()] || 'application/octet-stream';
}

export function getImageContentType(url: string, headerContentType?: string): string {
  if (headerContentType && headerContentType.startsWith('image/')) {
    return headerContentType;
  }

  const extension = url.toLowerCase().match(/\.([a-z0-9]+)(?:\?|$)/)?.[1];
  if (extension) {
    const contentType = getContentTypeFromExtension(`.${extension}`);
    if (contentType.startsWith('image/')) {
      return contentType;
    }
  }

  return 'image/jpeg';
}

export function getFileContentType(url: string, fileName?: string, headerContentType?: string): string {
  if (headerContentType && headerContentType !== 'application/octet-stream') {
    return headerContentType;
  }

  if (fileName) {
    const extension = path.extname(fileName).toLowerCase();
    if (extension) {
      return getContentTypeFromExtension(extension);
    }
  }

  const extension = url.toLowerCase().match(/\.([a-z0-9]+)(?:\?|$)/)?.[1];
  if (extension) {
    return getContentTypeFromExtension(`.${extension}`);
  }

  return 'application/octet-stream';
}

export function getVideoContentType(url: string, fileName?: string, headerContentType?: string): string {
  if (headerContentType && headerContentType.startsWith('video/')) {
    return headerContentType;
  }

  if (fileName) {
    const extension = path.extname(fileName).toLowerCase();
    if (extension) {
      const contentType = getContentTypeFromExtension(extension);
      if (contentType.startsWith('video/')) {
        return contentType;
      }
    }
  }

  const extension = url.toLowerCase().match(/\.([a-z0-9]+)(?:\?|$)/)?.[1];
  if (extension) {
    const contentType = getContentTypeFromExtension(`.${extension}`);
    if (contentType.startsWith('video/')) {
      return contentType;
    }
  }

  return 'video/mp4';
}

export function getImageExtension(url: string): string {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname.toLowerCase();
    const match = pathname.match(/\.([a-z0-9]+)$/i);
    return match ? match[1] : 'jpg';
  } catch {
    return 'jpg';
  }
}

export function getFileExtension(url: string, fileName?: string): string {
  if (fileName) {
    const fileExt = path.extname(fileName).toLowerCase().substring(1);
    if (fileExt) {
      return fileExt;
    }
  }

  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname.toLowerCase();
    const match = pathname.match(/\.([a-z0-9]+)$/i);
    return match ? match[1] : 'bin';
  } catch {
    return 'bin';
  }
}

export function getVideoExtension(url: string, fileName?: string): string {
  if (fileName) {
    const fileExt = path.extname(fileName).toLowerCase().substring(1);
    if (fileExt) {
      return fileExt;
    }
  }

  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname.toLowerCase();
    const match = pathname.match(/\.([a-z0-9]+)$/i);
    return match ? match[1] : 'mp4';
  } catch {
    return 'mp4';
  }
}

export function isSupportedImageFormat(url: string, allowedTypes: string[]): boolean {
  const extension = getImageExtension(url).toLowerCase();
  return allowedTypes.map((type) => type.toLowerCase()).includes(extension);
}
