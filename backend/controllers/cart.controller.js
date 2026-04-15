import Cart from "../model/Cart.js";
import Product from "../model/Product.js";
import { calculateLinePricing } from "../utils/pricing.js";

const FALLBACK_ITEM_WEIGHT_KG = 0.5;

const resolveItemWeight = (weight) => {
  const numeric = Number(weight);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.round(numeric * 100) / 100;
  }
  return FALLBACK_ITEM_WEIGHT_KG;
};

/**
 * ADD TO CART
 * POST /api/cart/add
 * Body: { productId: string, quantity?: number }
 */
export const addToCart = async (req, res) => {
  try {
    const { productId, quantity } = req.body || {};

    if (!productId)
      return res.status(400).json({ success: false, message: "productId is required" });

    const qty = Number(quantity ?? 1);
    if (!Number.isInteger(qty) || qty < 1)
      return res.status(400).json({
        success: false,
        message: "Quantity must be a positive integer",
      });

    const product = await Product.findById(productId);
    if (!product || !product.isActive)
      return res.status(404).json({ success: false, message: "Product not found" });

    let cart = await Cart.findOne({ user: req.user._id });

    if (!cart) {
      if (qty > product.stockQuantity) {
        return res.status(400).json({
          success: false,
          message: `Only ${product.stockQuantity} stock quantity are present.`,
        });
      }
      cart = await Cart.create({
        user: req.user._id,
        items: [{ product: productId, quantity: qty, weight: resolveItemWeight(product.weight) }],
      });
    } else {
      const itemIndex = cart.items.findIndex(
        (i) => i.product.toString() === productId,
      );

      if (itemIndex > -1) {
        const nextQty = cart.items[itemIndex].quantity + qty;
        if (nextQty > product.stockQuantity) {
          return res.status(400).json({
            success: false,
            message: `Only ${product.stockQuantity} stock quantity are present.`,
          });
        }
        cart.items[itemIndex].quantity = nextQty;
        cart.items[itemIndex].weight = resolveItemWeight(product.weight);
      } else {
        if (qty > product.stockQuantity) {
          return res.status(400).json({
            success: false,
            message: `Only ${product.stockQuantity} stock quantity are present.`,
          });
        }
        cart.items.push({
          product: productId,
          quantity: qty,
          weight: resolveItemWeight(product.weight),
        });
      }

      await cart.save();
    }

    const cartPopulated = await Cart.findById(cart._id).populate("items.product");
    
    // Warn if stock is low
    const warning = product.stockQuantity <= product.minStockLevel
      ? `Low stock warning: Only ${product.stockQuantity} items remaining`
      : null;
    
    res.json({
      success: true,
      message: "Added to cart",
      warning,
      cart: cartPopulated || cart,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * GET MY CART
 * GET /api/cart
 */
export const getMyCart = async (req, res) => {
  try {
    const cart = await Cart.findOne({ user: req.user._id }).populate(
      "items.product",
      "productName name mrp sellingPrice discountPercent gstPercent gstMode stockQuantity minOrderQty productImages isActive weight"
    );

    if (!cart) return res.json({ success: true, items: [] });

    let cartChanged = false;
    const normalizedItems = [];

    for (const item of cart.items || []) {
      const product = item?.product;
      const currentQty = Number(item?.quantity || 0);

      if (!product || !product._id || !product.isActive) {
        cartChanged = true;
        continue;
      }

      const availableStock = Number(product.stockQuantity ?? 0);
      if (availableStock <= 0) {
        cartChanged = true;
        continue;
      }

      const clampedQty = Math.max(1, Math.min(currentQty, availableStock));
      if (clampedQty !== currentQty) {
        cartChanged = true;
      }

      normalizedItems.push({
        product: product._id,
        quantity: clampedQty,
        weight: resolveItemWeight(product.weight ?? item.weight),
      });
    }

    if (cartChanged) {
      cart.items = normalizedItems;
      await cart.save();
      await cart.populate(
        "items.product",
        "productName name mrp sellingPrice discountPercent gstPercent gstMode stockQuantity minOrderQty productImages isActive weight",
      );
    }

    const cartObj = cart.toObject();
    cartObj.items = (cartObj.items || []).map((item) => {
      if (!item?.product) return item;
      const pricing = calculateLinePricing(
        {
          sellingPrice: item.product.sellingPrice,
          discountPercent: item.product.discountPercent,
          gstPercent: item.product.gstPercent,
          gstMode: item.product.gstMode,
        },
        item.quantity || 1,
      );
      return {
        ...item,
        pricing,
        product: {
          ...item.product,
          finalSellingPrice: pricing.finalSellingPrice,
          discountedSellingPrice: pricing.discountedSellingPrice,
          gstAmount: pricing.gstAmount,
          price: pricing.finalSellingPrice,
        },
        weight: resolveItemWeight(item.weight ?? item.product.weight),
      };
    });

    res.json({ success: true, ...cartObj });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * UPDATE QUANTITY
 * PUT /api/cart/update
 */
export const updateCartQty = async (req, res) => {
  try {
    const { productId, quantity } = req.body;
    const qty = Number(quantity);

    if (!productId || Number.isNaN(qty))
      return res.status(400).json({ message: "productId & quantity required" });

    if (!Number.isInteger(qty) || qty < 1) {
      return res.status(400).json({ message: "Quantity must be a positive integer" });
    }

    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart) return res.status(404).json({ message: "Cart not found" });

    const item = cart.items.find((i) => i.product.toString() === productId);

    if (!item)
      return res.status(404).json({ message: "Item not found in cart" });

    // Validate quantity against stock
    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ message: "Product not found" });

    if (qty > product.stockQuantity) {
      return res.status(400).json({
        message: `Only ${product.stockQuantity} stock quantity are present.`,
      });
    }

    item.quantity = qty;

    await cart.save();

    // Warn if stock is low
    const warning = product.stockQuantity <= product.minStockLevel
      ? `Low stock warning: Only ${product.stockQuantity} items remaining`
      : null;

    res.json({ message: "Quantity updated", warning, cart });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * REMOVE ITEM
 * DELETE /api/cart/remove/:productId
 */
export const removeFromCart = async (req, res) => {
  try {
    const { productId } = req.params;

    if (!productId)
      return res.status(400).json({ success: false, message: "productId is required" });

    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart) return res.status(404).json({ success: false, message: "Cart not found" });

    cart.items = cart.items.filter((i) => i.product.toString() !== productId);

    await cart.save();

    const cartPopulated = await Cart.findById(cart._id).populate("items.product");
    res.json({ success: true, message: "Removed from cart", cart: cartPopulated || cart });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * CLEAR CART
 * DELETE /api/cart/clear
 */
export const clearCart = async (req, res) => {
  try {
    await Cart.findOneAndUpdate({ user: req.user._id }, { items: [] });

    res.json({ success: true, message: "Cart cleared" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};
