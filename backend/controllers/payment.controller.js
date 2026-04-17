import crypto from "crypto";
import Razorpay from "razorpay";
import Cart from "../model/Cart.js";
import Order from "../model/Order.js";
import Product from "../model/Product.js";
import User from "../model/User.js";
import Wallet from "../model/Wallet.js";
import Config from "../model/Config.js";
import {
  createShiprocketOrder,
  mapOrderToShiprocketPayload,
  generateAWB,
  generateLabel,
  generateManifest,
  schedulePickup,
  cancelShipment,
  cancelOrder,
} from "../config/shiprocket.js";
import { calculateLinePricing } from "../utils/pricing.js";
import { getValidatedRazorpayConfig } from "../utils/razorpayConfig.js";

const MIN_CHECKOUT_AMOUNT_KEY = "minimumCheckoutAmount";
const FALLBACK_ITEM_WEIGHT_KG = 0.5;
const REFUND_PROCESSING_MIN_DAYS = 3;
const REFUND_PROCESSING_MAX_DAYS = 5;

/**
 * Calculate estimated refund completion date (3-5 working days)
 * Excludes weekends from the count
 */
function calculateEstimatedRefundCompletionDate(fromDate = null) {
  const startDate = fromDate ? new Date(fromDate) : new Date();
  const targetDate = new Date(startDate);
  let workingDaysAdded = 0;
  const targetWorkingDays = REFUND_PROCESSING_MAX_DAYS;

  // Start from next day to avoid same-day processing
  targetDate.setDate(targetDate.getDate() + 1);

  while (workingDaysAdded < targetWorkingDays) {
    const dayOfWeek = targetDate.getDay();
    // 0 = Sunday, 6 = Saturday
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      workingDaysAdded++;
    }
    if (workingDaysAdded < targetWorkingDays) {
      targetDate.setDate(targetDate.getDate() + 1);
    }
  }

  return targetDate;
}

const resolveItemWeight = (weight) => {
  const numeric = Number(weight);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.round(numeric * 100) / 100;
  }
  return FALLBACK_ITEM_WEIGHT_KG;
};

const roundWeight = (weight) => Math.round(Number(weight || 0) * 100) / 100;

function timingSafeSignatureEqual(expectedHex, providedHex) {
  try {
    const expected = Buffer.from(String(expectedHex || ""), "hex");
    const provided = Buffer.from(String(providedHex || ""), "hex");
    if (!expected.length || expected.length !== provided.length) return false;
    return crypto.timingSafeEqual(expected, provided);
  } catch {
    return false;
  }
}

async function fetchRazorpayPayment({ keyId, keySecret, paymentId }) {
  const response = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}`, {
    method: "GET",
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
    },
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  return { ok: response.ok, status: response.status, data };
}

async function fetchRazorpayOrderPayments({ keyId, keySecret, orderId }) {
  const response = await fetch(`https://api.razorpay.com/v1/orders/${orderId}/payments`, {
    method: "GET",
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
    },
  });

  try {
    data = await response.json();
  } catch {
    data = null;
  }

  return { ok: response.ok, status: response.status, data };
}

async function finalizePaidOrder({ order, userId, paymentId }) {
  if (!order) return order;

  const alreadyCaptured =
    String(order.paymentStatus || "").toLowerCase() === "paid" ||
    Boolean(String(order.razorpayPaymentId || "").trim());
  if (alreadyCaptured) return order;

  order.status = "PLACED";
  order.orderStatus = "PLACED";
  order.paymentStatus = "paid";
  order.razorpayPaymentId = paymentId;
  await order.save();

  const walletAmount = order.walletAmount ?? 0;
  if (walletAmount > 0) {
    const wallet = await Wallet.findOne({ user: userId });
    if (wallet) {
      const debitAmount = Math.min(wallet.balance || 0, walletAmount);
      wallet.balance = Math.max(0, wallet.balance - debitAmount);
      wallet.transactions.push({
        amount: -debitAmount,
        type: "DEBIT",
        description: "Order payment (split)",
        order: order._id,
        balanceAfter: wallet.balance,
      });
      await wallet.save();
    }
  }

  for (const item of order.items) {
    const product = item.product;
    const productId = product?._id || product;
    if (productId) {
      await Product.findByIdAndUpdate(productId, {
        $inc: { stockQuantity: -item.quantity },
      });
    }
  }

  const cart = await Cart.findOne({ user: userId });
  if (cart) {
    cart.items = [];
    await cart.save();
  }

  return order;
}

function getWebhookRawBody(req) {
  if (Buffer.isBuffer(req.body) && req.body.length) {
    return req.body;
  }

  if (Buffer.isBuffer(req.rawBody) && req.rawBody.length) {
    return req.rawBody;
  }

  if (typeof req.body === "string") {
    return Buffer.from(req.body, "utf8");
  }

  if (req.body && typeof req.body === "object") {
    return Buffer.from(JSON.stringify(req.body), "utf8");
  }

  return null;
}

/**
 * RAZORPAY WEBHOOK
 * POST /api/payment/webhook
 */
export const handleRazorpayWebhook = async (req, res) => {
  try {
    const webhookSecret = String(process.env.RAZORPAY_WEBHOOK_SECRET || "").trim();
    if (!webhookSecret) {
      return res.status(503).json({
        message: "Webhook secret not configured",
        code: "RAZORPAY_WEBHOOK_NOT_CONFIGURED",
      });
    }

    const signature = String(req.headers["x-razorpay-signature"] || "").trim();
    if (!signature) {
      return res.status(400).json({
        message: "Missing webhook signature",
        code: "MISSING_WEBHOOK_SIGNATURE",
      });
    }

    const rawBody = getWebhookRawBody(req);
    if (!rawBody) {
      return res.status(400).json({
        message: "Missing webhook payload",
        code: "MISSING_WEBHOOK_PAYLOAD",
      });
    }

    const expected = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
    if (!timingSafeSignatureEqual(expected, signature)) {
      return res.status(400).json({
        message: "Invalid webhook signature",
        code: "INVALID_WEBHOOK_SIGNATURE",
      });
    }

    let payload = null;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return res.status(400).json({
        message: "Invalid webhook JSON payload",
        code: "INVALID_WEBHOOK_JSON",
      });
    }

    const eventName = String(payload?.event || "").toLowerCase();
    const paymentEntity = payload?.payload?.payment?.entity;
    const razorpayOrderId = String(paymentEntity?.order_id || "").trim();
    const razorpayPaymentId = String(paymentEntity?.id || "").trim();

    console.info("[razorpay-webhook]", {
      event: eventName || "unknown",
      paymentId: razorpayPaymentId || null,
      orderId: razorpayOrderId || null,
    });

    if (
      eventName !== "payment.captured" &&
      eventName !== "payment.failed" &&
      eventName !== "order.paid"
    ) {
      return res.status(200).json({ received: true, processed: false, ignoredEvent: eventName });
    }

    const paymentStatus = String(paymentEntity?.status || "").toLowerCase();
    const paymentCurrency = String(paymentEntity?.currency || "").toUpperCase();
    const paymentAmountPaise = Number(paymentEntity?.amount || 0);

    if (eventName === "payment.failed") {
      return res.status(200).json({
        received: true,
        processed: true,
        event: eventName,
        paymentId: razorpayPaymentId || null,
      });
    }

    if (!razorpayOrderId || !razorpayPaymentId) {
      return res.status(400).json({
        message: "Missing payment identifiers in webhook",
        code: "INVALID_WEBHOOK_PAYLOAD",
      });
    }

    if (paymentStatus !== "captured") {
      return res.status(200).json({
        received: true,
        processed: false,
        ignoredReason: "payment_not_captured",
      });
    }

    const order = await Order.findOne({ razorpayOrderId }).populate("items.product");

    if (!order) {
      return res.status(200).json({
        received: true,
        processed: false,
        ignoredReason: "order_not_found",
      });
    }

    const alreadyCaptured =
      String(order.paymentStatus || "").toLowerCase() === "paid" ||
      Boolean(String(order.razorpayPaymentId || "").trim());

    if (alreadyCaptured) {
      if (order.razorpayPaymentId === razorpayPaymentId) {
        return res.status(200).json({ received: true, processed: true, idempotent: true });
      }

      return res.status(200).json({
        received: true,
        processed: false,
        ignoredReason: "order_already_processed",
      });
    }

    const duplicatePayment = await Order.findOne({
      _id: { $ne: order._id },
      razorpayPaymentId,
    }).select("_id");

    if (duplicatePayment) {
      return res.status(200).json({
        received: true,
        processed: false,
        ignoredReason: "duplicate_payment_reference",
      });
    }

    const expectedAmountPaise = Math.round(Number(order.razorpayAmount || 0) * 100);
    if (paymentAmountPaise !== expectedAmountPaise) {
      return res.status(400).json({
        message: "Payment amount mismatch",
        code: "PAYMENT_AMOUNT_MISMATCH",
      });
    }

    if (paymentCurrency && paymentCurrency !== "INR") {
      return res.status(400).json({
        message: "Payment currency mismatch",
        code: "PAYMENT_CURRENCY_MISMATCH",
      });
    }

    await finalizePaidOrder({
      order,
      userId: order.user,
      paymentId: razorpayPaymentId,
    });

    return res.status(200).json({
      received: true,
      processed: true,
      orderId: order._id,
      razorpayOrderId,
      razorpayPaymentId,
    });
  } catch (err) {
    console.error("[razorpay-webhook] processing error", err);
    return res.status(500).json({
      message: "Webhook processing failed",
      code: "WEBHOOK_PROCESSING_FAILED",
    });
  }
};

