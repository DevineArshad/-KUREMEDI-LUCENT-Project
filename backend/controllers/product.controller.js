import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Product from "../model/Product.js";
import Category from "../model/Category.js";
import Brand from "../model/Brand.js";
import { normalizeGstMode, normalizePercent } from "../utils/pricing.js";
import { uploadImagesToCloudinary } from "../utils/cloudinaryUpload.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const hasLegacyFilePath = (value) => {
  if (!value || typeof value !== "string") return false;
  const raw = value.trim();
  if (!raw || raw.startsWith("data:") || /^https?:\/\//i.test(raw)) return false;
  const normalized = raw.replace(/\\/g, "/").replace(/^\/+/, "");

  const candidates = [
    path.resolve(process.cwd(), normalized),
    path.resolve(process.cwd(), "backend", normalized),
    path.resolve(__dirname, "..", normalized),
  ];

  return candidates.some((abs) => fs.existsSync(abs));
};

const isKeepableImageValue = (value) => {
  if (!value || typeof value !== "string") return false;
  const raw = value.trim();
  if (!raw) return false;
  if (/^https?:\/\//i.test(raw)) return true;
  return hasLegacyFilePath(raw);
};

const parseProductBody = (body) => {
  const obj = { ...body };
  if (obj.mrp !== undefined) obj.mrp = Number(obj.mrp);
  if (obj.sellingPrice !== undefined) obj.sellingPrice = Number(obj.sellingPrice);
  if (obj.discountPercent !== undefined) obj.discountPercent = Number(obj.discountPercent);
  if (obj.gstPercent !== undefined) obj.gstPercent = Number(obj.gstPercent);
  if (obj.gstMode !== undefined) obj.gstMode = normalizeGstMode(obj.gstMode);
  if (obj.stockQuantity !== undefined) obj.stockQuantity = Number(obj.stockQuantity);
  if (obj.minStockLevel !== undefined) obj.minStockLevel = Number(obj.minStockLevel);
  if (obj.minOrderQty !== undefined) obj.minOrderQty = Number(obj.minOrderQty);
  if (obj.weight !== undefined) obj.weight = Number(obj.weight);
  if (obj.expiryDate !== undefined && obj.expiryDate)
    obj.expiryDate = new Date(obj.expiryDate);
  if (obj.isActive !== undefined)
    obj.isActive = obj.isActive === "true" || obj.isActive === true;
  if (obj.prescriptionRequired !== undefined)
    obj.prescriptionRequired = obj.prescriptionRequired === "true" || obj.prescriptionRequired === true;
  if (obj.category === "" || obj.category === "null") obj.category = null;
  if (obj.brand === "" || obj.brand === "null") obj.brand = null;
  delete obj.productImages; // handled from files
  return obj;
};

const validatePricingFields = ({ mrp, sellingPrice, discountPercent, gstPercent }) => {
  if (sellingPrice == null || isNaN(sellingPrice) || sellingPrice < 0) {
    return "Valid selling price is required";
  }
  if (mrp == null || isNaN(mrp) || mrp < 0) {
    return "Valid MRP is required";
  }
  if (sellingPrice > mrp) {
    return "Selling price cannot be greater than MRP";
  }
  if (discountPercent != null && (isNaN(discountPercent) || discountPercent < 0 || discountPercent > 100)) {
    return "Discount percent must be between 0 and 100";
  }
  if (gstPercent != null && (isNaN(gstPercent) || gstPercent < 0)) {
    return "GST percent cannot be negative";
  }
  return null;
};

const validateWeightField = (weight) => {
  if (!Number.isFinite(weight) || weight <= 0) {
    return "Product weight must be greater than 0";
  }
  return null;
};

const resolveGstMode = ({ rawMode, gstPercent, fallbackMode = "exclude" }) => {
  const hasRawMode = rawMode !== undefined && rawMode !== null && String(rawMode).trim() !== "";
  if (hasRawMode) return normalizeGstMode(rawMode);
  return Number(gstPercent) > 0 ? "include" : normalizeGstMode(fallbackMode);
};

const resolveProductErrorStatus = (error) => {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("cloudinary")) return 500;
  if (message.includes("econn") || message.includes("timeout")) return 502;
  return 400;
};

