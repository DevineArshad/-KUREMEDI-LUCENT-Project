import mongoose from "mongoose";

const orderItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    productName: {
      type: String,
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    price: {
      type: Number,
      required: true,
    },
    mrp: {
      type: Number,
    },
    gstPercent: {
      type: Number,
      default: 0,
    },
    discountPercent: {
      type: Number,
      default: 0,
    },
    gstMode: {
      type: String,
      enum: ["include", "exclude"],
      default: "exclude",
    },
    gstAmount: {
      type: Number,
      default: 0,
    },
    lineSubtotal: {
      type: Number,
      default: 0,
    },
    lineTotal: {
      type: Number,
      default: 0,
    },
    weight: {
      type: Number,
      default: 0.5,
      min: 0.01,
    },
  },
  { _id: false },
);

const orderCartItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    weight: {
      type: Number,
      required: true,
      min: 0.01,
      default: 0.5,
    },
  },
  { _id: false },
);

const orderSchema = new mongoose.Schema(
  {
    orderId: {
      type: String,
      index: true,
      default: function () {
        return this._id ? this._id.toString() : "";
      },
    },
    customerName: {
      type: String,
      default: "",
    },
    address: {
      type: String,
      default: "",
    },
    pincode: {
      type: String,
      default: "",
    },
    paymentMode: {
      type: String,
      enum: ["COD", "Prepaid"],
      default: "COD",
    },
    shipmentId: {
      type: String,
      default: null,
    },
    awbCode: {
      type: String,
      default: null,
    },
    courierName: {
      type: String,
      default: null,
    },
    orderStatus: {
      type: String,
      enum: ["PLACED", "CONFIRMED", "DISPATCHED", "DELIVERED", "CANCELLED"],
      default: "PLACED",
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    items: [orderItemSchema],
    cartItems: [orderCartItemSchema],
    totalAmount: {
      type: Number,
      required: true,
    },
    totalGstAmount: {
      type: Number,
      default: 0,
    },
    payableAmount: {
      type: Number,
      required: true,
    },
    totalWeight: {
      type: Number,
      required: true,
      min: 0.01,
      default: 0.5,
    },
    status: {
      type: String,
      enum: ["PLACED", "CONFIRMED", "DISPATCHED", "DELIVERED", "CANCELLED"],
      default: "PLACED",
    },
    paymentStatus: {
      type: String,
      enum: ["unpaid", "paid", "refund_pending", "refunded"],
      default: "unpaid",
      index: true,
    },
    paymentMethod: {
      type: String,
      enum: ["COD", "ONLINE"],
      default: "COD",
    },
    razorpayOrderId: { type: String },
    razorpayPaymentId: { type: String },
    razorpayRefundId: { type: String, default: null },
    walletAmount: { type: Number, default: 0 },
    razorpayAmount: { type: Number, default: 0 },
    shippingAddress: {
      shopName: { type: String, default: "" },
      address: { type: String, default: "" },
      phone: { type: String, default: "" },
      city: { type: String, default: "" },
      state: { type: String, default: "" },
      pincode: { type: String, default: "" },
    },
    notes: {
      type: String,
    },
    shiprocketShipmentId: { type: String, default: null },
    shiprocketAwb: { type: String, default: null },
    shiprocketLabelUrl: { type: String, default: null },
    trackingUrl: { type: String, default: null },
    shiprocketCancelStatus: {
      type: String,
      enum: ["not_required", "pending", "success", "failed"],
      default: "not_required",
    },
    shiprocketCancelError: { type: String, default: null },
    shiprocketCancelAttempts: { type: Number, default: 0 },
    shiprocketCancelLastTriedAt: { type: Date, default: null },
    stockRestoredOnCancel: { type: Boolean, default: false },
    refundInProgress: { type: Boolean, default: false },
    refundError: { type: String, default: null },
    refundId: { type: String, default: null },
    refundProcessed: { type: Boolean, default: false },
    refundAmount: { type: Number, default: 0 },
    refundAt: { type: Date, default: null },
    refundRequestedAt: { type: Date, default: null },
    refundStatus: {
      type: String,
      enum: ["none", "pending", "processing", "completed", "failed"],
      default: "none",
    },
    refundEstimatedCompletionDate: { type: Date, default: null },
    refundFailureReason: { type: String, default: null },
    refundRetryCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

orderSchema.pre("save", async function () {
  if (!this.orderId && this._id) {
    this.orderId = this._id.toString();
  }

  if (!this.orderStatus && this.status) {
    this.orderStatus = this.status;
  }

  // Backward compatibility for historical records that stored REFUNDED as order status.
  if (String(this.status || "").toUpperCase() === "REFUNDED") {
    this.status = "CANCELLED";
    this.paymentStatus = "refunded";
  }
  if (String(this.orderStatus || "").toUpperCase() === "REFUNDED") {
    this.orderStatus = "CANCELLED";
    this.paymentStatus = "refunded";
  }

  // Backward compatibility for historical records that used PENDING.
  if (String(this.status || "").toUpperCase() === "PENDING") {
    this.status = "PLACED";
  }
  if (String(this.orderStatus || "").toUpperCase() === "PENDING") {
    this.orderStatus = "PLACED";
  }

  if (!(Number(this.totalWeight) > 0)) {
    const items = Array.isArray(this.items) ? this.items : [];
    const computed = items.reduce((sum, item) => {
      const weight = Number(item?.weight);
      const safeWeight = Number.isFinite(weight) && weight > 0 ? weight : 0.5;
      const quantity = Number(item?.quantity);
      const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
      return sum + safeWeight * safeQuantity;
    }, 0);
    this.totalWeight = Math.max(0.01, Math.round(computed * 100) / 100);
  }
});

const Order = mongoose.models.Order || mongoose.model("Order", orderSchema);

export default Order;