/**
 * CREATE PAYMENT ORDER (Checkout - Online / Wallet / Split)
 * POST /api/payment/create-order
 * Body: { shippingAddress?, notes?, walletAmount?: number }
 * walletAmount: amount to deduct from wallet (0 = Razorpay only)
 *
 * Flow:
 * - walletAmount = total → wallet only, order PLACED immediately
 * - walletAmount < total → wallet + Razorpay for remainder
 * - walletAmount = 0 → Razorpay only
 */
export const createPaymentOrder = async (req, res) => {
  try {
    let razorpay;
    try {
      razorpay = getValidatedRazorpayConfig();
    } catch (cfgErr) {
      return res.status(503).json({
        message: cfgErr.message || "Payment gateway not configured",
        code: cfgErr.code || "PAYMENT_GATEWAY_NOT_CONFIGURED",
      });
    }
    const RAZORPAY_KEY_ID = razorpay.keyId;
    const RAZORPAY_KEY_SECRET = razorpay.keySecret;

    const { shippingAddress, notes, walletAmount: reqWalletAmount = 0 } = req.body;

    if (!shippingAddress || typeof shippingAddress !== "object") {
      return res.status(400).json({
        message: "Shipping address is required",
        code: "SHIPPING_ADDRESS_REQUIRED",
      });
    }

    const normalizedShippingAddress = {
      shopName: String(shippingAddress.shopName || "").trim(),
      address: String(shippingAddress.address || "").trim(),
      phone: String(shippingAddress.phone || "").trim(),
      city: String(shippingAddress.city || "").trim(),
      state: String(shippingAddress.state || "").trim(),
      pincode: String(shippingAddress.pincode || "").trim(),
    };

    // Infer state from pincode if not provided
    if (!normalizedShippingAddress.state && normalizedShippingAddress.pincode.length >= 2) {
      const pincodePrefix = parseInt(normalizedShippingAddress.pincode.slice(0, 2), 10);
      const pincodeToState = {
        11: "Delhi", 12: "Haryana", 13: "Uttar Pradesh", 14: "Punjab", 15: "Punjab",
        16: "Chandigarh", 17: "Himachal Pradesh", 18: "Jammu and Kashmir", 19: "Punjab",
        20: "Maharashtra", 21: "Madhya Pradesh", 22: "Madhya Pradesh", 23: "Uttar Pradesh",
        24: "Uttar Pradesh", 25: "Uttar Pradesh", 26: "Uttar Pradesh", 27: "Uttar Pradesh",
        28: "Uttar Pradesh", 29: "Uttar Pradesh", 30: "Rajasthan", 31: "Rajasthan",
        32: "Rajasthan", 33: "Punjab", 34: "Rajasthan", 36: "Gujarat", 37: "Gujarat",
        38: "Gujarat", 39: "Gujarat", 40: "Maharashtra", 41: "Maharashtra", 42: "Maharashtra",
        43: "Maharashtra", 44: "Maharashtra", 45: "Madhya Pradesh", 46: "Madhya Pradesh",
        48: "Madhya Pradesh", 49: "Chhattisgarh", 50: "Telangana", 51: "Andhra Pradesh",
        52: "Andhra Pradesh", 53: "Andhra Pradesh", 56: "Karnataka", 57: "Karnataka",
        58: "Karnataka", 59: "Karnataka", 60: "Tamil Nadu", 61: "Tamil Nadu", 62: "Tamil Nadu",
        63: "Tamil Nadu", 64: "Tamil Nadu", 67: "Andhra Pradesh", 68: "Kerala",
        69: "Kerala", 70: "West Bengal", 71: "West Bengal", 72: "West Bengal",
        73: "West Bengal", 74: "West Bengal", 75: "Odisha", 76: "Odisha", 77: "Odisha",
        78: "Assam", 79: "Assam", 80: "Bihar", 81: "Bihar", 82: "Jharkhand",
        83: "Uttar Pradesh", 84: "Bihar", 85: "Jharkhand", 91: "Uttar Pradesh",
      };
      normalizedShippingAddress.state = pincodeToState[pincodePrefix] || "Uttar Pradesh";
    }

    // Default state to Uttar Pradesh if still missing
    if (!normalizedShippingAddress.state) {
      normalizedShippingAddress.state = "Uttar Pradesh";
    }

    if (
      !normalizedShippingAddress.address ||
      !normalizedShippingAddress.city ||
      !normalizedShippingAddress.pincode ||
      !normalizedShippingAddress.phone ||
      !normalizedShippingAddress.state
    ) {
      return res.status(400).json({
        message: "Address, city, pincode, phone and state are required",
        code: "INVALID_SHIPPING_ADDRESS",
      });
    }

    const cart = await Cart.findOne({ user: req.user._id }).populate("items.product");
    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ message: "Cart is empty", code: "CART_EMPTY" });
    }

    let cartAdjusted = false;
    const adjustments = [];
    const nextCartItems = [];

    for (const item of cart.items) {
      const product = item.product;
      const requestedQty = Math.max(1, Number(item.quantity || 1));

      if (!product || !product.isActive) {
        cartAdjusted = true;
        adjustments.push({
          productId: product?._id ? String(product._id) : null,
          productName: product?.productName || "Unknown product",
          previousQty: requestedQty,
          newQty: 0,
          reason: "product_not_available",
        });
        continue;
      }

      const availableStock = Number(product.stockQuantity ?? 0);

      if (availableStock <= 0) {
        cartAdjusted = true;
        adjustments.push({
          productId: String(product._id),
          productName: product.productName,
          previousQty: requestedQty,
          newQty: 0,
          reason: "out_of_stock",
        });
        continue;
      }

      if (requestedQty > availableStock) {
        cartAdjusted = true;
        adjustments.push({
          productId: String(product._id),
          productName: product.productName,
          previousQty: requestedQty,
          newQty: availableStock,
          reason: "reduced_to_available_stock",
        });
        item.quantity = availableStock;
      }

      nextCartItems.push(item);
    }

    if (cartAdjusted) {
      cart.items = nextCartItems.map((item) => ({
        product: item.product?._id || item.product,
        quantity: item.quantity,
        weight: resolveItemWeight(item.product?.weight ?? item.weight),
      }));
      await cart.save();
      await cart.populate("items.product");
    }

    if (!cart.items.length) {
      const hasUnavailableProducts = adjustments.some(
        (a) => a?.reason === "product_not_available" || a?.reason === "out_of_stock",
      );
      return res.status(200).json({
        success: false,
        requiresCartReview: true,
        message: hasUnavailableProducts
          ? "Some products are no longer available. Please review your cart."
          : "All items in cart are out of stock",
        code: "CART_EMPTY_AFTER_SYNC",
        adjustments,
      });
    }

    let totalAmount = 0;
    let totalGstAmount = 0;
    const orderItems = [];

    for (const item of cart.items) {
      const product = item.product;

      const pricing = calculateLinePricing(
        {
          sellingPrice: product.sellingPrice,
          discountPercent: product.discountPercent,
          gstPercent: product.gstPercent,
          gstMode: product.gstMode,
        },
        item.quantity,
      );

      totalAmount += pricing.lineSubtotal;
      totalGstAmount += pricing.lineGstAmount;

      const itemWeight = resolveItemWeight(product.weight ?? item.weight);
      if (!(Number(product.weight) > 0)) {
        console.warn("Missing product weight, using fallback", {
          productId: String(product._id),
          fallbackWeightKg: FALLBACK_ITEM_WEIGHT_KG,
        });
      }

      orderItems.push({
        product: product._id,
        productName: product.productName,
        quantity: item.quantity,
        price: pricing.finalSellingPrice,
        mrp: product.mrp,
        discountPercent: pricing.discountPercent,
        gstPercent: pricing.gstPercent,
        gstMode: pricing.gstMode,
        gstAmount: pricing.lineGstAmount,
        lineSubtotal: pricing.lineSubtotal,
        lineTotal: pricing.lineTotal,
        weight: itemWeight,
      });
    }

    const totalWeightRaw = orderItems.reduce((total, item) => {
      const itemWeight = resolveItemWeight(item.weight);
      return total + itemWeight * Number(item.quantity || 1);
    }, 0);
    const totalWeight = Math.max(0.01, roundWeight(totalWeightRaw));

    const payableAmountRupee = Math.round((totalAmount + totalGstAmount) * 100) / 100;

    const minCheckoutDoc = await Config.findOne({ key: MIN_CHECKOUT_AMOUNT_KEY });
    const minCheckoutAmount = Math.round(
      Math.max(0, Number(minCheckoutDoc?.value) || 0) * 100
    ) / 100;

    if (minCheckoutAmount > 0 && payableAmountRupee < minCheckoutAmount) {
      return res.status(400).json({
        message: `Minimum checkout amount is ₹${minCheckoutAmount.toFixed(2)}. Please add more items to continue.`,
        code: "MIN_CHECKOUT_NOT_MET",
        minimumCheckoutAmount: minCheckoutAmount,
        currentCheckoutAmount: payableAmountRupee,
        shortBy: Math.round((minCheckoutAmount - payableAmountRupee) * 100) / 100,
      });
    }

    if (payableAmountRupee <= 0) {
      return res.status(400).json({
        message: "Unable to create order for zero amount",
        code: "INVALID_ORDER_AMOUNT",
      });
    }

    const parsedWalletAmount = Number(reqWalletAmount);
    let walletAmount = Number.isFinite(parsedWalletAmount)
      ? Math.round(parsedWalletAmount * 100) / 100
      : 0;
    if (walletAmount < 0) walletAmount = 0;
    if (walletAmount > payableAmountRupee) walletAmount = payableAmountRupee;

    let wallet = null;
    if (walletAmount > 0) {
      wallet = await Wallet.findOne({ user: req.user._id });
      if (!wallet) wallet = await Wallet.create({ user: req.user._id, balance: 0 });
      if (wallet.balance < walletAmount) {
        walletAmount = Math.round((wallet.balance || 0) * 100) / 100;
      }
    }

    const razorpayAmountRupee = Math.round((payableAmountRupee - walletAmount) * 100) / 100;
    const razorpayAmountPaise = Math.round(razorpayAmountRupee * 100);

    const user = await User.findById(req.user._id);

    // Reuse a very recent unpaid Razorpay order to avoid duplicate order creation
    // when users tap "Place Order" repeatedly.
    if (razorpayAmountRupee > 0) {
      const recentThreshold = new Date(Date.now() - 15 * 60 * 1000);
      const recentPendingOrder = await Order.findOne({
        user: req.user._id,
        status: "PLACED",
        paymentStatus: "unpaid",
        paymentMethod: "ONLINE",
        createdAt: { $gte: recentThreshold },
        razorpayAmount: razorpayAmountRupee,
        walletAmount,
        razorpayOrderId: { $exists: true, $ne: null },
        $or: [{ razorpayPaymentId: { $exists: false } }, { razorpayPaymentId: null }, { razorpayPaymentId: "" }],
      }).sort({ createdAt: -1 });

      if (recentPendingOrder) {
        return res.status(200).json({
          message: "Resume unpaid payment",
          orderId: recentPendingOrder._id,
          razorpayOrderId: recentPendingOrder.razorpayOrderId,
          amount: recentPendingOrder.razorpayAmount,
          walletUsed: recentPendingOrder.walletAmount || 0,
          cartAdjusted,
          adjustments,
          currency: "INR",
          keyId: RAZORPAY_KEY_ID || null,
          reusedPendingOrder: true,
        });
      }
    }

    const order = await Order.create({
      user: req.user._id,
      createdBy: user?.createdBy || null,
      items: orderItems,
      cartItems: orderItems.map((item) => ({
        product: item.product,
        quantity: item.quantity,
        weight: item.weight,
      })),
      totalAmount,
      totalGstAmount,
      payableAmount: payableAmountRupee,
      totalWeight,
      walletAmount,
      razorpayAmount: razorpayAmountRupee,
      status: "PLACED",
      orderStatus: "PLACED",
      paymentStatus: walletAmount >= payableAmountRupee ? "paid" : "unpaid",
      paymentMethod: "ONLINE",
      shippingAddress: normalizedShippingAddress,
      notes,
    });

    // Wallet-only: deduct wallet, reduce stock, clear cart
    if (walletAmount >= payableAmountRupee) {
      const bal = wallet.balance - walletAmount;
      wallet.balance = Math.max(0, bal);
      wallet.transactions.push({
        amount: -walletAmount,
        type: "DEBIT",
        description: "Order payment",
        order: order._id,
        balanceAfter: wallet.balance,
      });
      await wallet.save();

      for (const item of cart.items) {
        const product = item.product;
        if (product?._id) {
          await Product.findByIdAndUpdate(product._id, {
            $inc: { stockQuantity: -item.quantity },
          });
        }
      }
      cart.items = [];
      await cart.save();

      return res.status(201).json({
        message: "Order placed successfully (Wallet)",
        orderId: order._id,
        paidByWallet: true,
        walletUsed: walletAmount,
        cartAdjusted,
        adjustments,
      });
    }

    if (razorpayAmountPaise <= 0) {
      return res.status(201).json({
        message: "Order created",
        orderId: order._id,
        amount: 0,
        walletUsed: walletAmount,
        paidByWallet: false,
        cartAdjusted,
        adjustments,
        currency: "INR",
        keyId: RAZORPAY_KEY_ID,
      });
    }

    if (razorpayAmountPaise < 100) {
      await Order.findByIdAndDelete(order._id);
      return res.status(400).json({
        message: "Minimum online payable amount is ₹1.00",
        code: "RAZORPAY_MIN_AMOUNT_NOT_MET",
        minAmountRupee: 1,
        requestedAmountPaise: razorpayAmountPaise,
      });
    }

    // Create Razorpay order using SDK
    let razorpayOrder;
    try {
      const razorpayClient = new Razorpay({
        key_id: RAZORPAY_KEY_ID,
        key_secret: RAZORPAY_KEY_SECRET,
      });

      razorpayOrder = await razorpayClient.orders.create({
        amount: razorpayAmountPaise,
        currency: "INR",
        receipt: order._id.toString(),
        notes: {
          orderId: order._id.toString(),
          userId: String(req.user._id),
          totalAmount: payableAmountRupee,
          walletAmount,
        },
      });
    } catch (sdkErr) {
      await Order.findByIdAndDelete(order._id);
      const gatewayDescription = sdkErr?.error?.description || sdkErr?.description;
      const errorMsg = gatewayDescription || sdkErr?.message || "Failed to create Razorpay order";

      const isMinAmount = /minimum amount allowed/i.test(errorMsg);
      const isRateLimited = /too many requests|rate limit/i.test(errorMsg);
      return res.status(isMinAmount ? 400 : isRateLimited ? 429 : 502).json({
        message: errorMsg,
        code: isMinAmount
          ? "RAZORPAY_MIN_AMOUNT_NOT_MET"
          : isRateLimited
            ? "RAZORPAY_RATE_LIMIT"
            : "RAZORPAY_CREATE_ORDER_FAILED",
        retryable: isRateLimited,
      });
    }

    if (!razorpayOrder?.id) {
      await Order.findByIdAndDelete(order._id);
      return res.status(502).json({
        message: "Razorpay order creation returned invalid response",
        code: "RAZORPAY_INVALID_RESPONSE",
      });
    }

    order.razorpayOrderId = razorpayOrder.id;
    await order.save();

    res.status(201).json({
      message: "Order created. Complete payment to confirm.",
      orderId: order._id,
      razorpayOrderId: razorpayOrder.id,
      amount: razorpayAmountRupee,
      walletUsed: walletAmount,
      cartAdjusted,
      adjustments,
      currency: "INR",
      keyId: RAZORPAY_KEY_ID || null,
    });
  } catch (err) {
    res.status(500).json({ message: "Server error", code: "CREATE_ORDER_FAILED" });
  }
};