export const createProduct = async (req, res) => {
  try {
    const data = parseProductBody(req.body);
    const name = (data.productName || "").toString().trim();
    if (!name) {
      return res.status(400).json({ success: false, message: "Product name is required" });
    }
    const sellingPrice = Number(data.sellingPrice);
    const mrp = Number(data.mrp);
    const discountPercent = Number(data.discountPercent ?? 0);
    const gstPercent = Number(data.gstPercent ?? 0);
    const weight = Number(data.weight);
    const pricingError = validatePricingFields({ mrp, sellingPrice, discountPercent, gstPercent });
    if (pricingError) {
      return res.status(400).json({ success: false, message: pricingError });
    }
    const weightError = validateWeightField(weight);
    if (weightError) {
      return res.status(400).json({ success: false, message: weightError });
    }
    data.weight = Math.round(weight * 100) / 100;
    data.discountPercent = normalizePercent(discountPercent, 100);
    data.gstMode = resolveGstMode({ rawMode: req.body?.gstMode, gstPercent, fallbackMode: data.gstMode });
    data.gstPercent = data.gstMode === "include" ? normalizePercent(gstPercent) : 0;
    if (!data.category || !mongoose.Types.ObjectId.isValid(data.category)) {
      return res.status(400).json({ success: false, message: "Category is required" });
    }
    if (!data.brand || !mongoose.Types.ObjectId.isValid(data.brand)) {
      return res.status(400).json({ success: false, message: "Brand is required" });
    }
    if (req.files?.length) {
      try {
        data.productImages = await uploadImagesToCloudinary(req.files, {
          folder: "lucent/products",
        });
        if (!data.productImages || data.productImages.length === 0) {
          return res.status(500).json({ success: false, message: "Failed to upload images to cloud storage" });
        }
      } catch (uploadError) {
        console.error("Image upload error:", uploadError);
        return res.status(500).json({ success: false, message: "Image upload failed: " + uploadError.message });
      }
    } else if (Array.isArray(req.body.productImages)) {
      data.productImages = req.body.productImages.filter(isKeepableImageValue);
    } else {
      data.productImages = [];
    }
    const product = await Product.create(data);
    await product.populate(["category", "brand"]);
    res.status(201).json(product);
  } catch (error) {
    console.error("Product creation error:", error);
    res.status(resolveProductErrorStatus(error)).json({ success: false, message: error.message });
  }
};

export const updateProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found" });

    const data = parseProductBody(req.body || {});
    const name = (data.productName ?? product.productName ?? "").toString().trim();
    if (!name) {
      return res.status(400).json({ success: false, message: "Product name is required" });
    }
    const sellingPrice = Number(data.sellingPrice ?? product.sellingPrice);
    const mrp = Number(data.mrp ?? product.mrp);
    const discountPercent = Number(data.discountPercent ?? product.discountPercent ?? 0);
    const gstPercent = Number(data.gstPercent ?? product.gstPercent ?? 0);
    const weight = Number(data.weight ?? product.weight);
    const pricingError = validatePricingFields({ mrp, sellingPrice, discountPercent, gstPercent });
    if (pricingError) {
      return res.status(400).json({ success: false, message: pricingError });
    }
    const weightError = validateWeightField(weight);
    if (weightError) {
      return res.status(400).json({ success: false, message: weightError });
    }
    data.weight = Math.round(weight * 100) / 100;
    data.discountPercent = normalizePercent(discountPercent, 100);
    data.gstMode = resolveGstMode({
      rawMode: req.body?.gstMode,
      gstPercent,
      fallbackMode: data.gstMode ?? product.gstMode,
    });
    data.gstPercent = data.gstMode === "include" ? normalizePercent(gstPercent) : 0;
    const catId = data.category ?? product.category;
    const brandId = data.brand ?? product.brand;
    if (!catId || !mongoose.Types.ObjectId.isValid(catId)) {
      return res.status(400).json({ success: false, message: "Category is required" });
    }
    if (!brandId || !mongoose.Types.ObjectId.isValid(brandId)) {
      return res.status(400).json({ success: false, message: "Brand is required" });
    }

    // Handle images: base = existingProductImages (if sent) or current, then add new files
    let baseImages = product.productImages || [];
    if (req.body?.existingProductImages) {
      try {
        const parsed = typeof req.body.existingProductImages === "string"
          ? JSON.parse(req.body.existingProductImages)
          : req.body.existingProductImages;
        baseImages = Array.isArray(parsed) ? parsed : baseImages;
      } catch {
        baseImages = product.productImages || [];
      }
    }
    baseImages = baseImages.filter(isKeepableImageValue);

    if (req.files?.length) {
      try {
        const newPaths = await uploadImagesToCloudinary(req.files, {
          folder: "lucent/products",
        });
        if (!newPaths || newPaths.length === 0) {
          return res.status(500).json({ success: false, message: "Failed to upload images to cloud storage" });
        }
        data.productImages = [...newPaths, ...baseImages].slice(0, 6);
      } catch (uploadError) {
        console.error("Image upload error:", uploadError);
        return res.status(500).json({ success: false, message: "Image upload failed: " + uploadError.message });
      }
    } else if (req.body?.existingProductImages !== undefined) {
      data.productImages = baseImages.slice(0, 6);
    }

    Object.assign(product, data);
    await product.save();
    await product.populate(["category", "brand"]);
    res.json(product);
  } catch (error) {
    console.error("Product update error:", error);
    res.status(resolveProductErrorStatus(error)).json({ success: false, message: error.message });
  }
};

