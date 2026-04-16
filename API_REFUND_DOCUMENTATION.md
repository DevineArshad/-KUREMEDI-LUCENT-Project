# Refund API Documentation

## Overview
Complete API reference for refund processing, timeline management, and configuration endpoints.

---

## Configuration Endpoints

### GET /api/config/refund-policy
Get the current refund policy (number of days users have to request a refund via Razorpay).

**Authentication**: Public  
**Parameters**: None

**Response** (200 OK):
```json
{
  "days": 7
}
```

**Example**:
```bash
curl http://localhost:3000/api/config/refund-policy
```

---

### PUT /api/config/refund-policy
Update the global refund policy (admin only).

**Authentication**: Admin  
**Body**:
```json
{
  "days": 5
}
```

**Validation**:
- `days` must be between 1 and 365
- Returns 400 if invalid

**Response** (200 OK):
```json
{
  "message": "Refund policy updated",
  "days": 5
}
```

**Example**:
```bash
curl -X PUT http://localhost:3000/api/config/refund-policy \
  -H "Content-Type: application/json" \
  -d '{"days": 5}' \
  -H "Authorization: Bearer <admin-token>"
```

---

## Order Status & Refund Endpoints

### GET /api/orders/my
Get user's orders with refund timeline information.

**Authentication**: User  
**Parameters**: None

**Response** (200 OK):
```json
[
  {
    "_id": "507f1f77bcf86cd799439011",
    "status": "CANCELLED",
    "paymentStatus": "refund_pending",
    "refundStatus": "pending",
    "refundRequestedAt": "2026-04-16T10:30:00Z",
    "refundEstimatedCompletionDate": "2026-04-21T10:30:00Z",
    "refundFailureReason": null,
    "refundRetryCount": 0,
    "totalAmt": 1000,
    "paymentMethod": "ONLINE",
    "createdAt": "2026-04-16T09:00:00Z",
    "refundDeadline": "2026-04-23T09:00:00Z",
    "refundWindowDays": 7,
    "daysRemainingForRefund": 7,
    "refundWindowActive": true
  }
]
```

**Status Field Values**:
- `refundStatus`:
  - `"none"` - Order not cancelled or unpaid
  - `"pending"` - Refund initiated, waiting to process
  - `"processing"` - Refund in progress at Razorpay
  - `"completed"` - Refund successfully credited
  - `"failed"` - Refund failed, may retry

---

### PUT /api/orders/:orderId/status
Update order status (including cancellation).

**Authentication**: Admin  
**Parameters**:
- `orderId` - Order ID (path)
- `status` - New status (body): PENDING, PLACED, CONFIRMED, DISPATCHED, DELIVERED, CANCELLED
- `forceCancel` - (optional) true if forcing cancel on dispatched/delivered

**Request Body**:
```json
{
  "status": "CANCELLED",
  "forceCancel": true
}
```

**Response** (200 OK) - When order is cancelled:
```json
{
  "message": "Order status updated",
  "order": {
    "_id": "507f1f77bcf86cd799439011",
    "status": "CANCELLED",
    "paymentStatus": "refund_pending",
    "refundStatus": "pending",
    "refundRequestedAt": "2026-04-16T10:30:00Z",
    "refundEstimatedCompletionDate": "2026-04-21T10:30:00Z",
    "refundRetryCount": 0
  },
  "warnings": []
}
```

**Example**:
```bash
curl -X PUT http://localhost:3000/api/orders/507f1f77bcf86cd799439011/status \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin-token>" \
  -d '{
    "status": "CANCELLED",
    "forceCancel": true
  }'
```

---

### POST /api/payment/orders/:orderId/process-refund
Process refund for cancelled order.

**Authentication**: Admin  
**Parameters**:
- `orderId` - Order ID (path)

**Validations**:
- Order must have status = "CANCELLED"
- Order payment status must be "refund_pending" or "paid"
- Cannot refund twice (idempotent)
- Payment must exist for online orders

