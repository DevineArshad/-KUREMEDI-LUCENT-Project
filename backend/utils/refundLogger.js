/**
 * Production-grade refund operation logger
 * Tracks all refund state changes and failures for audit trail
 */

const logRefundOperation = (operation) => {
  const {
    orderId,
    userId,
    operationType, // 'INITIATE', 'PROCESS', 'SUCCESS', 'FAILURE', 'RETRY'
    refundStatus,
    amount,
    paymentMethod,
    gatewayRefundId,
    errorMessage,
    errorCode,
    timestamp = new Date(),
  } = operation;

  const logEntry = {
    timestamp: new Date(timestamp).toISOString(),
    orderId: String(orderId).slice(-8),
    userId: String(userId).slice(-8),
    operationType,
    refundStatus,
    amount,
    paymentMethod,
    gatewayRefundId: gatewayRefundId || 'N/A',
    errorMessage: errorMessage || null,
    errorCode: errorCode || null,
  };

  // Log to console in development
  if (process.env.NODE_ENV !== 'production') {
    const color = operationType === 'FAILURE' ? '\x1b[31m' : '\x1b[32m';
    console.log(
      `${color}[REFUND ${operationType}]\x1b[0m`,
      JSON.stringify(logEntry, null, 2)
    );
  }

  // In production, you can integrate with:
  // - CloudWatch / DataDog / Sentry for centralized logging
  // - MongoDB collection for local audit trail
  // - File-based logging for backup
  
  return logEntry;
};

/**
 * Log refund initiation when order is cancelled
 */
export const logRefundInitiation = (order) => {
  return logRefundOperation({
    orderId: order._id,
    userId: order.user,
    operationType: 'INITIATE',
    refundStatus: 'pending',
    amount: order.payableAmount,
    paymentMethod: order.paymentMethod,
    timestamp: new Date(),
  });
};

/**
 * Log successful refund processing
 */
export const logRefundSuccess = (order, refundId) => {
  return logRefundOperation({
    orderId: order._id,
    userId: order.user,
    operationType: 'SUCCESS',
    refundStatus: 'completed',
    amount: order.refundAmount,
    paymentMethod: order.paymentMethod,
    gatewayRefundId: refundId,
    timestamp: new Date(),
  });
};

/**
 * Log refund failure with error details
 */
export const logRefundFailure = (order, errorMessage, errorCode) => {
  return logRefundOperation({
    orderId: order._id,
    userId: order.user,
    operationType: 'FAILURE',
    refundStatus: 'failed',
    amount: order.payableAmount,
    paymentMethod: order.paymentMethod,
    errorMessage,
    errorCode,
    timestamp: new Date(),
  });
};

/**
 * Log refund retry attempt
 */
export const logRefundRetry = (order, retryCount) => {
  return logRefundOperation({
    orderId: order._id,
    userId: order.user,
    operationType: 'RETRY',
    refundStatus: 'pending',
    amount: order.payableAmount,
    paymentMethod: order.paymentMethod,
    errorMessage: `Retry attempt #${retryCount}`,
    timestamp: new Date(),
  });
};

/**
 * Production-grade refund status tracker
 * Ensures consistent state management
 */
export const RefundStatusEnum = {
  NONE: 'none',
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

/**
 * Validate refund state transition
 * Ensures only valid state transitions occur
 */
export const isValidRefundStateTransition = (currentStatus, newStatus) => {
  const validTransitions = {
    [RefundStatusEnum.NONE]: [RefundStatusEnum.PENDING],
    [RefundStatusEnum.PENDING]: [RefundStatusEnum.PROCESSING, RefundStatusEnum.FAILED],
    [RefundStatusEnum.PROCESSING]: [RefundStatusEnum.COMPLETED, RefundStatusEnum.FAILED],
    [RefundStatusEnum.COMPLETED]: [RefundStatusEnum.COMPLETED], // idempotent
    [RefundStatusEnum.FAILED]: [RefundStatusEnum.PENDING], // can retry from failed
  };

  const allowed = validTransitions[currentStatus] || [];
  return allowed.includes(newStatus);
};

export default logRefundOperation;
