import Cart from "../model/Cart.js";
import Order from "../models/order.model.js";
import Product from "../model/Product.js";
import User from "../model/User.js";
import {
  createShiprocketOrder,
  extractShiprocketAwbCode,
  extractShiprocketShipmentId,
  extractShiprocketTrackingStatus,
  generateAWB,
  generateLabel,
  generateManifest,
  mapOrderToShiprocketPayload,
  normalizeShiprocketStatus,
  parseShiprocketWebhookPayload,
  schedulePickup,
  trackShipment,
} from "../services/shiprocket.service.js";
import { calculateLinePricing } from "../utils/pricing.js";

const FALLBACK_ITEM_WEIGHT_KG = 0.5;

const resolveItemWeight = (weight) => {
  const numeric = Number(weight);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.round(numeric * 100) / 100;
  }
  return FALLBACK_ITEM_WEIGHT_KG;
};

const roundWeight = (weight) => Math.round(Number(weight || 0) * 100) / 100;

const toTrackingUrl = (awb, trackingUrl) => {
  if (!awb) return null;
  const safe = `https://shiprocket.co/tracking/${encodeURIComponent(awb)}`;
  if (!trackingUrl) return safe;
  if (trackingUrl.includes("track.shiprocket.in")) return safe;
  if (trackingUrl.includes("shiprocket.in/shipment-tracking")) return safe;
  return trackingUrl;
};

const syncShiprocketFields = (order, { shipmentId, awbCode, courierName, trackingUrl, status }) => {
  const normalizedStatus = normalizeShiprocketStatus(status);

  if (shipmentId != null) {
    const value = String(shipmentId).trim();
    if (value) {
      order.shiprocketShipmentId = value;
      order.shipmentId = value;
    }
  }

  if (awbCode != null) {
    const value = String(awbCode).trim();
    if (value) {
      order.shiprocketAwb = value;
      order.awbCode = value;
      order.trackingUrl = toTrackingUrl(value, trackingUrl || order.trackingUrl);
    }
  }

  if (courierName != null) {
    const value = String(courierName).trim();
    if (value) {
      order.courierName = value;
    }
  }

  if (normalizedStatus) {
    order.status = normalizedStatus;
    order.orderStatus = normalizedStatus;
  }

  if (!order.orderId && order._id) {
    order.orderId = order._id.toString();
  }

  if (!order.customerName) {
    order.customerName = String(order.user?.name || order.userId?.name || "Customer").trim() || "Customer";
  }

  if (!order.address) {
    order.address = String(order.shippingAddress?.address || order.shippingAddress?.shopName || "").trim();
  }

  if (!order.pincode) {
    order.pincode = String(order.shippingAddress?.pincode || "").trim();
  }

  if (!order.paymentMode) {
    order.paymentMode = String(order.paymentMethod || "COD").toUpperCase() === "ONLINE" ? "Prepaid" : "COD";
  }
};

const getDispatchWarnings = async (shipmentId) => {
  const warnings = [];

  try {
    await generateManifest(shipmentId);
  } catch (error) {
    warnings.push({ stage: "manifest", message: error.message });
  }

  try {
    await schedulePickup(shipmentId);
  } catch (error) {
    warnings.push({ stage: "pickup", message: error.message });
  }

  return warnings;
};

/**
 * PLACE ORDER
 * POST /api/orders
 */