/**
 * VERIFY PAYMENT
 * POST /api/payment/verify-payment
 * Body: { razorpayOrderId, razorpayPaymentId, razorpaySignature }
 * On success: deducts wallet (if any), updates order to PLACED, reduces stock, clears cart
 */
export const verifyPayment = async (req, res) => {
  try {
    let razorpay;
    try {
      razorpay = getValidatedRazorpayConfig();
    } catch (cfgErr) {
      return res.status(503).json({
        message: cfgErr.message || "Payment gateway not configured",
        code: cfgErr.code || "PAYMENT_GATEWAY_NOT_CONFIGURED",
      });
    }
    const RAZORPAY_KEY_ID = razorpay.keyId;
    const RAZORPAY_KEY_SECRET = razorpay.keySecret;

    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return res.status(400).json({
        message: "Missing payment details",
        code: "MISSING_PAYMENT_DETAILS",
      });
    }

    const order = await Order.findOne({
      razorpayOrderId,
      user: req.user._id,
    }).populate("items.product");

    if (!order) {
      return res.status(404).json({
        message: "Order not found or already processed",
        code: "ORDER_NOT_FOUND",
      });
    }

    const alreadyCaptured =
      String(order.paymentStatus || "").toLowerCase() === "paid" ||
      Boolean(String(order.razorpayPaymentId || "").trim());

    if (alreadyCaptured) {
      if (order.razorpayPaymentId && order.razorpayPaymentId === razorpayPaymentId) {
        return res.status(200).json({
          message: "Payment already verified",
          code: "PAYMENT_ALREADY_VERIFIED",
          order,
        });
      }

      return res.status(409).json({
        message: "Order is already processed with a different payment reference",
        code: "ORDER_ALREADY_PROCESSED",
      });
    }

    const duplicatePayment = await Order.findOne({
      _id: { $ne: order._id },
      razorpayPaymentId,
    }).select("_id");

    if (duplicatePayment) {
      return res.status(409).json({
        message: "Payment reference already used",
        code: "DUPLICATE_PAYMENT_REFERENCE",
      });
    }

    const body = razorpayOrderId + "|" + razorpayPaymentId;
    const expected = crypto
      .createHmac("sha256", RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");
    const verified = timingSafeSignatureEqual(expected, razorpaySignature);

    if (!verified) {
      return res.status(400).json({
        message: "Payment verification failed",
        code: "PAYMENT_VERIFICATION_FAILED",
      });
    }

    const gatewayPayment = await fetchRazorpayPayment({
      keyId: RAZORPAY_KEY_ID,
      keySecret: RAZORPAY_KEY_SECRET,
      paymentId: razorpayPaymentId,
    });

    if (!gatewayPayment.ok || !gatewayPayment.data?.id) {
      return res.status(502).json({
        message: "Unable to validate payment with Razorpay",
        code: "RAZORPAY_VERIFY_FETCH_FAILED",
      });
    }

    const paymentData = gatewayPayment.data;
    const expectedAmountPaise = Math.round(Number(order.razorpayAmount || 0) * 100);
    const paymentAmountPaise = Number(paymentData.amount || 0);
    const paymentStatus = String(paymentData.status || "").toLowerCase();

    if (paymentData.order_id !== razorpayOrderId) {
      return res.status(400).json({
        message: "Payment order mismatch",
        code: "PAYMENT_ORDER_MISMATCH",
      });
    }

    if (String(paymentData.currency || "") !== "INR") {
      return res.status(400).json({
        message: "Invalid payment currency",
        code: "PAYMENT_CURRENCY_MISMATCH",
      });
    }

    if (paymentAmountPaise !== expectedAmountPaise) {
      return res.status(400).json({
        message: "Payment amount mismatch",
        code: "PAYMENT_AMOUNT_MISMATCH",
      });
    }

    if (paymentStatus !== "captured") {
      return res.status(409).json({
        message: "Payment is not captured yet",
        code: "PAYMENT_NOT_CAPTURED_YET",
      });
    }

    await finalizePaidOrder({
      order,
      userId: req.user._id,
      paymentId: razorpayPaymentId,
    });

    res.json({
      message: "Payment verified. Order confirmed.",
      order,
    });
  } catch (err) {
    res.status(500).json({ message: "Server error", code: "VERIFY_PAYMENT_FAILED" });
  }
};

