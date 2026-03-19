import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import * as fs from 'fs/promises';
import * as path from 'path';
import axios from 'axios';
import { handleError, delay } from '../core/utils';
import {
  getContentTypeFromExtension,
  getFileContentType,
  getImageContentType,
  getVideoContentType,
  isSupportedImageFormat,
} from './s3-file-utils';
import {
  generateChatLogKey,
  generateFileKey,
  generateImageKey,
  generateVideoKey,
} from './s3-key-utils';
import {
  downloadFile,
  downloadText,
  generatePublicUrl,
  generateSignedUrl,
  listFiles,
  resolveObjectKey,
} from './s3-object-ops';

export interface S3Config {
  region: string;
  bucket: string;
  isPrivate: boolean;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
  pathPrefix: string;
}

export interface UploadResult {
  success: boolean;
  url?: string;
  key?: string;
  error?: string;
  fileSize?: number;
}

export class S3Uploader {
  private client: S3Client;
  private config: S3Config;

  constructor(config: S3Config) {
    this.config = config;

    const clientConfig: any = {
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      // 🔑 关键修复：在 S3Client 层面设置超时，避免底层网络操作卡住
      requestHandler: {
        requestTimeout: 120000, // 2 分钟请求超时
        connectionTimeout: 30000, // 30 秒连接超时
      },
      maxAttempts: 3, // 最多重试 3 次
    };

    if (config.endpoint) {
      clientConfig.endpoint = config.endpoint;
      clientConfig.forcePathStyle = true;
    }

    this.client = new S3Client(clientConfig);
  }

  private tryExtractObjectKeyFromUrl(storedUrl: string): string | null {
    try {
      const parsed = new URL(storedUrl);
      let path = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
      if (!path) return null;

      if (path.startsWith(`${this.config.bucket}/`)) {
        path = path.substring(this.config.bucket.length + 1);
      }

      return path;
    } catch {
      return null;
    }
  }