export const placeOrder = async (req, res) => {
  try {
    const { shippingAddress, notes } = req.body;

    const cart = await Cart.findOne({ user: req.user._id }).populate(
      "items.product",
    );

    if (!cart || cart.items.length === 0)
      return res.status(400).json({ message: "Cart is empty" });

    let totalAmount = 0;
    let totalGstAmount = 0;

    const orderItems = [];

    for (const item of cart.items) {
      const product = item.product;

      if (!product || !product.isActive)
        return res.status(400).json({
          message: `Product not available`,
        });

      if (product.stockQuantity < item.quantity)
        return res.status(400).json({
          message: `Insufficient stock for ${product.productName}`,
        });

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

    const payableAmount = Math.round((totalAmount + totalGstAmount) * 100) / 100;
    const totalWeightRaw = orderItems.reduce((total, item) => {
      const itemWeight = resolveItemWeight(item.weight);
      return total + itemWeight * Number(item.quantity || 1);
    }, 0);
    const totalWeight = Math.max(0.01, roundWeight(totalWeightRaw));

    // retailer who is ordering
    const user = await User.findById(req.user._id);

    const order = await Order.create({
      user: req.user._id,
      createdBy: user.createdBy || null,
      items: orderItems,
      customerName: String(user.name || "Customer").trim() || "Customer",
      address: String(shippingAddress?.address || shippingAddress?.shopName || "").trim(),
      pincode: String(shippingAddress?.pincode || "").trim(),
      paymentMode: "COD",
      orderStatus: "PLACED",
      totalAmount,
      totalGstAmount,
      payableAmount,
      totalWeight,
      cartItems: orderItems.map((item) => ({
        product: item.product,
        quantity: item.quantity,
        weight: item.weight,
      })),
      shippingAddress,
      notes,
    });

    // reduce stock
    for (const item of cart.items) {
      await Product.findByIdAndUpdate(item.product._id, {
        $inc: { stockQuantity: -item.quantity },
      });
    }

    // clear cart
    cart.items = [];
    await cart.save();

    res.status(201).json({
      message: "Order placed successfully",
      order,
    });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * MY ORDERS (Retailer)
 * GET /api/orders/my
 */
export const getMyOrders = async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .lean();
    const sanitized = orders.map((o) => {
      const awb = o.shiprocketAwb || null;
      const trackingUrl = toTrackingUrl(awb, o.trackingUrl);

      return {
        ...o,
        shiprocketAwb: awb,
        trackingUrl,
      };
    });
    res.json(sanitized);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * ALL ORDERS (Admin)
 * GET /api/orders/all
 */
export const getAllOrders = async (req, res) => {
  try {
    const orders = await Order.find()
      .populate("user", "name phone role")
      .sort({ createdAt: -1 });

    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * GET ORDER TRACKING (My order – live status + Shiprocket scan history)
 * GET /api/orders/:orderId/tracking
 */
export const getOrderTracking = async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (order.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not your order" });
    }

    let tracking = null;
    if (order.shiprocketAwb) {
      try {
        tracking = await trackShipment(order.shiprocketAwb);
        const trackingStatus = extractShiprocketTrackingStatus(tracking);
        const normalizedStatus = normalizeShiprocketStatus(trackingStatus);
        if (normalizedStatus && normalizedStatus !== order.status) {
          order.status = normalizedStatus;
          order.orderStatus = normalizedStatus;
          await order.save();
        }
      } catch (err) {
      }
    }

    res.json({
      order: {
        _id: order._id,
        status: order.status,
        trackingUrl: toTrackingUrl(order.shiprocketAwb, order.trackingUrl),
        trackingNumber: order.shiprocketAwb || null,
        createdAt: order.createdAt,
        items: order.items,
        shippingAddress: order.shippingAddress,
        payableAmount: order.payableAmount,
      },
      tracking,
    });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * UPDATE ORDER STATUS (Admin)
 * PUT /api/orders/:orderId/status
 */
export const updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;

    const order = await Order.findById(req.params.orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });

    order.status = status;
    order.orderStatus = status;
    await order.save();

    res.json({
      message: "Order status updated",
      order,
    });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};

export const dispatchOrder = async (req, res) => {
  try {
    const { orderId, force = false } = req.body || {};
    const targetOrderId = orderId || req.params.orderId;

    if (!targetOrderId) {
      return res.status(400).json({ message: "orderId is required" });
    }

    const order = await Order.findById(targetOrderId).populate("user", "name email phone");
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (!force && order.shiprocketShipmentId && order.shiprocketAwb) {
      return res.json({
        message: "Order already dispatched",
        order,
        shiprocket: {
          shipmentId: order.shiprocketShipmentId,
          awb: order.shiprocketAwb,
          labelUrl: order.shiprocketLabelUrl,
          trackingUrl: order.trackingUrl,
        },
      });
    }

    const payload = mapOrderToShiprocketPayload(order);
    const createResponse = await createShiprocketOrder(payload);
    const shipmentId = extractShiprocketShipmentId(createResponse);

    if (!shipmentId) {
      return res.status(400).json({
        message: "Shiprocket did not return shipment_id",
        shiprocketError: createResponse,
      });
    }

    syncShiprocketFields(order, {
      shipmentId,
      status: "DISPATCHED",
    });

    let awbResponse = null;
    let awbCode = null;
    const warnings = [];

    try {
      awbResponse = await generateAWB(shipmentId);
      awbCode = extractShiprocketAwbCode(awbResponse);
      if (awbCode) {
        syncShiprocketFields(order, {
          shipmentId,
          awbCode,
          trackingUrl:
            awbResponse?.tracking_url ||
            awbResponse?.tracking ||
            awbResponse?.data?.tracking_url ||
            null,
          status: "DISPATCHED",
        });
      } else {
        warnings.push({ stage: "awb", message: "Shiprocket did not return a valid AWB code" });
      }
    } catch (error) {
      warnings.push({ stage: "awb", message: error.message });
    }

    try {
      const labelRes = await generateLabel(shipmentId);
      if (labelRes?.label_url) {
        order.shiprocketLabelUrl = labelRes.label_url;
      }
    } catch (error) {
      warnings.push({ stage: "label", message: error.message });
    }

    const extraWarnings = await getDispatchWarnings(shipmentId);
    warnings.push(...extraWarnings.filter((item) => item.message));

    await order.save();

    return res.json({
      message: "Order dispatched successfully",
      order,
      shiprocket: {
        shipmentId: order.shiprocketShipmentId,
        awb: order.shiprocketAwb,
        labelUrl: order.shiprocketLabelUrl,
        trackingUrl: order.trackingUrl,
      },
      awbResponse,
      warnings,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || "Failed to dispatch order",
    });
  }
};

export const trackShipmentByAwb = async (req, res) => {
  try {
    const awb = String(req.params.awb || req.query.awb || "").trim();
    if (!awb) {
      return res.status(400).json({ message: "awb is required" });
    }

    const tracking = await trackShipment(awb);
    const trackingStatus = extractShiprocketTrackingStatus(tracking);
    const normalizedStatus = normalizeShiprocketStatus(trackingStatus);

    const order = await Order.findOne({
      $or: [{ shiprocketAwb: awb }, { awbCode: awb }],
    });

    if (order && normalizedStatus) {
      order.status = normalizedStatus;
      order.orderStatus = normalizedStatus;
      await order.save();
    }

    return res.json({
      message: "Shipment tracking fetched successfully",
      awb,
      order,
      tracking,
      trackingStatus: normalizedStatus || trackingStatus || null,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || "Failed to track shipment",
    });
  }
};

export const handleShiprocketWebhook = async (req, res) => {
  try {
    const event = parseShiprocketWebhookPayload(req.body);
    const query = { $or: [] };

    if (event.shipmentId) query.$or.push({ shiprocketShipmentId: event.shipmentId }, { shipmentId: event.shipmentId });
    if (event.awbCode) query.$or.push({ shiprocketAwb: event.awbCode }, { awbCode: event.awbCode });
    if (event.orderId) {
      query.$or.push({ orderId: event.orderId });
      if (/^[a-fA-F0-9]{24}$/.test(event.orderId)) {
        query.$or.push({ _id: event.orderId });
      }
    }

    if (query.$or.length === 0) {
      return res.status(400).json({ message: "Webhook payload did not include a shipment reference" });
    }

    const order = await Order.findOne(query);
    if (!order) {
      return res.status(404).json({ message: "Order not found for Shiprocket webhook" });
    }

    syncShiprocketFields(order, {
      shipmentId: event.shipmentId || order.shiprocketShipmentId,
      awbCode: event.awbCode || order.shiprocketAwb,
      courierName: event.courierName || order.courierName,
      trackingUrl: event.trackingUrl || order.trackingUrl,
      status: event.normalizedStatus || event.status || order.status,
    });

    await order.save();

    return res.json({
      message: "Shiprocket webhook processed successfully",
      order,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || "Failed to process Shiprocket webhook",
    });
  }
};