**Response** (200 OK) - Successful Refund:
```json
{
  "message": "Refund processed successfully.",
  "order": {
    "_id": "507f1f77bcf86cd799439011",
    "status": "CANCELLED",
    "paymentStatus": "refunded",
    "refundStatus": "completed",
    "refundAmount": 1000,
    "refundAt": "2026-04-16T11:00:00Z",
    "refundId": "rfnd_1234567890abcdef",
    "refundRetryCount": 1
  },
  "refundId": "rfnd_1234567890abcdef",
  "refundTime": "2026-04-16T11:00:00Z",
  "refundStatus": "completed"
}
```

**Response** (400 Bad Request) - Validation Failure:
```json
{
  "message": "Only cancelled orders can be refunded.",
  "code": "ORDER_NOT_CANCELLED"
}
```

**Response** (400 Bad Request) - Refund Failure:
```json
{
  "message": "Failed to process gateway refund.",
  "refundError": {
    "code": "RAZORPAY_ERROR",
    "gateway": "razorpay"
  },
  "refundStatus": "failed",
  "refundRetryCount": 1
}
```

**Response** (409 Conflict) - Already Processing:
```json
{
  "message": "Refund is already being processed for this order.",
  "code": "REFUND_IN_PROGRESS"
}
```

**Example**:
```bash
curl -X POST http://localhost:3000/api/payment/orders/507f1f77bcf86cd799439011/process-refund \
  -H "Authorization: Bearer <admin-token>"
```

---

### POST /api/payment/orders/:orderId/retry-shiprocket-cancel
Retry Shiprocket shipment cancellation for failed cancel attempts.

**Authentication**: Admin  
**Parameters**:
- `orderId` - Order ID (path)

**Validations**:
- Order must have status = "CANCELLED"
- Shiprocket cancel status must be "failed"

**Response** (200 OK) - Successful:
```json
{
  "message": "Shiprocket cancellation retried successfully.",
  "order": {
    "_id": "507f1f77bcf86cd799439011",
    "shiprocketCancelStatus": "success",
    "shiprocketCancelError": null,
    "shiprocketCancelAttempts": 2
  }
}
```

**Response** (200 OK) - Idempotent (Already Cancelled):
```json
{
  "message": "Shipment not found or already cancelled (idempotent success).",
  "order": {
    "_id": "507f1f77bcf86cd799439011",
    "shiprocketCancelStatus": "success",
    "shiprocketCancelAttempts": 2
  }
}
```

**Response** (400 Bad Request) - Shiprocket Failure:
```json
{
  "message": "Failed to cancel shipment on Shiprocket.",
  "shiprocketError": {
    "message": "Shipment ID not found",
    "status": 404
  }
}
```

**Example**:
```bash
curl -X POST http://localhost:3000/api/payment/orders/507f1f77bcf86cd799439011/retry-shiprocket-cancel \
  -H "Authorization: Bearer <admin-token>"
```

---

### GET /api/payment/orders
Get all orders with refund information (admin).

**Authentication**: Admin  
**Query Parameters**:
- `status` (optional) - Filter by order status
- `refundStatus` (optional) - Filter by refund status
- `paymentStatus` (optional) - Filter by payment status

**Response** (200 OK):
```json
[
  {
    "_id": "507f1f77bcf86cd799439011",
    "status": "CANCELLED",
    "paymentStatus": "refunded",
    "refundStatus": "completed",
    "refundId": "rfnd_1234567890abcdef",
    "refundAmount": 1000,
    "refundAt": "2026-04-16T11:00:00Z",
    "refundFailureReason": null,
    "refundRetryCount": 0,
    "createdAt": "2026-04-16T09:00:00Z",
    "user": {
      "_id": "507f1f77bcf86cd799439012",
      "name": "John Retailer",
      "phone": "9876543210"
    }
  }
]
```

**Example**:
```bash
curl http://localhost:3000/api/payment/orders?refundStatus=completed \
  -H "Authorization: Bearer <admin-token>"
```

---

### GET /api/payment/orders/:orderId
Get single order details with refund information (admin).

**Authentication**: Admin  
**Parameters**:
- `orderId` - Order ID (path)