  /**
   * 上传文件缓冲区到 S3
   */
  public async uploadBuffer(
    buffer: Buffer,
    key: string,
    contentType: string = 'application/octet-stream'
  ): Promise<UploadResult> {
    try {
      const fullKey = resolveObjectKey(this.config, key);

      const upload = new Upload({
        client: this.client,
        params: {
          Bucket: this.config.bucket,
          Key: fullKey,
          Body: buffer,
          ContentType: contentType,
        },
      });

      // 🔑 关键修复：强制超时控制，使用多重保护机制
      const uploadPromise = upload.done();

      let timeoutId: NodeJS.Timeout | null = null;
      let isCompleted = false;

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          if (!isCompleted) {
            isCompleted = true;

            // 1. 强制取消上传操作
            upload.abort().catch(() => {
              // 忽略取消失败的错误
            });

            // 2. 强制抛出错误
            reject(new Error('S3 上传超时（90 秒）'));
          }
        }, 90000); // 90 秒超时
      });

      try {
        const result = await Promise.race([uploadPromise, timeoutPromise]);
        isCompleted = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        const url = generatePublicUrl(this.config, fullKey);

        return {
          success: true,
          url,
          key: fullKey,
          fileSize: buffer.length,
        };
      } catch (error: any) {
        isCompleted = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        // 确保上传操作被取消
        try {
          await upload.abort();
        } catch {
          // 忽略取消失败的错误
        }

        throw error;
      }
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || '上传失败',
      };
    }
  }

  /**
   * 上传本地文件到 S3
   */
  public async uploadFile(
    filePath: string,
    key: string,
    contentType?: string
  ): Promise<UploadResult> {
    try {
      const buffer = await fs.readFile(filePath);

      if (!contentType) {
        contentType = getContentTypeFromExtension(path.extname(filePath));
      }

      return await this.uploadBuffer(buffer, key, contentType);
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || '读取文件失败',
      };
    }
  }

  /**
   * 上传文本内容到 S3
   */
  public async uploadText(
    content: string,
    key: string,
    contentType: string = 'text/plain; charset=utf-8'
  ): Promise<UploadResult> {
    const buffer = Buffer.from(content, 'utf-8');
    return await this.uploadBuffer(buffer, key, contentType);
  }

  /**
   * 从 URL 下载图片并上传到 S3（使用 axios 确保兼容性）
   */
  public async uploadImageFromUrl(
    imageUrl: string,
    key: string,
    httpService?: any,
    maxSize?: number
  ): Promise<UploadResult> {
    try {
      // 使用 axios 下载图片，确保对各种 URL 格式的兼容性
      const downloadConfig = {
        responseType: 'arraybuffer' as const,
        timeout: 60000, // 60 秒超时
        maxContentLength: maxSize || 50 * 1024 * 1024, // 默认 50MB 限制
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        },
      };

      const response = await axios.get(imageUrl, downloadConfig);

      if (!response.data) {
        return {
          success: false,
          error: '下载图片失败：响应数据为空',
        };
      }

      // 将 ArrayBuffer 转换为 Buffer
      const buffer = Buffer.from(response.data);

      // 检查文件大小
      if (maxSize && buffer.length > maxSize) {
        return {
          success: false,
          error: `图片文件过大：${Math.round(buffer.length / 1024 / 1024)}MB > ${Math.round(maxSize / 1024 / 1024)}MB`,
        };
      }

      // 确定内容类型
      const contentType = getImageContentType(imageUrl, response.headers?.['content-type']);

      return await this.uploadBuffer(buffer, key, contentType);
    } catch (error: any) {
      return {
        success: false,
        error: handleError(error, '下载或上传图片失败'),
      };
    }
  }

  /**
   * 从 URL 下载文件并上传到 S3
   */
  public async uploadFileFromUrl(
    fileUrl: string,
    key: string,
    fileName?: string,
    maxSize?: number
  ): Promise<UploadResult> {
    try {
      // 使用 axios 下载文件，确保对各种 URL 格式的兼容性
      const downloadConfig = {
        responseType: 'arraybuffer' as const,
        timeout: 120000, // 2 分钟超时（文件可能比图片大）
        maxContentLength: maxSize || 100 * 1024 * 1024, // 默认 100MB 限制
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        },
      };

      const response = await axios.get(fileUrl, downloadConfig);

      if (!response.data) {
        return {
          success: false,
          error: '下载文件失败：响应数据为空',
        };
      }

      // 将 ArrayBuffer 转换为 Buffer
      const buffer = Buffer.from(response.data);

      // 检查文件大小
      if (maxSize && buffer.length > maxSize) {
        return {
          success: false,
          error: `文件过大：${Math.round(buffer.length / 1024 / 1024)}MB > ${Math.round(maxSize / 1024 / 1024)}MB`,
        };
      }

      // 确定内容类型
      const contentType = getFileContentType(fileUrl, fileName, response.headers?.['content-type']);

      return await this.uploadBuffer(buffer, key, contentType);
    } catch (error: any) {
      return {
        success: false,
        error: handleError(error, '下载或上传文件失败'),
      };
    }
  }

  /**
   * 从 URL 下载视频并上传到 S3
   */
  public async uploadVideoFromUrl(
    videoUrl: string,
    key: string,
    fileName?: string,
    maxSize?: number
  ): Promise<UploadResult> {
    try {
      // 使用 axios 下载视频，确保对各种 URL 格式的兼容性
      const downloadConfig = {
        responseType: 'arraybuffer' as const,
        timeout: 300000, // 5 分钟超时（视频文件可能很大）
        maxContentLength: maxSize || 500 * 1024 * 1024, // 默认 500MB 限制
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        },
      };

      const response = await axios.get(videoUrl, downloadConfig);

      if (!response.data) {
        return {
          success: false,
          error: '下载视频失败：响应数据为空',
        };
      }

      // 将 ArrayBuffer 转换为 Buffer
      const buffer = Buffer.from(response.data);

      // 检查文件大小
      if (maxSize && buffer.length > maxSize) {
        return {
          success: false,
          error: `视频文件过大：${Math.round(buffer.length / 1024 / 1024)}MB > ${Math.round(maxSize / 1024 / 1024)}MB`,
        };
      }

      // 确定内容类型
      const contentType = getVideoContentType(
        videoUrl,
        fileName,
        response.headers?.['content-type']
      );

      return await this.uploadBuffer(buffer, key, contentType);
    } catch (error: any) {
      return {
        success: false,
        error: handleError(error, '下载或上传视频失败'),
      };
    }
  }

  /**
   * 批量上传聊天记录文件
   */
  public async uploadChatLogFiles(
    files: Array<{
      filePath: string;
      key: string;
    }>
  ): Promise<UploadResult[]> {
    const results: UploadResult[] = [];

    for (const file of files) {
      const result = await this.uploadFile(file.filePath, file.key, 'text/plain; charset=utf-8');
      results.push(result);

      // 避免请求过于频繁
      if (files.length > 1) {
        await delay(100);
      }
    }

    return results;
  }

  /**
   * 生成用于存储的 S3 键名
   */
  public static generateImageKey(
    messageId: string,
    originalUrl: string,
    guildId?: string,
    index: number = 0
  ): string {
    return generateImageKey(messageId, originalUrl, guildId, index);
  }

  /**
   * 生成用于文件存储的 S3 键名
   */
  public static generateFileKey(
    messageId: string,
    originalUrl: string,
    fileName?: string,
    guildId?: string,
    index: number = 0
  ): string {
    return generateFileKey(messageId, originalUrl, fileName, guildId, index);
  }

  /**
   * 生成用于视频存储的 S3 键名
   */
  public static generateVideoKey(
    messageId: string,
    originalUrl: string,
    fileName?: string,
    guildId?: string,
    index: number = 0
  ): string {
    return generateVideoKey(messageId, originalUrl, fileName, guildId, index);
  }

  /**
   * 生成聊天记录文件的 S3 键名（JSON 格式）
   */
  public static generateChatLogKey(date: Date, guildId?: string): string {
    return generateChatLogKey(date, guildId);
  }

  /**
   * 检查是否支持的图片格式
   */
  public static isSupportedImageFormat(url: string, allowedTypes: string[]): boolean {
    return isSupportedImageFormat(url, allowedTypes);
  }

  /**
   * 测试 S3 连接
   */
  public async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      // 尝试上传一个小的测试文件
      const testContent = 'koishi-chat-summarizer-test';
      const testKey = `test/${Date.now()}.txt`;

      const result = await this.uploadText(testContent, testKey, 'text/plain');

      if (result.success) {
        // 测试成功，可以选择删除测试文件
        return { success: true };
      } else {
        return { success: false, error: result.error };
      }
    } catch (error: any) {
      return { success: false, error: handleError(error, 'S3 连接测试失败') };
    }
  }

  /**
   * 获取 S3 存储桶中的文件列表
   */
  public async listFiles(
    prefix?: string
  ): Promise<{ success: boolean; files?: string[]; error?: string }> {
    return listFiles(this.client, this.config, prefix);
  }

  /**
   * 下载 S3 文件到本地
   */
  public async downloadFile(
    s3Key: string,
    localPath: string
  ): Promise<{ success: boolean; error?: string }> {
    return downloadFile(this.client, this.config, s3Key, localPath);
  }

  public async downloadText(
    s3Key: string
  ): Promise<{ success: boolean; content?: string; error?: string }> {
    return downloadText(this.client, this.config, s3Key);
  }

  public async getSignedUrl(s3Key: string, expiresInSeconds: number = 3600): Promise<string> {
    const key = resolveObjectKey(this.config, s3Key);
    return generateSignedUrl(this.client, this.config, key, expiresInSeconds);
  }

  public async getAccessibleUrl(s3Key: string, expiresInSeconds: number = 3600): Promise<string> {
    const key = resolveObjectKey(this.config, s3Key);
    if (this.config.isPrivate) {
      return generateSignedUrl(this.client, this.config, key, expiresInSeconds);
    }
    return generatePublicUrl(this.config, key);
  }

  public async getAccessibleUrlByStoredUrl(
    storedUrl: string,
    expiresInSeconds: number = 3600
  ): Promise<string> {
    if (!this.config.isPrivate) {
      return storedUrl;
    }

    const key = this.tryExtractObjectKeyFromUrl(storedUrl);
    if (!key) {
      return storedUrl;
    }

    return generateSignedUrl(this.client, this.config, key, expiresInSeconds);
  }
}
