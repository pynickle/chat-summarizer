export interface HttpErrorContext {
  message: string;
  statusCode?: number;
  statusText?: string;
  code?: string;
  requestUrl?: string;
  responseBody?: string;
}

const toRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (typeof value === 'object' && value !== null) {
    return value as Record<string, unknown>;
  }
  return undefined;
};

const readString = (
  record: Record<string, unknown> | undefined,
  key: string
): string | undefined => {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
};

const readNumber = (
  record: Record<string, unknown> | undefined,
  key: string
): number | undefined => {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

const stringifyUnknown = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    return value.trim() || undefined;
  }
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return undefined;
    }
  }
  return String(value);
};

export const trimForLog = (text: string, maxLength: number = 1200): string => {
  return text.length > maxLength ? `${text.slice(0, maxLength)}...(truncated)` : text;
};

export const sanitizeUrlForLog = (url: string): string => {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.replace(/[?#].*$/u, '');
  }
};

export const extractHttpErrorContext = async (error: unknown): Promise<HttpErrorContext> => {
  const root = toRecord(error);
  const cause = toRecord(root?.cause);
  const response = toRecord(root?.response) ?? toRecord(cause?.response);
  const context: HttpErrorContext = {
    message: error instanceof Error ? error.message : String(error),
  };

  context.statusCode =
    readNumber(root, 'statusCode') ??
    readNumber(root, 'status') ??
    readNumber(cause, 'statusCode') ??
    readNumber(cause, 'status') ??
    readNumber(response, 'status');

  context.statusText =
    readString(root, 'statusText') ??
    readString(cause, 'statusText') ??
    readString(response, 'statusText');

  context.code = readString(root, 'code') ?? readString(cause, 'code');

  context.requestUrl =
    readString(root, 'url') ??
    readString(cause, 'url') ??
    readString(response, 'url') ??
    readString(toRecord(root?.config), 'url') ??
    readString(toRecord(cause?.config), 'url') ??
    readString(toRecord(response?.config), 'url') ??
    readString(toRecord(response?.headers), 'x-request-url');

  const responseTextFn = response?.text;
  const responseCloneFn = response?.clone;
  if (typeof responseTextFn === 'function' && typeof responseCloneFn === 'function') {
    try {
      const clonedResponse = responseCloneFn.call(response) as {
        text: () => Promise<string>;
      };
      const body = await clonedResponse.text();
      if (body.trim()) {
        context.responseBody = trimForLog(body);
      }
    } catch {}
  }

  if (!context.responseBody) {
    const fallback =
      stringifyUnknown(response?.data) ??
      stringifyUnknown(response?.body) ??
      stringifyUnknown(root?.responseBody) ??
      stringifyUnknown(root?.responseText) ??
      stringifyUnknown(root?.data) ??
      stringifyUnknown(cause?.responseBody) ??
      stringifyUnknown(cause?.responseText) ??
      stringifyUnknown(cause?.data);
    if (fallback) {
      context.responseBody = trimForLog(fallback);
    }
  }

  return context;
};
