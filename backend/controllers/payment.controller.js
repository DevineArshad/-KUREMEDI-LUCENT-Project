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
} from "../config/shiprocket.js";
import { calculateLinePricing } from "../utils/pricing.js";
import { getValidatedRazorpayConfig } from "../utils/razorpayConfig.js";

const MIN_CHECKOUT_AMOUNT_KEY = "minimumCheckoutAmount";

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

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  return { ok: response.ok, status: response.status, data };
}

async function finalizePaidOrder({ order, userId, paymentId }) {
  if (!order || order.status !== "PENDING") return order;

  order.status = "PLACED";
  order.razorpayPaymentId = paymentId;
  await order.save();

  try {
    const orderWithUser = await Order.findById(order._id).populate("user", "name email phone");
    const forShiprocket = mapOrderToShiprocketPayload(orderWithUser);
    const srRes = await createShiprocketOrder(forShiprocket);
    const shipmentId =
      srRes?.shipment_id ?? srRes?.shipments?.[0]?.id ?? srRes?.shipments?.[0]?.shipment_id;
    if (shipmentId) {
      order.shiprocketShipmentId = String(shipmentId);
      await order.save();
    }
  } catch (srErr) {
  }

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

    if (order.status !== "PENDING") {
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

    if (
      !normalizedShippingAddress.address ||
      !normalizedShippingAddress.city ||
      !normalizedShippingAddress.pincode ||
      !normalizedShippingAddress.phone
    ) {
      return res.status(400).json({
        message: "Address, city, pincode and phone are required",
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
      });
    }

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

    // Reuse a very recent pending Razorpay order to avoid duplicate order creation
    // when users tap "Place Order" repeatedly.
    if (razorpayAmountRupee > 0) {
      const recentThreshold = new Date(Date.now() - 15 * 60 * 1000);
      const recentPendingOrder = await Order.findOne({
        user: req.user._id,
        status: "PENDING",
        paymentMethod: "ONLINE",
        createdAt: { $gte: recentThreshold },
        razorpayAmount: razorpayAmountRupee,
        walletAmount,
        razorpayOrderId: { $exists: true, $ne: null },
      }).sort({ createdAt: -1 });

      if (recentPendingOrder) {
        return res.status(200).json({
          message: "Resume pending payment",
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
      totalAmount,
      totalGstAmount,
      payableAmount: payableAmountRupee,
      walletAmount,
      razorpayAmount: razorpayAmountRupee,
      status: walletAmount >= payableAmountRupee ? "PLACED" : "PENDING",
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

      // Create Shiprocket order on payment success (wallet-only)
      try {
        const orderWithUser = await Order.findById(order._id).populate("user", "name email phone");
        const forShiprocket = mapOrderToShiprocketPayload(orderWithUser);
        const srRes = await createShiprocketOrder(forShiprocket);
        const shipmentId =
          srRes?.shipment_id ?? srRes?.shipments?.[0]?.id ?? srRes?.shipments?.[0]?.shipment_id;
        if (shipmentId) {
          order.shiprocketShipmentId = String(shipmentId);
          await order.save();
        }
      } catch (srErr) {
      }

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

    if (order.status !== "PENDING") {
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

    if (order.status === "PLACED" || order.razorpayPaymentId) {
      return res.json({ status: "paid", orderStatus: order.status });
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
  ].find((v) => typeof v === "string" || typeof v === "number");
  if (direct != null && String(direct).trim()) return String(direct).trim();

  const scan = (node) => {
    if (!node || typeof node !== "object") return null;
    for (const [key, value] of Object.entries(node)) {
      if (key.toLowerCase().includes("awb") && (typeof value === "string" || typeof value === "number")) {
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

  if (!shipmentId) {
    return null;
  }

  order.shiprocketShipmentId = String(shipmentId);
  await order.save();
  return String(shipmentId);
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
        message: "Failed to create Shiprocket shipment",
        shiprocketError: payload,
      });
    }

    let awbRes;
    try {
      awbRes = await generateAWB(shipmentId);
    } catch (awbErr) {
      const payload = awbErr.shiprocket || awbErr.response?.data || { message: awbErr.message };
      return res.status(400).json({
        message: "Failed to generate AWB",
        shiprocketError: payload,
      });
    }

    const awbCode = readAwbFromKnownKeys(awbRes);
    if (!awbCode) {
      return res.status(400).json({
        message: "Shiprocket did not return a valid AWB code for this shipment.",
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
export const updateOrderStatus = async (req, res) => {
  let awbError = null;
  let refundMessage = null;
  try {
    const { orderId, ...fields } = req.body;

    if (!orderId) {
      return res.status(400).json({ message: "orderId is required" });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const previousStatus = String(order.status || "").toUpperCase();

    if (fields.status) {
      const allowed = ["PLACED", "CONFIRMED", "DISPATCHED", "DELIVERED", "CANCELLED"];
      if (!allowed.includes(fields.status)) {
        return res.status(400).json({ message: "Invalid status" });
      }
      order.status = fields.status;

      const shouldEnsureShipment = fields.status === "DISPATCHED";

      // Create shipment only when dispatching. Confirmed should not fail due to Shiprocket setup.
      if (shouldEnsureShipment && !order.shiprocketShipmentId) {
        try {
          const orderWithUser = await Order.findById(order._id).populate(
            "user",
            "name email phone",
          );
          const forShiprocket = mapOrderToShiprocketPayload(orderWithUser);
          const srRes = await createShiprocketOrder(forShiprocket);
          const shipmentId = getShipmentIdFromShiprocketResponse(srRes);
          if (shipmentId) {
            order.shiprocketShipmentId = String(shipmentId);
          } else {
            // If Shiprocket did not return a shipment id, surface the error to client
            return res.status(400).json({
              message: explainShiprocketShipmentIssue(srRes),
              shiprocketResponse: srRes,
            });
          }
        } catch (srErr) {
          const payload = srErr.shiprocket || srErr.response?.data || {
            message: srErr.message,
            status: srErr.response?.status,
          };
          return res.status(400).json({
            message: "Failed to create Shiprocket shipment",
            shiprocketError: payload,
          });
        }
      }

      // On cancellation, refund once to wallet and restore stock once.
      if (fields.status === "CANCELLED" && previousStatus !== "CANCELLED") {
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

        if (!order.refundProcessed) {
          const refundAmount = Math.round(Number(order.payableAmount || order.totalAmount || 0) * 100) / 100;
          if (refundAmount > 0) {
            let wallet = await Wallet.findOne({ user: order.user });
            if (!wallet) {
              wallet = await Wallet.create({ user: order.user, balance: 0 });
            }

            wallet.balance = Math.round((Number(wallet.balance || 0) + refundAmount) * 100) / 100;
            wallet.transactions.push({
              amount: refundAmount,
              type: "CREDIT",
              description: "Order cancelled refund",
              order: order._id,
              balanceAfter: wallet.balance,
            });
            await wallet.save();

            order.refundProcessed = true;
            order.refundAmount = refundAmount;
            order.refundAt = new Date();
            refundMessage = `Refunded Rs ${refundAmount.toFixed(2)} to user wallet.`;
          } else {
            refundMessage = "Order cancelled. No refundable amount found.";
          }
        } else {
          refundMessage = `Order already refunded (Rs ${Number(order.refundAmount || 0).toFixed(2)}).`;
        }
      }

      // When admin marks as DISPATCHED (ship), assign AWB then label, manifest, pickup
      const hasAwb = Boolean(String(order.shiprocketAwb || "").trim());
      if (fields.status === "DISPATCHED" && order.shiprocketShipmentId && !hasAwb) {
        try {
          const normalizedShipmentId = String(order.shiprocketShipmentId).split(",")[0].trim();
          let awbRes = await generateAWB(normalizedShipmentId);
          if (Array.isArray(awbRes) && awbRes.length) awbRes = awbRes[0];

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

            // After AWB: generate label, manifest, schedule pickup
            try {
              const labelRes = await generateLabel(normalizedShipmentId);
              if (labelRes?.label_url) order.shiprocketLabelUrl = labelRes.label_url;
            } catch (labelErr) {
            }
            try {
              await generateManifest(normalizedShipmentId);
            } catch (manifestErr) {
            }
            try {
              await schedulePickup(normalizedShipmentId);
            } catch (pickupErr) {
            }
          } else {
            awbError = {
              message: "Shiprocket did not return a valid AWB code for this shipment.",
              response: awbRes,
            };
          }
        } catch (awbErr) {
          awbError = awbErr.shiprocket || awbErr.message || String(awbErr);
        }
      }
    }

    Object.keys(fields).forEach((key) => {
      if (key !== "status" && key !== "orderId" && order.schema.paths[key]) {
        order[key] = fields[key];
      }
    });

    await order.save();

    const json = { message: "Order status updated", order };
    if (refundMessage) {
      json.refundMessage = refundMessage;
    }
    if (awbError) {
      json.awbError = awbError;
      const msg = typeof awbError === "object" && awbError?.response?.message;
      const code = typeof awbError === "object" && awbError?.status;
      if (msg && /kyc|verification|complete your kyc/i.test(msg)) {
        json.awbMessage = "Complete KYC on Shiprocket to generate AWB. Log in to Shiprocket dashboard → complete KYC, then set this order to DISPATCHED again.";
      } else if (code === 403 || (msg && /unauthorized|don't have permission/i.test(msg))) {
        json.awbMessage = "Shiprocket returned 403: Your account does not have permission to assign AWB. Complete KYC, check your plan at app.shiprocket.in, or contact Shiprocket support to enable 'Assign AWB' for your account.";
      }
    }
    res.json(json);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};