**Response** (200 OK):
```json
{
  "_id": "507f1f77bcf86cd799439011",
  "status": "CANCELLED",
  "paymentStatus": "refunded",
  "refundStatus": "completed",
  "refundRequestedAt": "2026-04-16T10:30:00Z",
  "refundEstimatedCompletionDate": "2026-04-21T10:30:00Z",
  "refundId": "rfnd_1234567890abcdef",
  "refundAmount": 1000,
  "refundAt": "2026-04-16T11:00:00Z",
  "refundFailureReason": null,
  "refundRetryCount": 1,
  "totalAmt": 1000,
  "paymentMethod": "ONLINE",
  "shiprocketCancelStatus": "success",
  "shiprocketCancelError": null,
  "shiprocketCancelAttempts": 1
}
```

**Example**:
```bash
curl http://localhost:3000/api/payment/orders/507f1f77bcf86cd799439011 \
  -H "Authorization: Bearer <admin-token>"
```

---

## Error Codes Reference

| Code | HTTP | Meaning |
|------|------|---------|
| `ORDER_NOT_FOUND` | 404 | Order does not exist |
| `ORDER_NOT_CANCELLED` | 400 | Can only refund cancelled orders |
| `REFUND_IN_PROGRESS` | 409 | Another refund process is ongoing |
| `REFUND_NOT_ELIGIBLE` | 400 | Order payment status not eligible |
| `MISSING_PAYMENT_REFERENCE` | 400 | No Razorpay payment ID found |
| `NO_REFUNDABLE_AMOUNT` | 400 | Nothing to refund (already refunded) |
| `PROCESS_REFUND_FAILED` | 500 | Internal server error during refund |
| `CANCEL_REQUIRES_CONFIRMATION` | 409 | Force confirm needed for dispatched orders |
| `RAZORPAY_WEBHOOK_NOT_CONFIGURED` | 503 | Webhook secret not set |
| `INVALID_WEBHOOK_SIGNATURE` | 400 | Webhook signature verification failed |

---

## State Transition Diagram

```
ORDER CREATION
      ↓
  PENDING (unpaid, refund_pending="none")
      ↓
   PLACED (paid, refund_pending="none")
      ↓
┌─────────────────────────────────────┐
│ DISPATCHED / DELIVERED              │
│ refund_pending="none"               │
│ (refund window active for 7 days)   │
└─────────────────────────────────────┘
      ↓
 CANCELLED (by admin)
 ├─ paymentStatus="refund_pending" (if paid)
 ├─ refundStatus="pending"
 └─ refundEstimatedCompletionDate set
      ↓
 [Admin: Process Refund]
      ↓
 CANCELLED
 ├─ refundStatus="processing"
 └─ Processing at Razorpay (3-5 working days)
      ↓
 CANCELLED + REFUNDED
 ├─ paymentStatus="refunded"
 ├─ refundStatus="completed" ✓
 └─ rrefundAt set
```

---

## Example User Journey

### Scenario: User places online order, then cancels

1. **Order Created**: status=PLACED, paymentStatus=paid, refundStatus=none
2. **User Views Orders**: Sees 7-day refund window countdown
3. **Admin Cancels Order**: status=CANCELLED, refundStatus=pending
4. **User Views Orders**: Sees "Refund Will Be Processed - Takes 3-5 working days"
5. **Admin Processes Refund**: refundStatus=processing, estimated completion date shown
6. **Razorpay Processes**: (3-5 working days)
7. **Refund Complete**: refundStatus=completed, User sees "Refunded"
8. **User's Bank**: Amount appears in next 1-3 days

---

## Webhook Considerations

Refund processing does NOT automatically trigger webhooks. Admin must manually process via:
```
POST /api/payment/orders/:orderId/process-refund
```

To implement automatic refund processing based on Razorpay webhooks, extend the webhook handler to:
1. Listen for Razorpay webhook events
2. Automatically call process-refund endpoint
3. Log the automation in refund audit trail

Example Razorpay events to monitor:
- `payment.failed` - Auto-refund failed payments
- `payment.authorized` - For certain use cases

---

**Last Updated**: April 16, 2026  
**API Version**: 1.0  
**Status**: Production Ready
