import { useState, useEffect, Component, ReactNode } from 'react';
import * as Sentry from '@sentry/react';
import {
  Activity,
  Download,
  AlertCircle,
  CheckCircle,
  XCircle,
  RefreshCw,
  ExternalLink,
  Database,
  Server,
  Gauge,
  Bug,
  Layers,
  Clock,
  FileDown,
  Send,
  Trash2,
} from 'lucide-react';
import { api, HealthResponse, ApiClientError } from './lib/api';
import { captureException, captureMessage, showFeedbackDialog } from './lib/sentry';
import { getCurrentTraceId, createSpan } from './lib/tracing';

// ============================================================================
// Error Boundary
// ============================================================================

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  traceId: string | null;
}

class ErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: ReactNode; fallback?: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null, traceId: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error, traceId: getCurrentTraceId() };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    const traceId = getCurrentTraceId();
    captureException(error, {
      traceId,
      extra: { componentStack: errorInfo.componentStack },
    });
    console.error('Error boundary caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
          <div className="card max-w-md w-full p-6 text-center">
            <XCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Something went wrong</h2>
            <p className="text-muted-foreground mb-4">
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>
            {this.state.traceId && (
              <p className="text-xs text-muted-foreground mb-4 font-mono">
                Trace ID: {this.state.traceId}
              </p>
            )}
            <div className="flex gap-2 justify-center">
              <button
                onClick={() => window.location.reload()}
                className="btn-primary"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Reload
              </button>
              <button
                onClick={() => showFeedbackDialog()}
                className="btn-outline"
              >
                <Bug className="h-4 w-4 mr-2" />
                Report Bug
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// ============================================================================
// Health Status Component
// ============================================================================

interface HealthStatusProps {
  health: HealthResponse | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

function HealthStatus({ health, loading, error, onRefresh }: HealthStatusProps) {
  const isHealthy = health?.status === 'healthy';
  const storageOk = health?.checks.storage === 'ok';

  return (
    <div className="card animate-fade-in">
      <div className="card-header flex-row items-center justify-between space-y-0 pb-2">
        <h3 className="text-sm font-medium">System Health</h3>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="btn-ghost btn-icon h-8 w-8"
          title="Refresh health status"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <div className="card-content">
        {error ? (
          <div className="flex items-center gap-2 text-red-500">
            <XCircle className="h-5 w-5" />
            <span className="text-sm">{error}</span>
          </div>
        ) : loading && !health ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <RefreshCw className="h-5 w-5 animate-spin" />
            <span className="text-sm">Checking health...</span>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Overall Status */}
            <div className="flex items-center gap-3">
              <div
                className={`status-dot ${isHealthy ? 'status-dot-healthy' : 'status-dot-unhealthy'}`}
              />
              <div>
                <p className="font-medium">
                  {isHealthy ? 'All Systems Operational' : 'System Issues Detected'}
                </p>
                <p className="text-xs text-muted-foreground">
                  Last checked: {new Date().toLocaleTimeString()}
                </p>
              </div>
            </div>

            {/* Service Checks */}
            <div className="grid gap-2">
              <div className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">API Server</span>
                </div>
                {isHealthy ? (
                  <CheckCircle className="h-4 w-4 text-green-500" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-500" />
                )}
              </div>

              <div className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">S3 Storage (MinIO)</span>
                </div>
                {storageOk ? (
                  <CheckCircle className="h-4 w-4 text-green-500" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-500" />
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Download Jobs Component
// ============================================================================

interface DownloadJob {
  id: string;
  fileId: number;
  status: 'pending' | 'checking' | 'downloading' | 'completed' | 'failed';
  downloadUrl?: string;
  error?: string;
  traceId?: string | null;
  startedAt: Date;
  completedAt?: Date;
}

interface DownloadJobsProps {
  jobs: DownloadJob[];
  onInitiate: (fileIds: number[]) => void;
  onClear: () => void;
}

function DownloadJobs({ jobs, onInitiate, onClear }: DownloadJobsProps) {
  const [fileIdInput, setFileIdInput] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const ids = fileIdInput
      .split(',')
      .map((id) => parseInt(id.trim(), 10))
      .filter((id) => !isNaN(id) && id > 0);

    if (ids.length > 0) {
      onInitiate(ids);
      setFileIdInput('');
    }
  };

  const getStatusBadge = (status: DownloadJob['status']) => {
    switch (status) {
      case 'pending':
        return <span className="badge badge-secondary">Pending</span>;
      case 'checking':
        return <span className="badge badge-outline">Checking</span>;
      case 'downloading':
        return <span className="badge badge-warning">Downloading</span>;
      case 'completed':
        return <span className="badge badge-success">Completed</span>;
      case 'failed':
        return <span className="badge badge-destructive">Failed</span>;
    }
  };

  return (
    <div className="card animate-fade-in">
      <div className="card-header">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <FileDown className="h-4 w-4" />
            Download Jobs
          </h3>
          {jobs.length > 0 && (
            <button
              onClick={onClear}
              className="btn-ghost btn-sm text-muted-foreground"
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Clear
            </button>
          )}
        </div>
      </div>
      <div className="card-content space-y-4">
        {/* Input Form */}
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={fileIdInput}
            onChange={(e) => setFileIdInput(e.target.value)}
            placeholder="Enter file IDs (e.g., 1, 2, 3)"
            className="input flex-1"
          />
          <button type="submit" className="btn-primary">
            <Send className="h-4 w-4 mr-2" />
            Download
          </button>
        </form>

        {/* Quick Actions */}
        <div className="flex gap-2">
          <button
            onClick={() => onInitiate([1, 2, 3])}
            className="btn-outline btn-sm"
          >
            Test: Files 1-3
          </button>
          <button
            onClick={() => onInitiate([4, 5])}
            className="btn-outline btn-sm"
          >
            Test: Files 4-5
          </button>
        </div>

        {/* Jobs List */}
        {jobs.length > 0 ? (
          <div className="space-y-2 max-h-64 overflow-y-auto scrollbar-thin">
            {jobs.map((job) => (
              <div
                key={job.id}
                className="flex items-center justify-between p-3 rounded-md bg-muted/50"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <Download className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">File #{job.fileId}</p>
                    {job.error ? (
                      <p className="text-xs text-red-500 truncate">{job.error}</p>
                    ) : job.downloadUrl ? (
                      <a
                        href={job.downloadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-500 hover:underline flex items-center gap-1"
                      >
                        Download link <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {job.traceId && `Trace: ${job.traceId.slice(0, 8)}...`}
                      </p>
                    )}
                  </div>
                </div>
                {getStatusBadge(job.status)}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">
            No download jobs yet. Enter file IDs above to start.
          </p>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Error Log Component
// ============================================================================

interface ErrorLogEntry {
  id: string;
  message: string;
  timestamp: Date;
  traceId?: string | null;
  level: 'error' | 'warning' | 'info';
}

interface ErrorLogProps {
  errors: ErrorLogEntry[];
  onClear: () => void;
  onTriggerError: () => void;
}

function ErrorLog({ errors, onClear, onTriggerError }: ErrorLogProps) {
  const getLevelIcon = (level: ErrorLogEntry['level']) => {
    switch (level) {
      case 'error':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'warning':
        return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      case 'info':
        return <CheckCircle className="h-4 w-4 text-blue-500" />;
    }
  };

  return (
    <div className="card animate-fade-in">
      <div className="card-header">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Bug className="h-4 w-4" />
            Error Log
          </h3>
          <div className="flex gap-2">
            <button onClick={onTriggerError} className="btn-outline btn-sm">
              <AlertCircle className="h-3 w-3 mr-1" />
              Test Error
            </button>
            {errors.length > 0 && (
              <button
                onClick={onClear}
                className="btn-ghost btn-sm text-muted-foreground"
              >
                <Trash2 className="h-3 w-3 mr-1" />
                Clear
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="card-content">
        {errors.length > 0 ? (
          <div className="space-y-2 max-h-48 overflow-y-auto scrollbar-thin">
            {errors.map((entry) => (
              <div
                key={entry.id}
                className="flex items-start gap-2 p-2 rounded-md bg-muted/50"
              >
                {getLevelIcon(entry.level)}
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate-2">{entry.message}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-muted-foreground">
                      {entry.timestamp.toLocaleTimeString()}
                    </span>
                    {entry.traceId && (
                      <span className="text-xs font-mono text-muted-foreground">
                        {entry.traceId.slice(0, 8)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">
            No errors logged. Click "Test Error" to simulate one.
          </p>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Trace Viewer Component
// ============================================================================

interface TraceViewerProps {
  currentTraceId: string | null;
  jaegerUrl: string;
}

function TraceViewer({ currentTraceId, jaegerUrl }: TraceViewerProps) {
  return (
    <div className="card animate-fade-in">
      <div className="card-header">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Layers className="h-4 w-4" />
          Distributed Tracing
        </h3>
      </div>
      <div className="card-content space-y-4">
        {/* Current Trace */}
        <div className="p-3 rounded-md bg-muted/50">
          <p className="text-xs text-muted-foreground mb-1">Current Trace ID</p>
          <p className="font-mono text-sm break-all">
            {currentTraceId || 'No active trace'}
          </p>
        </div>

        {/* Jaeger Link */}
        <div className="space-y-2">
          <a
            href={jaegerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary w-full"
          >
            <ExternalLink className="h-4 w-4 mr-2" />
            Open Jaeger UI
          </a>

          {currentTraceId && (
            <a
              href={`${jaegerUrl}/trace/${currentTraceId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-outline w-full"
            >
              <Activity className="h-4 w-4 mr-2" />
              View Current Trace
            </a>
          )}
        </div>

        {/* Info */}
        <div className="text-xs text-muted-foreground">
          <p>Traces are sent to Jaeger via OpenTelemetry.</p>
          <p className="mt-1">
            Each API call creates a trace that can be viewed in the Jaeger UI.
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Performance Metrics Component
// ============================================================================

interface PerformanceMetricsProps {
  metrics: {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    averageResponseTime: number;
  };
}

function PerformanceMetrics({ metrics }: PerformanceMetricsProps) {
  const successRate =
    metrics.totalRequests > 0
      ? ((metrics.successfulRequests / metrics.totalRequests) * 100).toFixed(1)
      : '0.0';

  return (
    <div className="card animate-fade-in">
      <div className="card-header">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Gauge className="h-4 w-4" />
          Performance Metrics
        </h3>
      </div>
      <div className="card-content">
        <div className="grid grid-cols-2 gap-4">
          <div className="text-center p-3 rounded-md bg-muted/50">
            <p className="text-2xl font-bold">{metrics.totalRequests}</p>
            <p className="text-xs text-muted-foreground">Total Requests</p>
          </div>

          <div className="text-center p-3 rounded-md bg-muted/50">
            <p className="text-2xl font-bold text-green-500">{successRate}%</p>
            <p className="text-xs text-muted-foreground">Success Rate</p>
          </div>

          <div className="text-center p-3 rounded-md bg-muted/50">
            <p className="text-2xl font-bold text-red-500">
              {metrics.failedRequests}
            </p>
            <p className="text-xs text-muted-foreground">Failed Requests</p>
          </div>

          <div className="text-center p-3 rounded-md bg-muted/50">
            <p className="text-2xl font-bold flex items-center justify-center gap-1">
              <Clock className="h-4 w-4" />
              {metrics.averageResponseTime.toFixed(0)}ms
            </p>
            <p className="text-xs text-muted-foreground">Avg Response Time</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main App Component
// ============================================================================

function App() {
  // State
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);

  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [errors, setErrors] = useState<ErrorLogEntry[]>([]);
  const [currentTraceId, setCurrentTraceId] = useState<string | null>(null);

  const [metrics, setMetrics] = useState({
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    averageResponseTime: 0,
    responseTimes: [] as number[],
  });

  const jaegerUrl = import.meta.env.VITE_JAEGER_URL || 'http://localhost:16686';

  // Add error to log
  const addError = (message: string, level: ErrorLogEntry['level'] = 'error') => {
    const traceId = getCurrentTraceId();
    setErrors((prev) => [
      {
        id: `error-${Date.now()}`,
        message,
        timestamp: new Date(),
        traceId,
        level,
      },
      ...prev.slice(0, 49), // Keep last 50 errors
    ]);
  };

  // Update metrics
  const updateMetrics = (success: boolean, responseTime: number) => {
    setMetrics((prev) => {
      const newResponseTimes = [...prev.responseTimes, responseTime].slice(-100);
      const avgTime =
        newResponseTimes.reduce((a, b) => a + b, 0) / newResponseTimes.length;

      return {
        totalRequests: prev.totalRequests + 1,
        successfulRequests: prev.successfulRequests + (success ? 1 : 0),
        failedRequests: prev.failedRequests + (success ? 0 : 1),
        averageResponseTime: avgTime,
        responseTimes: newResponseTimes,
      };
    });
  };

  // Fetch health status
  const fetchHealth = async () => {
    setHealthLoading(true);
    setHealthError(null);
    const startTime = performance.now();

    try {
      const data = await api.getHealth();
      setHealth(data);
      setCurrentTraceId(getCurrentTraceId());
      updateMetrics(true, performance.now() - startTime);
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : 'Failed to fetch health';
      setHealthError(message);
      addError(message);
      updateMetrics(false, performance.now() - startTime);
    } finally {
      setHealthLoading(false);
    }
  };

  // Initiate download jobs
  const initiateDownloads = async (fileIds: number[]) => {
    const span = createSpan('initiateDownloads');

    for (const fileId of fileIds) {
      const jobId = `job-${Date.now()}-${fileId}`;
      const traceId = getCurrentTraceId();

      // Add pending job
      setJobs((prev) => [
        {
          id: jobId,
          fileId,
          status: 'pending',
          traceId,
          startedAt: new Date(),
        },
        ...prev,
      ]);

      // Process job
      processDownloadJob(jobId, fileId);
    }

    span.end();
  };

  // Process a single download job
  const processDownloadJob = async (jobId: string, fileId: number) => {
    const startTime = performance.now();

    try {
      // Update to checking
      setJobs((prev) =>
        prev.map((j) => (j.id === jobId ? { ...j, status: 'checking' as const } : j))
      );

      // Check availability
      const checkResult = await api.checkDownload(fileId);

      if (!checkResult.available) {
        setJobs((prev) =>
          prev.map((j) =>
            j.id === jobId
              ? {
                  ...j,
                  status: 'failed' as const,
                  error: 'File not available in storage',
                  completedAt: new Date(),
                }
              : j
          )
        );
        addError(`File #${fileId} not available`, 'warning');
        updateMetrics(false, performance.now() - startTime);
        return;
      }

      // Update to downloading
      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId ? { ...j, status: 'downloading' as const } : j
        )
      );

      // Start download
      const downloadResult = await api.startDownload(fileId);

      // Update to completed
      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId
            ? {
                ...j,
                status: 'completed' as const,
                downloadUrl: downloadResult.download_url,
                completedAt: new Date(),
              }
            : j
        )
      );

      setCurrentTraceId(getCurrentTraceId());
      updateMetrics(true, performance.now() - startTime);
    } catch (error) {
      const message =
        error instanceof ApiClientError
          ? error.message
          : `Download failed for file #${fileId}`;

      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId
            ? {
                ...j,
                status: 'failed' as const,
                error: message,
                completedAt: new Date(),
              }
            : j
        )
      );

      addError(message);
      updateMetrics(false, performance.now() - startTime);
    }
  };

  // Trigger test error
  const triggerTestError = () => {
    try {
      captureMessage('Test error triggered from dashboard', 'warning');
      addError('Test error triggered', 'warning');

      // Also throw an actual error to test error boundary
      throw new Error('This is a test error from the dashboard');
    } catch (error) {
      if (error instanceof Error) {
        captureException(error);
        addError(error.message, 'error');
      }
    }
  };

  // Initial health check
  useEffect(() => {
    fetchHealth();

    // Auto-refresh health every 30 seconds
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
        {/* Header */}
        <header className="sticky top-0 z-50 glass border-b">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Activity className="h-8 w-8 text-primary" />
                <div>
                  <h1 className="text-xl font-bold">Delineate Dashboard</h1>
                  <p className="text-xs text-muted-foreground">
                    Hackathon 2025 - Observability Demo
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <a
                  href={jaegerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-outline btn-sm"
                >
                  <Layers className="h-4 w-4 mr-1" />
                  Jaeger
                </a>
                <button
                  onClick={() => showFeedbackDialog()}
                  className="btn-ghost btn-sm"
                >
                  <Bug className="h-4 w-4 mr-1" />
                  Feedback
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="container mx-auto px-4 py-6">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {/* Health Status */}
            <div className="lg:col-span-1">
              <HealthStatus
                health={health}
                loading={healthLoading}
                error={healthError}
                onRefresh={fetchHealth}
              />
            </div>

            {/* Performance Metrics */}
            <div className="lg:col-span-1">
              <PerformanceMetrics metrics={metrics} />
            </div>

            {/* Trace Viewer */}
            <div className="lg:col-span-1">
              <TraceViewer currentTraceId={currentTraceId} jaegerUrl={jaegerUrl} />
            </div>

            {/* Download Jobs - Full Width */}
            <div className="md:col-span-2 lg:col-span-2">
              <DownloadJobs
                jobs={jobs}
                onInitiate={initiateDownloads}
                onClear={() => setJobs([])}
              />
            </div>

            {/* Error Log */}
            <div className="lg:col-span-1">
              <ErrorLog
                errors={errors}
                onClear={() => setErrors([])}
                onTriggerError={triggerTestError}
              />
            </div>
          </div>
        </main>

        {/* Footer */}
        <footer className="border-t mt-8">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <p>CUET Micro-Ops Hackathon 2025</p>
              <p>
                Built with React + Sentry + OpenTelemetry
              </p>
            </div>
          </div>
        </footer>
      </div>
    </ErrorBoundary>
  );
}

export default Sentry.withProfiler(App);
