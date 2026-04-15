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
      enum: ["PENDING", "PLACED", "CONFIRMED", "DISPATCHED", "DELIVERED", "CANCELLED", "REFUNDED"],
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
    status: {
      type: String,
      enum: ["PENDING", "PLACED", "CONFIRMED", "DISPATCHED", "DELIVERED", "CANCELLED", "REFUNDED"],
      default: "PLACED",
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
    stockRestoredOnCancel: { type: Boolean, default: false },
    refundProcessed: { type: Boolean, default: false },
    refundAmount: { type: Number, default: 0 },
    refundAt: { type: Date, default: null },
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
});

const Order = mongoose.models.Order || mongoose.model("Order", orderSchema);

export default Order;