/**
 * GET PAYMENT STATUS
 * GET /api/payment/status/:razorpayOrderId
 * Returns: { status: "paid" | "pending", orderStatus }
 */
export const getPaymentStatus = async (req, res) => {
  try {
    let razorpay;
    try {
      razorpay = getValidatedRazorpayConfig();
    } catch (cfgErr) {
      return res.status(503).json({
        message: cfgErr.message || "Payment gateway not configured",
        code: cfgErr.code || "PAYMENT_GATEWAY_NOT_CONFIGURED",
      });
    }

    const RAZORPAY_KEY_ID = razorpay.keyId;
    const RAZORPAY_KEY_SECRET = razorpay.keySecret;
    const { razorpayOrderId } = req.params;

    if (!razorpayOrderId) {
      return res.status(400).json({
        message: "razorpayOrderId is required",
        code: "MISSING_ORDER_ID",
      });
    }

    const order = await Order.findOne({
      razorpayOrderId,
      user: req.user._id,
    }).populate("items.product");

    if (!order) {
      return res.status(404).json({
        message: "Order not found",
        code: "ORDER_NOT_FOUND",
      });
    }

    if (order.razorpayPaymentId) {
      return res.json({
        status: "paid",
        orderStatus: order.status,
        paymentId: String(order.razorpayPaymentId),
      });
    }

    const gateway = await fetchRazorpayOrderPayments({
      keyId: RAZORPAY_KEY_ID,
      keySecret: RAZORPAY_KEY_SECRET,
      orderId: razorpayOrderId,
    });

    if (!gateway.ok) {
      return res.status(502).json({
        status: "unknown",
        message: "Unable to fetch payment status from Razorpay",
        code: "RAZORPAY_STATUS_FETCH_FAILED",
      });
    }

    const payments = Array.isArray(gateway?.data?.items) ? gateway.data.items : [];
    const paidPayment = payments.find((p) => {
      const s = String(p?.status || "").toLowerCase();
      return s === "captured";
    });

    if (paidPayment?.id) {
      try {
        await finalizePaidOrder({
          order,
          userId: req.user._id,
          paymentId: String(paidPayment.id),
        });
      } catch (finalizeErr) {
        return res.status(500).json({
          status: "unknown",
          message: "Payment captured but finalization failed",
          code: "ORDER_FINALIZATION_FAILED",
        });
      }
      return res.json({
        status: "paid",
        orderStatus: "PLACED",
        paymentId: String(paidPayment.id),
      });
    }

    return res.json({ status: "pending", orderStatus: order.status });
  } catch (err) {
    return res.status(500).json({
      message: "Server error",
      code: "GET_PAYMENT_STATUS_FAILED",
    });
  }
};

const getShipmentIdFromShiprocketResponse = (srRes) => {
  const candidates = [
    srRes?.shipment_id,
    srRes?.shipmentId,
    srRes?.data?.shipment_id,
    srRes?.data?.shipmentId,
    srRes?.response?.shipment_id,
    srRes?.response?.shipmentId,
    srRes?.shipments?.[0]?.id,
    srRes?.shipments?.[0]?.shipment_id,
    srRes?.data?.shipments?.[0]?.id,
    srRes?.data?.shipments?.[0]?.shipment_id,
    srRes?.response?.data?.shipments?.[0]?.id,
    srRes?.response?.data?.shipments?.[0]?.shipment_id,
  ];

  for (const value of candidates) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      const first = value.find((item) => item != null && String(item).trim());
      if (first != null) return String(first).trim();
      continue;
    }
    const text = String(value).trim();
    if (text) return text;
  }

  return null;
};

const getShiprocketOrderIdFromResponse = (srRes) => {
  const candidates = [
    srRes?.order_id,
    srRes?.orderId,
    srRes?.data?.order_id,
    srRes?.data?.orderId,
    srRes?.response?.order_id,
    srRes?.response?.orderId,
    srRes?.shipments?.[0]?.order_id,
    srRes?.shipments?.[0]?.orderId,
    srRes?.data?.shipments?.[0]?.order_id,
    srRes?.data?.shipments?.[0]?.orderId,
    srRes?.response?.data?.order_id,
    srRes?.response?.data?.orderId,
    srRes?.response?.data?.shipments?.[0]?.order_id,
    srRes?.response?.data?.shipments?.[0]?.orderId,
  ];

  for (const value of candidates) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }

  return null;
};

const explainShiprocketShipmentIssue = (srRes) => {
  const message =
    srRes?.message ||
    srRes?.error ||
    srRes?.data?.message ||
    srRes?.response?.message ||
    srRes?.response?.data?.message ||
    srRes?.errors?.[0]?.message ||
    srRes?.data?.errors?.[0]?.message;

  const cleanMessage = String(message || "").trim();
  if (!cleanMessage) {
    return "Shiprocket did not return shipment_id. Check pickup location, shipping address, pincode, and credentials.";
  }

  return `Shiprocket did not return shipment_id: ${cleanMessage}`;
};

