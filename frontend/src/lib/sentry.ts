/**
 * Sentry Configuration for Error Tracking
 *
 * Features:
 * - Automatic error capture for unhandled exceptions
 * - Performance monitoring
 * - User feedback collection
 * - Integration with OpenTelemetry traces
 */

import * as Sentry from '@sentry/react';

// Configuration
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN || '';
const ENVIRONMENT = import.meta.env.MODE || 'development';

/**
 * Initialize Sentry
 */
export function initSentry() {
  if (!SENTRY_DSN) {
    console.warn('[Sentry] No DSN provided, Sentry will not be initialized');
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: ENVIRONMENT,

    // Performance Monitoring
    tracesSampleRate: 1.0, // Capture 100% of transactions for development
    tracePropagationTargets: [
      'localhost',
      /^\//,
      new RegExp(import.meta.env.VITE_API_URL || 'localhost'),
    ],

    // Session Replay
    replaysSessionSampleRate: 0.1, // 10% of sessions
    replaysOnErrorSampleRate: 1.0, // 100% of sessions with errors

    // Release tracking
    release: `delineate-frontend@${import.meta.env.VITE_APP_VERSION || '1.0.0'}`,

    // Integrations
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: false,
        blockAllMedia: false,
      }),
      Sentry.feedbackIntegration({
        colorScheme: 'system',
        showBranding: false,
        buttonLabel: 'Report a Bug',
        submitButtonLabel: 'Send Feedback',
        formTitle: 'Report an Issue',
        messagePlaceholder: 'Describe what happened...',
      }),
    ],

    // Before sending event
    beforeSend(event, hint) {
      // Add trace ID if available
      const traceId = (hint.originalException as Error & { traceId?: string })
        ?.traceId;
      if (traceId) {
        event.tags = { ...event.tags, trace_id: traceId };
      }

      return event;
    },
  });

  console.log('[Sentry] Initialized successfully');
}

/**
 * Capture an exception with additional context
 */
export function captureException(
  error: Error,
  context?: {
    traceId?: string | null;
    tags?: Record<string, string>;
    extra?: Record<string, unknown>;
  }
) {
  Sentry.withScope((scope) => {
    if (context?.traceId) {
      scope.setTag('trace_id', context.traceId);
    }

    if (context?.tags) {
      Object.entries(context.tags).forEach(([key, value]) => {
        scope.setTag(key, value);
      });
    }

    if (context?.extra) {
      Object.entries(context.extra).forEach(([key, value]) => {
        scope.setExtra(key, value);
      });
    }

    Sentry.captureException(error);
  });
}

/**
 * Capture a message with context
 */
export function captureMessage(
  message: string,
  level: 'info' | 'warning' | 'error' = 'info',
  context?: {
    traceId?: string;
    tags?: Record<string, string>;
  }
) {
  Sentry.withScope((scope) => {
    if (context?.traceId) {
      scope.setTag('trace_id', context.traceId);
    }

    if (context?.tags) {
      Object.entries(context.tags).forEach(([key, value]) => {
        scope.setTag(key, value);
      });
    }

    Sentry.captureMessage(message, level);
  });
}

/**
 * Set user context for error tracking
 */
export function setUser(user: { id?: string; email?: string; username?: string } | null) {
  Sentry.setUser(user);
}

/**
 * Add breadcrumb for debugging
 */
export function addBreadcrumb(breadcrumb: {
  category: string;
  message: string;
  level?: 'debug' | 'info' | 'warning' | 'error';
  data?: Record<string, unknown>;
}) {
  Sentry.addBreadcrumb({
    ...breadcrumb,
    timestamp: Date.now() / 1000,
  });
}

/**
 * Show user feedback dialog
 */
export function showFeedbackDialog() {
  const feedback = Sentry.getFeedback();
  if (feedback) {
    feedback.createForm().then((form) => form.appendToDom());
  }
}

export { Sentry };
