import mongoose from "mongoose";

const productSchema = new mongoose.Schema(
  {
    // 🏷 Basic Info
    productName: {
      type: String,
      required: true,
      trim: true,
    },

    composition: {
      type: String,
      trim: true,
    },

    ingredients: {
      type: String,
      trim: true,
    },

    keyUses: {
      type: String,
      trim: true,
    },

    safetyInformation: {
      type: String,
      trim: true,
    },

    descriptionTextColor: {
      type: String,
      trim: true,
      default: "#0f172a",
    },

    descriptionBgColor: {
      type: String,
      trim: true,
      default: "#ffffff",
    },

    ingredientsTextColor: {
      type: String,
      trim: true,
      default: "#0f172a",
    },

    ingredientsBgColor: {
      type: String,
      trim: true,
      default: "#ffffff",
    },

    keyUsesTextColor: {
      type: String,
      trim: true,
      default: "#0f172a",
    },

    keyUsesBgColor: {
      type: String,
      trim: true,
      default: "#ffffff",
    },

    safetyTextColor: {
      type: String,
      trim: true,
      default: "#0f172a",
    },

    safetyBgColor: {
      type: String,
      trim: true,
      default: "#ffffff",
    },

    manufacturer: {
      type: String,
      trim: true,
    },

    packSize: {
      type: String,
      trim: true,
    },

    // Packing: e.g. "10 tabs", "1 pouch", "Strip of 15"
    packing: {
      type: String,
      trim: true,
    },

    // Product weight in kilograms for shipment weight calculation
    weight: {
      type: Number,
      required: true,
      min: 0.01,
    },

    // 📂 Category ref (from Category table)
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
    },


    // 🏷 Brand ref (from Brand table)
    brand: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Brand",
    },

    mrp: {
      type: Number,
      required: true,
      min: 0,
    },

    sellingPrice: {
      type: Number,
      required: true,
      min: 0,
    },

    discountPercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    gstPercent: {
      type: Number,
      default: 0,
      min: 0,
    },

    gstMode: {
      type: String,
      enum: ["include", "exclude"],
      default: "exclude",
      trim: true,
    },

    // 🧾 Regulatory / Batch Info
    hsnCode: {
      type: String,
      trim: true,
    },

    batchNumber: {
      type: String,
      trim: true,
    },

    expiryDate: {
      type: Date,
    },

    // 📦 Inventory
    stockQuantity: {
      type: Number,
      default: 0,
      min: 0,
    },

    minStockLevel: {
      type: Number,
      default: 0,
      min: 0,
    },

    minOrderQty: {
      type: Number,
      default: 1,
      min: 1,
    },
    

    // 🔘 Status Flags
    isActive: {
      type: Boolean,
      default: true,
    },

    prescriptionRequired: {
      type: Boolean,
      default: false,
    },

    // 🖼 Product Images (max 6)
    productImages: [
      {
        type: String, // store image URL or file path
      },
    ],
  },
  { timestamps: true },
);

const Product = mongoose.model("Product", productSchema);
export default Product;