const readAwbFromKnownKeys = (payload) => {
  const isValidAwb = (value) => {
    const text = String(value || "").trim();
    if (!text) return false;
    if (text.length < 6 || text.length > 80) return false;
    if (/\s/.test(text)) return false;
    if (/https?:\/\//i.test(text)) return false;
    if (!/[0-9]/.test(text)) return false;
    if (!/^[A-Za-z0-9_-]+$/.test(text)) return false;
    return true;
  };

  const direct = [
    payload?.awb_code,
    payload?.awb,
    payload?.awbCode,
    payload?.awb_number,
    payload?.data?.awb_code,
    payload?.data?.awb,
    payload?.data?.awbCode,
    payload?.data?.awb_number,
    payload?.data?.awb_assignments?.[0]?.awb_code,
    payload?.data?.awb_assignement_details?.[0]?.awb,
    payload?.response?.awb_code,
    payload?.response?.awb,
    payload?.response?.awbCode,
    payload?.response?.awb_number,
    payload?.response?.data?.awb_code,
    payload?.response?.data?.awb,
    payload?.response?.data?.awbCode,
    payload?.response?.data?.awb_number,
    payload?.response?.data?.awb_assignments?.[0]?.awb_code,
    payload?.response?.data?.awb_assignement_details?.[0]?.awb,
  ].find((v) => (typeof v === "string" || typeof v === "number") && isValidAwb(v));
  if (direct != null && String(direct).trim()) return String(direct).trim();

  const scan = (node) => {
    if (!node || typeof node !== "object") return null;
    for (const [key, value] of Object.entries(node)) {
      if (
        key.toLowerCase().includes("awb") &&
        (typeof value === "string" || typeof value === "number") &&
        isValidAwb(value)
      ) {
        const text = String(value).trim();
        if (text) return text;
      }
      if (value && typeof value === "object") {
        const nested = scan(value);
        if (nested) return nested;
      }
    }
    return null;
  };

  return scan(payload);
};

const ensureShiprocketShipment = async (order) => {
  if (order.shiprocketShipmentId) {
    return String(order.shiprocketShipmentId).split(",")[0].trim();
  }

  const orderWithUser = await Order.findById(order._id).populate("user", "name email phone");
  const forShiprocket = mapOrderToShiprocketPayload(orderWithUser);
  const srRes = await createShiprocketOrder(forShiprocket);
  const shipmentId = getShipmentIdFromShiprocketResponse(srRes);
  const shiprocketOrderId = getShiprocketOrderIdFromResponse(srRes);

  if (!shipmentId) {
    return null;
  }

  order.shiprocketShipmentId = String(shipmentId);
  if (shiprocketOrderId && shiprocketOrderId !== String(order.orderId || order._id || "")) {
    order.shiprocketOrderId = String(shiprocketOrderId);
  }
  await order.save();
  return String(shipmentId);
};

const extractShiprocketErrorMessage = (payload) => {
  const toText = (value) => {
    if (value == null) return "";
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
    return "";
  };

  const explicitCandidates = [
    payload?.message,
    payload?.error,
    payload?.detail,
    payload?.reason,
    payload?.data?.message,
    payload?.data?.error,
    payload?.data?.detail,
    payload?.data?.reason,
    payload?.response?.message,
    payload?.response?.error,
    payload?.response?.detail,
    payload?.response?.reason,
    payload?.response?.data?.message,
    payload?.response?.data?.error,
    payload?.response?.data?.detail,
    payload?.response?.data?.reason,
    payload?.errors?.[0]?.message,
    payload?.errors?.[0],
    payload?.data?.errors?.[0]?.message,
    payload?.data?.errors?.[0],
    payload?.response?.data?.errors?.[0]?.message,
    payload?.response?.data?.errors?.[0],
  ];

  for (const candidate of explicitCandidates) {
    const text = toText(candidate);
    if (text) return text;
  }

  const visited = new Set();
  const deepScan = (node) => {
    if (!node || typeof node !== "object") return "";
    if (visited.has(node)) return "";
    visited.add(node);

    const preferredKeys = ["message", "error", "detail", "reason", "remarks", "description"];
    for (const key of preferredKeys) {
      const text = toText(node[key]);
      if (text) return text;
    }

    for (const value of Object.values(node)) {
      const direct = toText(value);
      if (direct && /error|invalid|missing|failed|forbidden|unauthorized|kyc|wallet|balance/i.test(direct)) {
        return direct;
      }

      if (value && typeof value === "object") {
        const nested = deepScan(value);
        if (nested) return nested;
      }
    }

    return "";
  };

  const deepMessage = deepScan(payload);
  if (deepMessage) return deepMessage;

  return "Shiprocket did not return a detailed error. Please verify pickup location, shipping address, wallet balance, and KYC status.";
};

const mapFriendlyAwbErrorMessage = (rawMessage) => {
  const text = String(rawMessage || "").trim();
  const lower = text.toLowerCase();

  if (!text) return "Failed to generate AWB from Shiprocket.";

  if (/insufficient balance|minimum required balance|recharge|wallet/.test(lower)) {
    return "Please recharge your ShipRocket wallet. The minimum required balance is Rs 100.";
  }

  if (/kyc|verification|complete your kyc/.test(lower)) {
    return "Complete KYC on Shiprocket to generate AWB. Log in to Shiprocket dashboard and retry.";
  }

  if (/missing state/.test(lower)) {
    return "Shiprocket address validation failed: state is missing in shipping address.";
  }

  if (/access forbidden|unauthorized|permission|blocked/.test(lower)) {
    return "Shiprocket account does not have permission to assign AWB right now.";
  }

  if (/validation failed|missing city|missing pincode|missing address|invalid pincode/.test(lower)) {
    return `Shiprocket address validation failed: ${text}`;
  }

  if (/shipment creation failed/.test(lower)) {
    return "Shiprocket could not create shipment. Please check pickup location, shipping address, wallet balance, and KYC status.";
  }

  return `Shiprocket AWB error: ${text}`;
};

const isShiprocketAccessError = (payload) => {
  const status = Number(payload?.status || payload?.response?.status || 0);
  const message = String(
    payload?.message || payload?.response?.message || payload?.response?.error || ""
  ).toLowerCase();

  if (status === 401 || status === 403) return true;
  return (
    message.includes("access forbidden") ||
    message.includes("unauthorized") ||
    message.includes("permission") ||
    message.includes("blocked")
  );
};

const validateShiprocketPayload = (orderDoc) => {
  const addr = orderDoc?.shippingAddress || {};
  const issues = [];
  if (!String(addr.address || "").trim()) issues.push("address");
  if (!String(addr.city || "").trim()) issues.push("city");
  if (!String(addr.state || "").trim()) issues.push("state");
  if (!String(addr.pincode || "").trim()) issues.push("pincode");
  if (!String(addr.phone || "").trim()) issues.push("phone");
  return issues;
};

const roundCurrency = (value) => Math.round(Number(value || 0) * 100) / 100;

const createRazorpayRefund = async ({ paymentId, amountRupee, orderId }) => {
  const razorpay = getValidatedRazorpayConfig();
  const razorpayClient = new Razorpay({
    key_id: razorpay.keyId,
    key_secret: razorpay.keySecret,
  });

  const amountPaise = Math.round(Number(amountRupee || 0) * 100);
  if (!paymentId || amountPaise <= 0) {
    const err = new Error("Invalid payment reference or refund amount");
    err.code = "INVALID_REFUND_INPUT";
    throw err;
  }

  try {
    return await razorpayClient.payments.refund(paymentId, {
      amount: amountPaise,
      speed: "normal",
      notes: {
        orderId: String(orderId || ""),
        source: "admin-cancel",
      },
    });
  } catch (err) {
    const gatewayMessage =
      err?.error?.description ||
      err?.error?.reason ||
      err?.error?.message ||
      err?.message ||
      "Razorpay refund failed";
    const e = new Error(gatewayMessage);
    e.code = "RAZORPAY_REFUND_FAILED";
    e.gateway = err?.error || null;
    throw e;
  }
};

const creditWalletRefund = async ({ order, amount, description }) => {
  const roundedAmount = roundCurrency(amount);
  if (roundedAmount <= 0) return { amount: 0, balance: null };

  let wallet = await Wallet.findOne({ user: order.user });
  if (!wallet) {
    wallet = await Wallet.create({ user: order.user, balance: 0 });
  }

  wallet.balance = roundCurrency(Number(wallet.balance || 0) + roundedAmount);
  wallet.transactions.push({
    amount: roundedAmount,
    type: "CREDIT",
    description,
    order: order._id,
    balanceAfter: wallet.balance,
  });
  await wallet.save();

  return { amount: roundedAmount, balance: wallet.balance };
};

const resolveRazorpayPaymentForRefund = async (order) => {
  const fallback = { paymentId: null, amountRupee: 0 };
  const razorpayOrderId = String(order?.razorpayOrderId || "").trim();
  if (!razorpayOrderId) return fallback;

  try {
    const razorpay = getValidatedRazorpayConfig();
    const gateway = await fetchRazorpayOrderPayments({
      keyId: razorpay.keyId,
      keySecret: razorpay.keySecret,
      orderId: razorpayOrderId,
    });

    if (!gateway.ok) return fallback;
    const payments = Array.isArray(gateway?.data?.items) ? gateway.data.items : [];
    const captured = payments.find((p) => String(p?.status || "").toLowerCase() === "captured");
    if (!captured?.id) return fallback;

    return {
      paymentId: String(captured.id),
      amountRupee: roundCurrency(Number(captured.amount || 0) / 100),
    };
  } catch {
    return fallback;
  }
};

/**
 * MANUAL SHIPROCKET RECOVERY (Admin)
 * POST /api/payment/orders/:orderId/shiprocket/generate-awb
 * Optional body: { force: true } to regenerate even when AWB exists
 */
export const generateOrderAwb = async (req, res) => {
  try {
    const { orderId } = req.params;
    const force = Boolean(req.body?.force);

    if (!orderId) {
      return res.status(400).json({ message: "orderId is required" });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const normalizedStatus = String(order.status || "").toUpperCase() === "PENDING"
      ? "PLACED"
      : String(order.status || "").toUpperCase();
    if (!["DISPATCHED", "DELIVERED"].includes(normalizedStatus)) {
      return res.status(409).json({
        message: "AWB can only be generated after order is dispatched",
        code: "INVALID_AWB_SEQUENCE",
      });
    }

      // Ensure state is populated even for old orders (fixes legacy orders without state)
      if (!order.shippingAddress) {
        order.shippingAddress = {};
      }
    
      if (!String(order.shippingAddress.state || "").trim()) {
        const pincodeToState = {
          11: "Delhi", 12: "Haryana", 13: "Uttar Pradesh", 14: "Punjab", 15: "Punjab",
          16: "Chandigarh", 17: "Himachal Pradesh", 18: "Jammu and Kashmir", 19: "Punjab",
          20: "Maharashtra", 21: "Madhya Pradesh", 22: "Madhya Pradesh", 23: "Uttar Pradesh",
          24: "Uttar Pradesh", 25: "Uttar Pradesh", 26: "Uttar Pradesh", 27: "Uttar Pradesh",
          28: "Uttar Pradesh", 29: "Uttar Pradesh", 30: "Rajasthan", 31: "Rajasthan",
          32: "Rajasthan", 33: "Punjab", 34: "Rajasthan", 36: "Gujarat", 37: "Gujarat",
          38: "Gujarat", 39: "Gujarat", 40: "Maharashtra", 41: "Maharashtra", 42: "Maharashtra",
          43: "Maharashtra", 44: "Maharashtra", 45: "Madhya Pradesh", 46: "Madhya Pradesh",
          48: "Madhya Pradesh", 49: "Chhattisgarh", 50: "Telangana", 51: "Andhra Pradesh",
          52: "Andhra Pradesh", 53: "Andhra Pradesh", 56: "Karnataka", 57: "Karnataka",
          58: "Karnataka", 59: "Karnataka", 60: "Tamil Nadu", 61: "Tamil Nadu", 62: "Tamil Nadu",
          63: "Tamil Nadu", 64: "Tamil Nadu", 67: "Andhra Pradesh", 68: "Kerala",
          69: "Kerala", 70: "West Bengal", 71: "West Bengal", 72: "West Bengal",
          73: "West Bengal", 74: "West Bengal", 75: "Odisha", 76: "Odisha", 77: "Odisha",
          78: "Assam", 79: "Assam", 80: "Bihar", 81: "Bihar", 82: "Jharkhand",
          83: "Uttar Pradesh", 84: "Bihar", 85: "Jharkhand", 91: "Uttar Pradesh",
        };
      
        const pincode = String(order.shippingAddress.pincode || "").trim();
        if (pincode.length >= 2) {
          const prefix = parseInt(pincode.slice(0, 2), 10);
          order.shippingAddress.state = pincodeToState[prefix] || "Uttar Pradesh";
        } else {
          order.shippingAddress.state = "Uttar Pradesh";
        }
      
        // Save the populated state for future use
        await order.save();
      }


          const payloadIssues = validateShiprocketPayload(order);
          if (payloadIssues.length > 0) {
            return res.status(400).json({
              message: `Shiprocket validation failed: missing ${payloadIssues.join(", ")}.`,
              shiprocketError: {
                stage: "validation",
                issues: payloadIssues,
              },
            });
          }
    if (order.shiprocketAwb && !force) {
      return res.json({
        message: "AWB already exists for this order",
        order,
        shiprocket: {
          shipmentId: order.shiprocketShipmentId || null,
          awb: order.shiprocketAwb || null,
          labelUrl: order.shiprocketLabelUrl || null,
          trackingUrl: order.trackingUrl || null,
        },
      });
    }

    let shipmentId;
    try {
      shipmentId = await ensureShiprocketShipment(order);
      if (!shipmentId) {
        return res.status(400).json({
          message: explainShiprocketShipmentIssue(null),
        });
      }
    } catch (srErr) {
      const payload = srErr.shiprocket || srErr.response?.data || { message: srErr.message };
      return res.status(400).json({
        message: extractShiprocketErrorMessage(payload),
        shiprocketError: payload,
      });
    }

    let awbRes;
    try {
      awbRes = await generateAWB(shipmentId);
    } catch (awbErr) {
      const payload = awbErr.shiprocket || awbErr.response?.data || { message: awbErr.message };
      const detail = extractShiprocketErrorMessage(payload);
      return res.status(400).json({
        message: mapFriendlyAwbErrorMessage(detail),
        awbMessage: mapFriendlyAwbErrorMessage(detail),
        shiprocketError: payload,
      });
    }

    const awbCode = readAwbFromKnownKeys(awbRes);
    if (!awbCode) {
      const detail = extractShiprocketErrorMessage(awbRes);
      return res.status(400).json({
        message: mapFriendlyAwbErrorMessage(detail),
        awbMessage: mapFriendlyAwbErrorMessage(detail),
        shiprocketResponse: awbRes,
      });
    }

    order.shiprocketAwb = String(awbCode);
    order.trackingUrl =
      awbRes?.tracking_url ??
      awbRes?.tracking ??
      awbRes?.data?.tracking_url ??
      awbRes?.response?.tracking_url ??
      awbRes?.response?.data?.tracking_url ??
      awbRes?.tracking_url_short ??
      `https://shiprocket.co/tracking/${encodeURIComponent(awbCode)}`;

    const warnings = [];
    try {
      const labelRes = await generateLabel(shipmentId);
      if (labelRes?.label_url) {
        order.shiprocketLabelUrl = labelRes.label_url;
      }
    } catch (labelErr) {
      warnings.push({ stage: "label", message: labelErr.message });
    }

    try {
      await generateManifest(shipmentId);
    } catch (manifestErr) {
      warnings.push({ stage: "manifest", message: manifestErr.message });
    }

    try {
      await schedulePickup(shipmentId);
    } catch (pickupErr) {
      warnings.push({ stage: "pickup", message: pickupErr.message });
    }

    await order.save();

    return res.json({
      message: "AWB generated successfully",
      order,
      shiprocket: {
        shipmentId: order.shiprocketShipmentId || null,
        awb: order.shiprocketAwb || null,
        labelUrl: order.shiprocketLabelUrl || null,
        trackingUrl: order.trackingUrl || null,
      },
      warnings,
    });
  } catch (err) {
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * UPDATE ORDER STATUS (Admin)
 * PUT /api/payment/update-status
 * Body: { orderId, status } or { orderId, [field]: value }
 * Used by admin dashboard to update order status
 */
const inferPaidAmount = (order) => {
  const payableAmount = roundCurrency(order.payableAmount || order.totalAmount || 0);
  const walletUsed = roundCurrency(order.walletAmount || 0);
  const onlinePaid = Boolean(String(order.razorpayPaymentId || "").trim());
  if (onlinePaid) return payableAmount;
  if (walletUsed > 0) return walletUsed;
  return 0;
};

const attemptShiprocketCancellation = async (order) => {
  const normalizedShipmentId = String(order.shiprocketShipmentId || "").split(",")[0].trim();
  const normalizedOrderId = String(order.shiprocketOrderId || "").trim();
  if (!normalizedShipmentId && !normalizedOrderId) {
    console.info("[shiprocket-cancel] skipped - no Shiprocket reference", {
      orderId: String(order._id || ""),
    });
    return {
      ok: true,
      noAction: true,
      message: "No Shiprocket reference found. Cancellation skipped on Shiprocket.",
      stage: "none",
    };
  }

  const isAlreadyShippedError = (statusCode, message) => {
    const text = String(message || "").toLowerCase();
    return (
      statusCode === 409 ||
      statusCode === 422 ||
      text.includes("already shipped") ||
      text.includes("in transit") ||
      text.includes("out for delivery") ||
      text.includes("delivered")
    );
  };

  const isNoRecordError = (statusCode, message) => {
    const text = String(message || "").toLowerCase();
    return statusCode === 404 || text.includes("not found") || text.includes("does not exist") || text.includes("already cancel");
  };

  const tryShipmentCancel = async () => {
    if (!normalizedShipmentId) return null;
    return cancelShipment(Number(normalizedShipmentId) || normalizedShipmentId);
  };

  const tryOrderCancel = async () => {
    if (!normalizedOrderId) return null;
    return cancelOrder(normalizedOrderId);
  };

  const extractMessage = (response) =>
    response?.message || response?.status || response?.response?.message || response?.response?.status || "";

  const logSuccess = (stage, message) => {
    console.info("[shiprocket-cancel] success", {
      stage,
      orderId: String(order._id || ""),
      shipmentId: normalizedShipmentId || null,
      shiprocketOrderId: normalizedOrderId || null,
      message,
    });
  };

  const logFailure = (stage, message, payload = null) => {
    console.error("[shiprocket-cancel] failure", {
      stage,
      orderId: String(order._id || ""),
      shipmentId: normalizedShipmentId || null,
      shiprocketOrderId: normalizedOrderId || null,
      message,
      payload,
    });
  };

  order.shiprocketCancelAttempts = Number(order.shiprocketCancelAttempts || 0) + 1;
  order.shiprocketCancelLastTriedAt = new Date();

  try {
    if (normalizedShipmentId) {
      try {
        const shiprocketRes = await tryShipmentCancel();
        const srMessage = extractMessage(shiprocketRes) || "Shipment cancelled on Shiprocket";
        order.shiprocketCancelStatus = "success";
        order.shiprocketCancelError = null;
        logSuccess("cancel_shipment", srMessage);
        return { ok: true, message: `Shipment cancelled on Shiprocket (${srMessage}).`, stage: "cancel_shipment" };
      } catch (shipmentErr) {
        const shipmentPayload = shipmentErr.shiprocket || shipmentErr.response?.data || { message: shipmentErr.message };
        const shipmentStatusCode = Number(
          shipmentPayload?.status || shipmentPayload?.response?.status || shipmentErr?.response?.status || 0
        );
        const shipmentMessage = extractShiprocketErrorMessage(shipmentPayload);

        if (isAlreadyShippedError(shipmentStatusCode, shipmentMessage)) {
          order.shiprocketCancelStatus = "failed";
          order.shiprocketCancelError = "Order already shipped on Shiprocket. Cancellation prevented.";
          logFailure("already_shipped", shipmentMessage, shipmentPayload);
          return {
            ok: false,
            reason: "already_shipped",
            message: "Order already shipped on Shiprocket. Cancellation prevented.",
            shiprocketError: shipmentPayload,
          };
        }

        const noShipmentRecord = isNoRecordError(shipmentStatusCode, shipmentMessage);
        if (!noShipmentRecord) {
          throw shipmentErr;
        }

        if (normalizedOrderId) {
          const orderCancelRes = await tryOrderCancel();
          const orderCancelMessage = extractMessage(orderCancelRes) || "Order cancelled on Shiprocket";
          order.shiprocketCancelStatus = "success";
          order.shiprocketCancelError = null;
          logSuccess("cancel_order_fallback", orderCancelMessage);
          return {
            ok: true,
            message: `Order cancelled on Shiprocket (${orderCancelMessage}).`,
            stage: "cancel_order",
          };
        }

        order.shiprocketCancelStatus = "not_required";
        order.shiprocketCancelError = null;
        console.info("[shiprocket-cancel] no-op", {
          orderId: String(order._id || ""),
          shipmentId: normalizedShipmentId || null,
          shiprocketOrderId: normalizedOrderId || null,
          message: shipmentMessage,
        });
        return {
          ok: true,
          noAction: true,
          message: "No Shiprocket shipment/order exists. Nothing to cancel on Shiprocket.",
          stage: "no_record",
        };
      }
    }

    if (normalizedOrderId) {
      const orderCancelRes = await tryOrderCancel();
      const orderCancelMessage = extractMessage(orderCancelRes) || "Order cancelled on Shiprocket";
      order.shiprocketCancelStatus = "success";
      order.shiprocketCancelError = null;
      logSuccess("cancel_order", orderCancelMessage);
      return { ok: true, message: `Order cancelled on Shiprocket (${orderCancelMessage}).`, stage: "cancel_order" };
    }

    order.shiprocketCancelStatus = "not_required";
    order.shiprocketCancelError = null;
    return {
      ok: true,
      noAction: true,
      message: "No Shiprocket reference found. Cancellation skipped on Shiprocket.",
      stage: "none",
    };
  } catch (err) {
    const payload = err.shiprocket || err.response?.data || { message: err.message };
    const statusCode = Number(payload?.status || payload?.response?.status || err?.response?.status || 0);
    const errMessage = extractShiprocketErrorMessage(payload);

    if (isAlreadyShippedError(statusCode, errMessage)) {
      order.shiprocketCancelStatus = "failed";
      order.shiprocketCancelError = "Order already shipped on Shiprocket. Cancellation prevented.";
      logFailure("already_shipped", errMessage, payload);
      return {
        ok: false,
        reason: "already_shipped",
        message: "Order already shipped on Shiprocket. Cancellation prevented.",
        shiprocketError: payload,
      };
    }

    if (isNoRecordError(statusCode, errMessage)) {
      order.shiprocketCancelStatus = "not_required";
      order.shiprocketCancelError = null;
      console.info("[shiprocket-cancel] no-op", {
        orderId: String(order._id || ""),
        shipmentId: normalizedShipmentId || null,
        shiprocketOrderId: normalizedOrderId || null,
        message: errMessage,
      });
      return {
        ok: true,
        noAction: true,
        message: "No Shiprocket shipment/order exists. Nothing to cancel on Shiprocket.",
        stage: "no_record",
      };
    }

    order.shiprocketCancelStatus = "failed";
    order.shiprocketCancelError = errMessage;
    logFailure(normalizedShipmentId ? "cancel_shipment" : "cancel_order", errMessage, payload);
    return {
      ok: false,
      message: `Shiprocket cancellation failed. Use retry action. Reason: ${errMessage}`,
      shiprocketError: payload,
    };
  }
};

export const updateOrderStatus = async (req, res) => {
  let awbError = null;
  const warnings = [];

  try {
    const { orderId, forceCancel = false, ...fields } = req.body;

    if (!orderId) {
      return res.status(400).json({ message: "orderId is required" });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const rawPreviousStatus = String(order.status || "").toUpperCase();
    const previousStatus = rawPreviousStatus === "PENDING" ? "PLACED" : rawPreviousStatus;

    if (fields.status) {
      const requestedStatus = String(fields.status || "").toUpperCase();
      const allowedStatuses = ["PLACED", "CONFIRMED", "DISPATCHED", "DELIVERED", "CANCELLED"];

      if (!allowedStatuses.includes(requestedStatus)) {
        return res.status(400).json({ message: "Invalid status" });
      }

      const orderPaymentMethod = String(order.paymentMethod || "").toUpperCase();
      const hasGatewayAmount = Number(order.razorpayAmount || 0) > 0;
      const hasCapturedGatewayPayment = Boolean(String(order.razorpayPaymentId || "").trim());

      if (
        orderPaymentMethod === "ONLINE" &&
        hasGatewayAmount &&
        !hasCapturedGatewayPayment &&
        ["CONFIRMED", "DISPATCHED", "DELIVERED"].includes(requestedStatus)
      ) {
        return res.status(400).json({
          message:
            "Cannot move this order forward before payment capture. Complete Razorpay payment first or cancel the order.",
          code: "UNPAID_ONLINE_ORDER",
        });
      }

      if (requestedStatus === "CONFIRMED" && !["PLACED", "CONFIRMED"].includes(previousStatus)) {
        return res.status(409).json({ message: "Only placed orders can be confirmed" });
      }

      if (requestedStatus === "DISPATCHED" && !["CONFIRMED", "DISPATCHED"].includes(previousStatus)) {
        return res.status(409).json({ message: "Only confirmed orders can be dispatched" });
      }

      if (requestedStatus === "DELIVERED" && !["DISPATCHED", "DELIVERED"].includes(previousStatus)) {
        return res.status(409).json({ message: "Only dispatched orders can be delivered" });
      }

      if (
        requestedStatus === "CANCELLED" &&
        ["DISPATCHED", "DELIVERED"].includes(previousStatus) &&
        !forceCancel
      ) {
        return res.status(409).json({
          message:
            "This order is already dispatched/delivered. Confirm cancellation by retrying with forceCancel=true.",
          code: "CANCEL_REQUIRES_CONFIRMATION",
        });
      }

      if (requestedStatus === "CANCELLED" && previousStatus !== "CANCELLED") {
        const shiprocketCancelResult = await attemptShiprocketCancellation(order);

        if (!shiprocketCancelResult?.ok) {
          if (shiprocketCancelResult?.reason === "already_shipped") {
            return res.status(409).json({
              message:
                shiprocketCancelResult.message ||
                "Order already shipped on Shiprocket. Cancellation prevented.",
              code: "SHIPROCKET_ALREADY_SHIPPED",
              shiprocketError: shiprocketCancelResult.shiprocketError || null,
            });
          }

          return res.status(502).json({
            message: shiprocketCancelResult?.message || "Shiprocket cancellation failed",
            code: "SHIPROCKET_CANCELLATION_FAILED",
            shiprocketError: shiprocketCancelResult?.shiprocketError || null,
          });
        }

        if (shiprocketCancelResult?.message) {
          warnings.push(shiprocketCancelResult.message);
        }

        if (shiprocketCancelResult?.noAction && shiprocketCancelResult?.stage === "none") {
          warnings.push("No Shiprocket reference found. No Shiprocket cancellation action was required.");
        }

        order.status = requestedStatus;
        order.orderStatus = requestedStatus;

        if (!order.stockRestoredOnCancel) {
          for (const item of order.items || []) {
            const productId = item?.product?._id || item?.product;
            if (productId) {
              await Product.findByIdAndUpdate(productId, {
                $inc: { stockQuantity: Number(item.quantity || 0) },
              });
            }
          }
          order.stockRestoredOnCancel = true;
        }

        const paidAmount = inferPaidAmount(order);
        if (paidAmount > 0) {
          order.paymentStatus = order.refundProcessed ? "refunded" : "refund_pending";

          if (!order.refundProcessed && order.paymentStatus === "refund_pending") {
            order.refundStatus = "pending";
            order.refundRequestedAt = new Date();
            order.refundEstimatedCompletionDate = calculateEstimatedRefundCompletionDate();
          }
        } else {
          order.paymentStatus = "unpaid";
          order.refundStatus = "none";
        }

        order.refundError = null;
      } else {
        order.status = requestedStatus;
        order.orderStatus = requestedStatus;

        const shouldEnsureShipment = requestedStatus === "DISPATCHED";
        if (shouldEnsureShipment && !order.shiprocketShipmentId) {
          try {
            const orderWithUser = await Order.findById(order._id).populate("user", "name email phone");
            const forShiprocket = mapOrderToShiprocketPayload(orderWithUser);
            const srRes = await createShiprocketOrder(forShiprocket);
            const shipmentId = getShipmentIdFromShiprocketResponse(srRes);
            const shiprocketOrderId = getShiprocketOrderIdFromResponse(srRes);

            if (shipmentId) {
              order.shiprocketShipmentId = String(shipmentId);
              if (shiprocketOrderId && shiprocketOrderId !== String(order.orderId || order._id || "")) {
                order.shiprocketOrderId = String(shiprocketOrderId);
              }
            } else {
              awbError = {
                status: 400,
                message: explainShiprocketShipmentIssue(srRes),
                response: srRes,
              };
            }
          } catch (srErr) {
            const payload = srErr.shiprocket || srErr.response?.data || {
              message: srErr.message,
              status: srErr.response?.status,
            };

            if (isShiprocketAccessError(payload)) {
              awbError = payload;
            } else {
              return res.status(400).json({
                message: extractShiprocketErrorMessage(payload),
                shiprocketError: payload,
              });
            }
          }
        }

        const hasAwb = Boolean(String(order.shiprocketAwb || "").trim());
        if (requestedStatus === "DISPATCHED" && order.shiprocketShipmentId && !hasAwb) {
          try {
            const normalizedShipmentId = String(order.shiprocketShipmentId).split(",")[0].trim();
            let awbRes = await generateAWB(normalizedShipmentId);
            if (Array.isArray(awbRes) && awbRes.length) {
              awbRes = awbRes[0];
            }

            const awbCode = readAwbFromKnownKeys(awbRes);
            if (awbCode) {
              order.shiprocketAwb = String(awbCode);
              order.trackingUrl =
                awbRes?.tracking_url ??
                awbRes?.tracking ??
                awbRes?.data?.tracking_url ??
                awbRes?.response?.tracking_url ??
                awbRes?.response?.data?.tracking_url ??
                awbRes?.tracking_url_short ??
                `https://shiprocket.co/tracking/${encodeURIComponent(awbCode)}`;

              try {
                const labelRes = await generateLabel(normalizedShipmentId);
                if (labelRes?.label_url) {
                  order.shiprocketLabelUrl = labelRes.label_url;
                }
              } catch {
              }

              try {
                await generateManifest(normalizedShipmentId);
              } catch {
              }

              try {
                await schedulePickup(normalizedShipmentId);
              } catch {
              }
            } else {
              const detail = extractShiprocketErrorMessage(awbRes);
              awbError = {
                message: mapFriendlyAwbErrorMessage(detail),
                response: awbRes,
              };
            }
          } catch (awbErr) {
            awbError = awbErr.shiprocket || awbErr.message || String(awbErr);
          }
        }
      }
    }

    Object.keys(fields).forEach((key) => {
      if (key !== "status" && key !== "orderId" && key !== "forceCancel" && order.schema.paths[key]) {
        order[key] = fields[key];
      }
    });

    await order.save();

    const json = {
      message: "Order status updated",
      order,
      warnings,
    };

    if (awbError) {
      json.awbError = awbError;
      const msg = typeof awbError === "object" && (awbError?.response?.message || awbError?.message || "");
      const code = typeof awbError === "object" && Number(awbError?.status || awbError?.response?.status || 0);

      if (msg && /insufficient balance|minimum required balance|wallet|recharge/i.test(msg)) {
        order.shiprocketBalanceWarning = "Please recharge your ShipRocket wallet. The minimum required balance is Rs 100";
        json.awbMessage = "Please recharge your ShipRocket wallet. The minimum required balance is Rs 100";
      } else if (msg && /kyc|verification|complete your kyc/i.test(msg)) {
        json.awbMessage = "Complete KYC on Shiprocket to generate AWB. Log in to Shiprocket dashboard and retry DISPATCHED.";
      } else if (
        code === 401 ||
        code === 403 ||
        (msg && /access forbidden|unauthorized|don't have permission|blocked/i.test(msg))
      ) {
        json.awbMessage = "Shiprocket returned 403: account does not have permission to assign AWB.";
      }
    }

    return res.json(json);
  } catch (err) {
    console.error("Error updating order status:", {
      message: err?.message,
      stack: err?.stack,
      shiprocket: err?.shiprocket || null,
      response: err?.response?.data || null,
    });

    const details = err?.shiprocket?.message || err?.response?.data?.message || err?.message || "Server error";
    return res.status(500).json({ message: details });
  }
};

/**
 * MANUAL REFUND PROCESSING (Admin)
 * POST /api/payment/orders/:orderId/process-refund
 */
export const processOrderRefund = async (req, res) => {
  const orderId = req.params.orderId || req.body?.orderId;
  if (!orderId) {
    return res.status(400).json({ message: "orderId is required" });
  }

  // Concurrency guard: only one refund worker can hold the order lock.
  let order = await Order.findOneAndUpdate(
    { _id: orderId, refundInProgress: { $ne: true } },
    { $set: { refundInProgress: true } },
    { new: true }
  );

  if (!order) {
    return res.status(409).json({
      message: "Refund is already being processed for this order.",
      code: "REFUND_IN_PROGRESS",
    });
  }

  try {
    const status = String(order.status || "").toUpperCase();
    if (status !== "CANCELLED") {
      return res.status(400).json({
        message: "Only cancelled orders can be refunded.",
        code: "ORDER_NOT_CANCELLED",
      });
    }

    if (order.refundProcessed || String(order.paymentStatus || "").toLowerCase() === "refunded") {
      order.refundInProgress = false;
      await order.save();
      return res.json({
        message: "Refund already processed.",
        order,
        idempotent: true,
      });
    }

    const paymentStatus = String(order.paymentStatus || "").toLowerCase();
    if (!["refund_pending", "paid"].includes(paymentStatus)) {
      order.refundInProgress = false;
      await order.save();
      return res.status(400).json({
        message: "This order is not eligible for refund.",
        code: "REFUND_NOT_ELIGIBLE",
      });
    }

    const payableAmount = roundCurrency(order.payableAmount || order.totalAmount || 0);
    const walletUsed = roundCurrency(order.walletAmount || 0);
    let configuredGatewayAmount = roundCurrency(order.razorpayAmount || 0);
    const expectedGatewayAmount = roundCurrency(Math.max(0, payableAmount - walletUsed));
    let paymentIdForRefund = String(order.razorpayPaymentId || "").trim();

    if (!paymentIdForRefund && String(order.paymentMethod || "").toUpperCase() === "ONLINE") {
      const resolved = await resolveRazorpayPaymentForRefund(order);
      if (resolved.paymentId) {
        paymentIdForRefund = resolved.paymentId;
        order.razorpayPaymentId = resolved.paymentId;
      }
      if (configuredGatewayAmount <= 0 && resolved.amountRupee > 0) {
        configuredGatewayAmount = resolved.amountRupee;
        order.razorpayAmount = resolved.amountRupee;
      }
    }

    const gatewayRefundAmount = configuredGatewayAmount > 0 ? configuredGatewayAmount : expectedGatewayAmount;
    const shouldRefundGateway = Boolean(
      String(order.paymentMethod || "").toUpperCase() === "ONLINE" && expectedGatewayAmount > 0
    );

    let refundedViaRazorpay = 0;
    let refundedToWallet = 0;
    let razorpayRefundId = null;

    if (shouldRefundGateway) {
      if (!paymentIdForRefund) {
        order.paymentStatus = "refund_pending";
        order.refundError = "Missing Razorpay payment reference for refund.";
        order.refundStatus = "failed";
        order.refundFailureReason = "Missing payment reference";
        order.refundInProgress = false;
        await order.save();
        return res.status(400).json({
          message: "Missing Razorpay payment reference for refund.",
          code: "MISSING_PAYMENT_REFERENCE",
          refundStatus: "failed",
        });
      }

      try {
        const refund = await createRazorpayRefund({
          paymentId: paymentIdForRefund,
          amountRupee: gatewayRefundAmount,
          orderId: order._id,
        });
        refundedViaRazorpay = roundCurrency(gatewayRefundAmount);
        razorpayRefundId = String(refund?.id || "").trim() || null;
      } catch (refundErr) {
        order.paymentStatus = "refund_pending";
        order.refundError = refundErr.message || "Failed to process gateway refund.";
        order.refundStatus = "failed";
        order.refundFailureReason = refundErr.message || "Gateway refund failed";
        order.refundRetryCount = (order.refundRetryCount || 0) + 1;
        order.refundInProgress = false;
        await order.save();
        return res.status(400).json({
          message: order.refundError,
          refundError: {
            code: refundErr.code,
            gateway: refundErr.gateway || null,
          },
          refundStatus: "failed",
          refundRetryCount: order.refundRetryCount,
        });
      }
    }

    if (walletUsed > 0) {
      const walletCredit = await creditWalletRefund({
        order,
        amount: walletUsed,
        description: "Order cancelled refund (wallet portion)",
      });
      refundedToWallet = walletCredit.amount;
    }

    const totalRefunded = roundCurrency(refundedViaRazorpay + refundedToWallet);
    if (totalRefunded <= 0) {
      order.paymentStatus = "refund_pending";
      order.refundError = "No refundable amount found.";
      order.refundStatus = "failed";
      order.refundFailureReason = "No refundable amount";
      order.refundInProgress = false;
      await order.save();
      return res.status(400).json({
        message: "No refundable amount found.",
        code: "NO_REFUNDABLE_AMOUNT",
        refundStatus: "failed",
      });
    }

    order.refundProcessed = true;
    order.refundAmount = totalRefunded;
    order.refundAt = new Date();
    order.paymentStatus = "refunded";
    order.refundError = null;
    order.refundStatus = "completed";
    order.refundFailureReason = null;
    order.refundRetryCount = (order.refundRetryCount || 0) + 1;
    order.refundInProgress = false;
    if (razorpayRefundId) {
      order.razorpayRefundId = razorpayRefundId;
      order.refundId = razorpayRefundId;
    } else {
      order.refundId = `WALLET-${String(order._id).slice(-6)}-${Date.now()}`;
    }

    await order.save();

    return res.json({
      message: "Refund processed successfully.",
      order,
      refundId: order.refundId,
      refundTime: order.refundAt,
      refundStatus: "completed",
    });
  } catch (err) {
    order.refundInProgress = false;
    await order.save();
    return res.status(500).json({
      message: err?.message || "Failed to process refund",
      code: "PROCESS_REFUND_FAILED",
    });
  }
};

/**
 * RETRY SHIPROCKET CANCELLATION (Admin)
 * POST /api/payment/orders/:orderId/retry-shiprocket-cancel
 */
export const retryShiprocketCancel = async (req, res) => {
  try {
    const { orderId } = req.params;
    if (!orderId) {
      return res.status(400).json({ message: "orderId is required" });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (String(order.status || "").toUpperCase() !== "CANCELLED") {
      return res.status(400).json({
        message: "Shiprocket cancellation retry is allowed only for cancelled orders.",
      });
    }

    const result = await attemptShiprocketCancellation(order);
    await order.save();

    return res.json({
      message: result.message,
      ok: result.ok,
      order,
      shiprocketError: result.shiprocketError || null,
    });
  } catch (err) {
    return res.status(500).json({
      message: err?.message || "Failed to retry Shiprocket cancellation",
    });
  }
};
