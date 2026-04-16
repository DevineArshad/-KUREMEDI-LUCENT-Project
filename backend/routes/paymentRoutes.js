import express from "express";
import { protect } from "../middleware/protect.js";
import { requireKycApproved } from "../middleware/authorize.js";
import Order from "../model/Order.js";
import {
  createPaymentOrder,
  generateOrderAwb,
  getPaymentStatus,
  handleRazorpayWebhook,
  processOrderRefund,
  retryShiprocketCancel,
  verifyPayment,
  updateOrderStatus,
} from "../controllers/payment.controller.js";

const router = express.Router();

const toTrackingUrl = (awb, trackingUrl) => {
  if (!awb) return null;
  const safe = `https://shiprocket.co/tracking/${encodeURIComponent(awb)}`;
  if (!trackingUrl) return safe;
  if (trackingUrl.includes("track.shiprocket.in")) return safe;
  if (trackingUrl.includes("shiprocket.in/shipment-tracking")) return safe;
  return trackingUrl;
};

const normalizeOrderStatus = (status) => {
  const normalized = String(status || "").toUpperCase();
  return normalized === "REFUNDED" ? "CANCELLED" : normalized;
};

// ============ ADMIN (no auth - admin may use separate session) ============

/**
 * GET /api/payment/orders
 * Returns all orders for admin dashboard
 */
router.get("/orders", async (req, res) => {
  try {
    const orders = await Order.find()
      .populate("user", "name email phone")
      .populate({ path: "items.product", populate: { path: "category", select: "name" } })
      .sort({ createdAt: -1 });

    // Do not show unpaid online checkout attempts on admin dashboard.
    const visibleOrders = orders.filter((o) => {
      const status = String(o.status || "").toUpperCase();
      const paymentMethod = String(o.paymentMethod || "").toUpperCase();
      const razorpayAmount = Number(o.razorpayAmount || 0);
      const paymentRef = String(o.razorpayPaymentId || "").trim();

      const isUnpaidOnlinePending =
        paymentMethod === "ONLINE" &&
        status === "PENDING" &&
        razorpayAmount > 0 &&
        !paymentRef;

      return !isUnpaidOnlinePending;
    });

    const mapped = visibleOrders.map((o) => ({
      
      _id: o._id,
      orderDate: o.createdAt,
      totalAmt: o.payableAmount ?? o.totalAmount ?? 0,
      cartItems: (o.items || []).map((it) => ({
        name: it.productName || (it.product?.productName) || "",
        quantity: it.quantity || 1,
        price: it.price || it.mrp || 0,
        productId: {
          subCategory: [
            {
              name:
                (typeof it.product?.category === "object" && it.product?.category?.name) ||
                "General",
            },
          ],
          name: it.productName || (it.product?.productName) || "",
        },
      })),
      user: o.user,
      status: normalizeOrderStatus(o.status),
      paymentStatus: o.paymentStatus || "unpaid",
      paymentMethod: o.paymentMethod,
      refundId: o.refundId || o.razorpayRefundId || null,
      refundTime: o.refundAt || null,
      shiprocketShipmentId: o.shiprocketShipmentId || null,
      shiprocketAwb: o.shiprocketAwb || null,
      shiprocketLabelUrl: o.shiprocketLabelUrl || null,
      shiprocketCancelStatus: o.shiprocketCancelStatus || "not_required",
      shiprocketCancelError: o.shiprocketCancelError || null,
      trackingUrl: toTrackingUrl(o.shiprocketAwb, o.trackingUrl),
    }));

    res.json(mapped);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch orders" });
  }
});

/**
 * GET /api/payment/orders/:orderId
 * Returns a single order by ID for admin order detail view
 */
router.get("/orders/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findById(orderId)
      .populate("user", "name email phone")
      .populate({ path: "items.product", populate: { path: "category", select: "name" } });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Map to match frontend expectations (status + tracking for app/website)
    const mapped = {
      _id: order._id,
      status: normalizeOrderStatus(order.status),
      paymentStatus: order.paymentStatus || "unpaid",
      createdAt: order.createdAt,
      paymentMethod: order.paymentMethod || "COD",
      totalAmt: order.payableAmount ?? order.totalAmount ?? 0,
      user: {
        name: order.user?.name || "",
        phone: order.user?.phone || "",
        email: order.user?.email || "",
      },
      address: order.shippingAddress || {
        name: order.user?.name || "",
        phone: order.shippingAddress?.phone || order.user?.phone || "",
        addressLine1: order.shippingAddress?.address || "",
        addressLine2: "",
        city: order.shippingAddress?.shopName || order.shippingAddress?.city || "",
        state: order.shippingAddress?.state || "",
        pincode: order.shippingAddress?.pincode || "",
      },
      cartItems: (order.items || []).map((it) => ({
        name: it.productName || (it.product?.productName) || "",
        quantity: it.quantity || 1,
        price: it.price || it.mrp || 0,
      })),
      shiprocketShipmentId: order.shiprocketShipmentId || null,
      shiprocketAwb: order.shiprocketAwb || null,
      shiprocketLabelUrl: order.shiprocketLabelUrl || null,
      shiprocketCancelStatus: order.shiprocketCancelStatus || "not_required",
      shiprocketCancelError: order.shiprocketCancelError || null,
      refundId: order.refundId || order.razorpayRefundId || null,
      refundTime: order.refundAt || null,
      trackingUrl: toTrackingUrl(order.shiprocketAwb, order.trackingUrl),
    };

    res.json({ data: mapped });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch order" });
  }
});

/**
 * PUT /api/payment/update-status
 * Admin: Update order status (or other fields)
 * Body: { orderId, status } or { orderId, [field]: value }
 */
router.put("/update-status", updateOrderStatus);
router.post("/orders/:orderId/shiprocket/generate-awb", generateOrderAwb);
router.post("/orders/:orderId/process-refund", processOrderRefund);
router.post("/orders/:orderId/retry-shiprocket-cancel", retryShiprocketCancel);

// ============ USER (protected) ============

/**
 * POST /api/payment/webhook
 * Razorpay webhook endpoint
 */
router.post("/webhook", handleRazorpayWebhook);

/**
 * POST /api/payment/create-order
 * Checkout: Create order in PENDING, return Razorpay order for payment
 * Body: { shippingAddress?, notes? }
 */
router.post("/create-order", protect, requireKycApproved, createPaymentOrder);

/**
 * POST /api/payment/verify-payment
 * Verify Razorpay payment and confirm order (reduce stock, clear cart)
 * Body: { razorpayOrderId, razorpayPaymentId, razorpaySignature }
 */
router.post("/verify-payment", protect, requireKycApproved, verifyPayment);
router.get("/status/:razorpayOrderId", protect, requireKycApproved, getPaymentStatus);

export default router;
