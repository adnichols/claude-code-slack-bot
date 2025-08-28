import { Logger } from './logger';
import { ErrorAnalyzer, ActionableError } from './error-analyzer';

export interface ErrorContext {
  operation: string;
  userId?: string;
  channel?: string;
  sessionKey?: string;
  additionalContext?: Record<string, any>;
}

export interface ErrorResult {
  userMessage: string;
  shouldRetry: boolean;
  actionableError: ActionableError;
}

export class ErrorHandler {
  private logger: Logger;

  constructor(loggerName: string) {
    this.logger = new Logger(loggerName);
  }

  /**
   * Handle and analyze an error with context
   */
  handleError(error: any, context: ErrorContext): ErrorResult {
    // Analyze the error
    const actionableError = ErrorAnalyzer.analyzeError(error);
    
    // Log the error with context
    this.logger.error(`Failed operation: ${context.operation}`, {
      error: error.message || error.toString(),
      stack: error.stack,
      category: actionableError.category,
      severity: actionableError.severity,
      userId: context.userId,
      channel: context.channel,
      sessionKey: context.sessionKey,
      ...context.additionalContext,
    });

    // Format user-friendly message
    const userMessage = ErrorAnalyzer.formatErrorMessage(actionableError);

    // Determine if operation should be retried
    const shouldRetry = this.shouldRetryOperation(actionableError);

    return {
      userMessage,
      shouldRetry,
      actionableError,
    };
  }

  /**
   * Handle async operation with standardized error handling
   */
  async handleAsyncOperation<T>(
    operation: () => Promise<T>,
    context: ErrorContext
  ): Promise<{ success: true; data: T } | { success: false; error: ErrorResult }> {
    try {
      const data = await operation();
      return { success: true, data };
    } catch (error) {
      const errorResult = this.handleError(error, context);
      return { success: false, error: errorResult };
    }
  }

  /**
   * Handle sync operation with standardized error handling
   */
  handleSyncOperation<T>(
    operation: () => T,
    context: ErrorContext
  ): { success: true; data: T } | { success: false; error: ErrorResult } {
    try {
      const data = operation();
      return { success: true, data };
    } catch (error) {
      const errorResult = this.handleError(error, context);
      return { success: false, error: errorResult };
    }
  }

  /**
   * Log warning with context
   */
  warn(message: string, context?: Record<string, any>): void {
    this.logger.warn(message, context);
  }

  /**
   * Log info with context
   */
  info(message: string, context?: Record<string, any>): void {
    this.logger.info(message, context);
  }

  /**
   * Log debug with context
   */
  debug(message: string, context?: Record<string, any>): void {
    this.logger.debug(message, context);
  }

  /**
   * Determine if an operation should be retried based on error category
   */
  private shouldRetryOperation(actionableError: ActionableError): boolean {
    switch (actionableError.category) {
      case 'external_service':
        // Retry external service errors (network issues, rate limits, etc.)
        return actionableError.severity !== 'critical';
      case 'internal':
        // Don't retry internal errors unless they're low severity
        return actionableError.severity === 'low';
      case 'user_action_required':
      case 'configuration':
      case 'permission':
        // Don't retry errors that require user intervention
        return false;
      default:
        return false;
    }
  }

  /**
   * Create a standardized error handler for a specific component
   */
  static forComponent(componentName: string): ErrorHandler {
    return new ErrorHandler(componentName);
  }
}