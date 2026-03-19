import { S3Client } from '@aws-sdk/client-s3';
import { handleError } from '../core/utils';
import type { S3Config } from './s3-uploader';

function withPathPrefix(pathPrefix: string, value: string): string {
  if (!pathPrefix || pathPrefix.trim() === '') {
    return value;
  }
  const cleanPrefix = pathPrefix.replace(/^\/+|\/+$/g, '');
  if (!cleanPrefix) {
    return value;
  }
  if (value.startsWith(cleanPrefix + '/')) {
    return value;
  }
  return `${cleanPrefix}/${value}`;
}

function stripPathPrefix(pathPrefix: string, key: string): string {
  const cleanPrefix = pathPrefix.replace(/^\/+|\/+$/g, '');
  if (cleanPrefix && key.startsWith(cleanPrefix + '/')) {
    return key.substring(cleanPrefix.length + 1);
  }
  return key;
}

export function generatePublicUrl(config: S3Config, key: string): string {
  const cleanKey = key.startsWith('/') ? key.substring(1) : key;
  if (config.endpoint) {
    return `${config.endpoint.replace(/\/$/, '')}/${config.bucket}/${cleanKey}`;
  }
  return `https://${config.bucket}.s3.${config.region}.amazonaws.com/${cleanKey}`;
}

export function resolveObjectKey(config: S3Config, key: string): string {
  return withPathPrefix(config.pathPrefix, key);
}

export async function listFiles(
  client: S3Client,
  config: S3Config,
  prefix?: string
): Promise<{ success: boolean; files?: string[]; error?: string }> {
  try {
    const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
    const fullPrefix = withPathPrefix(config.pathPrefix, prefix || '');
    const command = new ListObjectsV2Command({
      Bucket: config.bucket,
      Prefix: fullPrefix,
      MaxKeys: 1000,
    });

    const response = await client.send(command);
    if (!response.Contents) {
      return { success: true, files: [] };
    }

    const files = response.Contents.filter((obj) => obj.Key && obj.Size && obj.Size > 0)
      .map((obj) => stripPathPrefix(config.pathPrefix, obj.Key!));

    return { success: true, files };
  } catch (error: any) {
    return { success: false, error: handleError(error, '获取文件列表失败') };
  }
}

export async function downloadFile(
  client: S3Client,
  config: S3Config,
  s3Key: string,
  localPath: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const command = new GetObjectCommand({
      Bucket: config.bucket,
      Key: resolveObjectKey(config, s3Key),
    });

    const response = await client.send(command);
    if (!response.Body) {
      return { success: false, error: '下载内容为空' };
    }

    const body = response.Body as any;
    if (body.read && body.pipe) {
      const fs = await import('fs');
      const stream = fs.createWriteStream(localPath);
      body.pipe(stream);
      return new Promise((resolve) => {
        stream.on('finish', () => resolve({ success: true }));
        stream.on('error', (error) => resolve({ success: false, error: error.message }));
      });
    }

    const chunks: Uint8Array[] = [];
    if (body.getReader) {
      const reader = body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
    } else {
      chunks.push(new Uint8Array(Buffer.from(body)));
    }

    const buffer = Buffer.concat(chunks);
    const fs = await import('fs/promises');
    await fs.writeFile(localPath, buffer);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: handleError(error, '下载文件失败') };
  }
}

export async function downloadText(
  client: S3Client,
  config: S3Config,
  s3Key: string
): Promise<{ success: boolean; content?: string; error?: string }> {
  try {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const command = new GetObjectCommand({
      Bucket: config.bucket,
      Key: resolveObjectKey(config, s3Key),
    });

    const response = await client.send(command);
    const body = response.Body as unknown;
    if (!body) {
      return { success: false, error: '下载内容为空' };
    }

    if (
      typeof (body as { transformToString?: (encoding?: string) => Promise<string> })
        .transformToString === 'function'
    ) {
      const content = await (
        body as { transformToString: (encoding?: string) => Promise<string> }
      ).transformToString('utf-8');
      return { success: true, content };
    }

    const chunks: Uint8Array[] = [];
    const reader = body as {
      getReader?: () => { read: () => Promise<{ done: boolean; value?: Uint8Array }> };
      read?: () => unknown;
      on?: (event: string, cb: (arg?: unknown) => void) => void;
    };

    if (reader.getReader) {
      const readerInstance = reader.getReader();
      while (true) {
        const { done, value } = await readerInstance.read();
        if (done) break;
        if (value) chunks.push(value);
      }
    } else if (reader.read && reader.on) {
      await new Promise<void>((resolve, reject) => {
        (body as { on: (event: string, cb: (arg?: unknown) => void) => void }).on(
          'data',
          (chunk: unknown) => {
            if (chunk instanceof Buffer) {
              chunks.push(new Uint8Array(chunk));
            } else if (chunk instanceof Uint8Array) {
              chunks.push(chunk);
            } else {
              chunks.push(new Uint8Array(Buffer.from(String(chunk))));
            }
          }
        );
        (body as { on: (event: string, cb: (arg?: unknown) => void) => void }).on('end', () =>
          resolve()
        );
        (body as { on: (event: string, cb: (arg?: unknown) => void) => void }).on(
          'error',
          (err: unknown) => reject(err)
        );
      });
    } else {
      chunks.push(new Uint8Array(Buffer.from(body as Buffer | string)));
    }

    const content = Buffer.concat(chunks).toString('utf-8');
    return { success: true, content };
  } catch (error: any) {
    return { success: false, error: handleError(error, '下载文本失败') };
  }
}