// --------------------
// BULK IMPORT
// --------------------
const COL_MAP = {
  "product name": "productName",
  "productname": "productName",
  "name": "productName",
  "mrp": "mrp",
  "selling price": "sellingPrice",
  "sellingprice": "sellingPrice",
  "price": "sellingPrice",
  "composition": "composition",
  "ingredients": "ingredients",
  "key uses": "keyUses",
  "keyuses": "keyUses",
  "safety information": "safetyInformation",
  "safetyinformation": "safetyInformation",
  "manufacturer": "manufacturer",
  "category": "categoryName",
  "category name": "categoryName",
  "brand": "brandName",
  "brand name": "brandName",
  "discount": "discountPercent",
  "discount %": "discountPercent",
  "discountpercent": "discountPercent",
  "gst": "gstPercent",
  "gst %": "gstPercent",
  "gstpercent": "gstPercent",
  "gst mode": "gstMode",
  "gstmode": "gstMode",
  "hsn code": "hsnCode",
  "hsncode": "hsnCode",
  "batch number": "batchNumber",
  "batchnumber": "batchNumber",
  "expiry date": "expiryDate",
  "expirydate": "expiryDate",
  "stock": "stockQuantity",
  "stock qty": "stockQuantity",
  "stockquantity": "stockQuantity",
  "min stock": "minStockLevel",
  "minstocklevel": "minStockLevel",
  "min order": "minOrderQty",
  "minorderqty": "minOrderQty",
  "weight": "weight",
  "weight (kg)": "weight",
  "active": "isActive",
  "isactive": "isActive",
  "prescription required": "prescriptionRequired",
  "prescriptionrequired": "prescriptionRequired",
  "description text color": "descriptionTextColor",
  "descriptiontextcolor": "descriptionTextColor",
  "description bg color": "descriptionBgColor",
  "descriptionbgcolor": "descriptionBgColor",
  "ingredients text color": "ingredientsTextColor",
  "ingredientstextcolor": "ingredientsTextColor",
  "ingredients bg color": "ingredientsBgColor",
  "ingredientsbgcolor": "ingredientsBgColor",
  "key uses text color": "keyUsesTextColor",
  "keyusestextcolor": "keyUsesTextColor",
  "key uses bg color": "keyUsesBgColor",
  "keyusesbgcolor": "keyUsesBgColor",
  "safety text color": "safetyTextColor",
  "safetytextcolor": "safetyTextColor",
  "safety bg color": "safetyBgColor",
  "safetybgcolor": "safetyBgColor",
};

const toNum = (v) => {
  if (v === "" || v == null) return undefined;
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return isNaN(n) ? undefined : n;
};

const toBool = (v) => {
  if (v === "" || v == null) return undefined;
  const s = String(v).toLowerCase().trim();
  if (["true", "1", "yes", "y"].includes(s)) return true;
  if (["false", "0", "no", "n"].includes(s)) return false;
  return undefined;
};

