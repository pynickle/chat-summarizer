export interface ExportRequest {
  guildId?: string;
  timeRange: string;
  format: 'json' | 'txt' | 'csv';
  messageTypes?: string[];
}

export interface ExportResult {
  success: boolean;
  s3Url?: string;
  s3Key?: string;
  error?: string;
  message?: string;
}

export interface ParsedTimeRange {
  startDate: Date;
  endDate: Date;
  dateStrings: string[];
}

export interface ChatMessage {
  time: string;
  username: string;
  content: string;
  guildId?: string;
  messageType: string;
}
