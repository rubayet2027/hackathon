/**
 * API Client with Tracing Integration
 *
 * All API calls are automatically traced with OpenTelemetry.
 * Errors are captured by Sentry with trace context.
 */

import { withSpan, getCurrentTraceId, startTrace } from './tracing';
import { captureException, addBreadcrumb } from './sentry';

// API Configuration
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// Types
export interface HealthResponse {
  status: 'healthy' | 'unhealthy';
  checks: {
    storage: 'ok' | 'error';
  };
}

export interface DownloadCheckResponse {
  file_id: number;
  available: boolean;
  s3Key: string | null;
  size: number | null;
}

export interface DownloadInitiateResponse {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  totalFileIds: number;
}

export interface DownloadStartResponse {
  file_id: number;
  download_url: string;
  expires_at: string;
}

export interface ApiError {
  message: string;
  code?: string;
  traceId?: string;
}

// Error class with trace context
export class ApiClientError extends Error {
  public traceId?: string;
  public statusCode?: number;
  public endpoint?: string;

  constructor(
    message: string,
    options?: { traceId?: string; statusCode?: number; endpoint?: string }
  ) {
    super(message);
    this.name = 'ApiClientError';
    this.traceId = options?.traceId;
    this.statusCode = options?.statusCode;
    this.endpoint = options?.endpoint;
  }
}

/**
 * Make an API request with tracing
 */
async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const { span, traceId } = startTrace(`API ${options.method || 'GET'} ${endpoint}`);

  try {
    addBreadcrumb({
      category: 'api',
      message: `${options.method || 'GET'} ${endpoint}`,
      level: 'info',
      data: { traceId },
    });

    span.setAttributes({
      'http.method': options.method || 'GET',
      'http.url': `${API_BASE_URL}${endpoint}`,
      'trace.id': traceId,
    });

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Trace-ID': traceId,
        ...options.headers,
      },
    });

    span.setAttributes({
      'http.status_code': response.status,
      'http.response_content_length': response.headers.get('content-length') || '0',
    });

    // Get request ID from response headers
    const requestId = response.headers.get('X-Request-ID');
    if (requestId) {
      span.setAttributes({ 'http.request_id': requestId });
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new ApiClientError(errorData.message || `HTTP ${response.status}`, {
        traceId,
        statusCode: response.status,
        endpoint,
      });
    }

    const data = await response.json();
    span.end();
    return data as T;
  } catch (error) {
    span.setAttributes({ 'error': true });
    span.end();

    if (error instanceof ApiClientError) {
      captureException(error, {
        traceId: error.traceId,
        tags: {
          endpoint: error.endpoint || endpoint,
          status_code: String(error.statusCode || 'unknown'),
        },
      });
      throw error;
    }

    const apiError = new ApiClientError(
      error instanceof Error ? error.message : 'Unknown error',
      { traceId, endpoint }
    );
    captureException(apiError, { traceId });
    throw apiError;
  }
}

/**
 * API Client
 */
export const api = {
  /**
   * Get health status
   */
  async getHealth(): Promise<HealthResponse> {
    return withSpan('api.health', async () => {
      return apiRequest<HealthResponse>('/health');
    });
  },

  /**
   * Check file availability
   */
  async checkDownload(fileId: number): Promise<DownloadCheckResponse> {
    return withSpan(
      'api.download.check',
      async () => {
        return apiRequest<DownloadCheckResponse>('/v1/download/check', {
          method: 'POST',
          body: JSON.stringify({ file_id: fileId }),
        });
      },
      { 'file.id': String(fileId) }
    );
  },

  /**
   * Initiate bulk download
   */
  async initiateDownload(fileIds: number[]): Promise<DownloadInitiateResponse> {
    return withSpan(
      'api.download.initiate',
      async () => {
        return apiRequest<DownloadInitiateResponse>('/v1/download/initiate', {
          method: 'POST',
          body: JSON.stringify({ file_ids: fileIds }),
        });
      },
      { 'files.count': String(fileIds.length) }
    );
  },

  /**
   * Start download (with simulated delay)
   */
  async startDownload(fileId: number): Promise<DownloadStartResponse> {
    return withSpan(
      'api.download.start',
      async () => {
        return apiRequest<DownloadStartResponse>('/v1/download/start', {
          method: 'POST',
          body: JSON.stringify({ file_id: fileId }),
        });
      },
      { 'file.id': String(fileId) }
    );
  },

  /**
   * Get current trace ID
   */
  getTraceId(): string | null {
    return getCurrentTraceId();
  },
};