export const bulkImportProducts = async (req, res) => {
  try {
    const { products } = req.body;
    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No products to import. Send { products: [...] }",
      });
    }

    const categories = await Category.find();
    const brands = await Brand.find();
    const catByName = Object.fromEntries(categories.map((c) => [String(c.name).toLowerCase().trim(), c._id]));
    const brandByName = Object.fromEntries(brands.map((b) => [String(b.name).toLowerCase().trim(), b._id]));

    const created = [];
    const errors = [];

    for (let i = 0; i < products.length; i++) {
      const row = products[i];
      try {
        const obj = {};
        for (const [key, val] of Object.entries(row)) {
          const k = COL_MAP[String(key).toLowerCase().trim()] || key;
          obj[k] = val;
        }

        const productName = (obj.productName || obj.name || "").toString().trim();
        if (!productName) {
          errors.push({ row: i + 1, message: "Product name is required" });
          continue;
        }

        const mrp = toNum(obj.mrp);
        const sellingPrice = toNum(obj.sellingPrice) ?? toNum(obj.price);
        if (mrp == null || mrp < 0) {
          errors.push({ row: i + 1, message: "Valid MRP is required" });
          continue;
        }
        if (sellingPrice == null || sellingPrice < 0) {
          errors.push({ row: i + 1, message: "Valid Selling Price is required" });
          continue;
        }
        if (sellingPrice > mrp) {
          errors.push({ row: i + 1, message: "Selling Price cannot be greater than MRP" });
          continue;
        }

        const discountPercent = normalizePercent(toNum(obj.discountPercent) ?? 0, 100);
        const gstMode = resolveGstMode({ rawMode: obj.gstMode, gstPercent: toNum(obj.gstPercent) ?? 0 });
        const gstPercent = gstMode === "include" ? normalizePercent(toNum(obj.gstPercent) ?? 0) : 0;
        const weight = toNum(obj.weight);

        if (weight == null || weight <= 0) {
          errors.push({ row: i + 1, message: "Valid product weight (> 0 kg) is required" });
          continue;
        }

        let categoryId = obj.category;
        if (obj.categoryName && !categoryId) {
          categoryId = catByName[String(obj.categoryName).toLowerCase().trim()] || null;
        }
        if (typeof categoryId === "string" && !mongoose.Types.ObjectId.isValid(categoryId)) categoryId = null;

        let brandId = obj.brand;
        if (obj.brandName && !brandId) {
          brandId = brandByName[String(obj.brandName).toLowerCase().trim()] || null;
        }
        if (typeof brandId === "string" && !mongoose.Types.ObjectId.isValid(brandId)) brandId = null;

        const product = await Product.create({
          productName,
          mrp,
          sellingPrice,
          composition: (obj.composition || "").toString().trim() || undefined,
          ingredients: (obj.ingredients || "").toString().trim() || undefined,
          keyUses: (obj.keyUses || "").toString().trim() || undefined,
          safetyInformation: (obj.safetyInformation || "").toString().trim() || undefined,
          descriptionTextColor: (obj.descriptionTextColor || "").toString().trim() || undefined,
          descriptionBgColor: (obj.descriptionBgColor || "").toString().trim() || undefined,
          ingredientsTextColor: (obj.ingredientsTextColor || "").toString().trim() || undefined,
          ingredientsBgColor: (obj.ingredientsBgColor || "").toString().trim() || undefined,
          keyUsesTextColor: (obj.keyUsesTextColor || "").toString().trim() || undefined,
          keyUsesBgColor: (obj.keyUsesBgColor || "").toString().trim() || undefined,
          safetyTextColor: (obj.safetyTextColor || "").toString().trim() || undefined,
          safetyBgColor: (obj.safetyBgColor || "").toString().trim() || undefined,
          manufacturer: (obj.manufacturer || "").toString().trim() || undefined,
          category: categoryId || undefined,
          brand: brandId || undefined,
          discountPercent,
          gstPercent,
          gstMode,
          hsnCode: (obj.hsnCode || "").toString().trim() || undefined,
          batchNumber: (obj.batchNumber || "").toString().trim() || undefined,
          expiryDate: obj.expiryDate ? new Date(obj.expiryDate) : undefined,
          stockQuantity: toNum(obj.stockQuantity) ?? 0,
          minStockLevel: toNum(obj.minStockLevel) ?? 0,
          minOrderQty: toNum(obj.minOrderQty) ?? 1,
          weight: Math.round(weight * 100) / 100,
          isActive: toBool(obj.isActive) ?? true,
          prescriptionRequired: toBool(obj.prescriptionRequired) ?? false,
          productImages: [],
        });

        created.push(product);
      } catch (err) {
        errors.push({ row: i + 1, message: err.message || "Failed to create product" });
      }
    }

    res.json({
      success: true,
      created: created.length,
      failed: errors.length,
      total: products.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || "Bulk import failed",
    });
  }
};
