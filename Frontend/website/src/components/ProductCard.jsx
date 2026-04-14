"use client";

import React from "react";
import { Heart, Plus, Minus } from "lucide-react";
import Link from "next/link";
import { getProductSlug } from "@/utils/product";

const formatMoney = (value) =>
  `₹${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const htmlToPlainText = (value) =>
  String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();

export const ProductCard = ({
  product,
  cartItem,
  wished,
  onAdd,
  onUpdateQty,
  onToggleWishlist,
  imageUrl,
  showBadge = false,
  badgeText = "",
}) => {
  const outOfStock = (product.stockQuantity ?? 1) <= 0;
  const lowStock = Number(product.stockQuantity ?? 0) > 0 && Number(product.stockQuantity ?? 0) <= 20;

  return (
    <div className="relative border border-gray-100 rounded-2xl p-4 bg-white hover:shadow-lg transition-shadow h-full flex flex-col">
      {/* Wishlist Button */}
      <button
        onClick={() => onToggleWishlist?.(product)}
        className={`absolute top-4 right-4 p-1.5 rounded-full z-10 transition-colors ${
          wished
            ? "bg-red-50 text-red-500"
            : "bg-gray-50 text-gray-400 hover:text-red-500 hover:bg-red-50"
        }`}
      >
        <Heart className={`w-4 h-4 ${wished ? "fill-current" : ""}`} />
      </button>

      {/* Discount Badge */}
      {showBadge && badgeText && (
        <div className="absolute top-4 left-4 bg-red-500 text-white px-3 py-1 rounded-full text-xs font-bold z-10">
          {badgeText}
        </div>
      )}

      {/* Product Image */}
      <Link href={`/products/${getProductSlug(product)}`}>
        <div className="h-32 md:h-40 w-full flex items-center justify-center mb-4 rounded-xl overflow-hidden bg-gray-50">
          <img
            src={imageUrl || "https://placehold.co/200x150?text=No+Image"}
            alt={product.productName || product.name}
            className="max-h-full max-w-full object-contain"
            onError={(event) => {
              event.currentTarget.onerror = null;
              event.currentTarget.src = "https://placehold.co/200x150?text=No+Image";
            }}
          />
        </div>
      </Link>

      {/* Product Info */}
      <div className="space-y-2 grow">
        <div className="flex items-baseline justify-between">
          <span className="text-teal-700 font-bold text-lg">
            {formatMoney(product.sellingPrice || product.price)}
          </span>
          {product.packSize && (
            <span className="text-[10px] text-gray-400 font-medium">
              {product.packSize}
            </span>
          )}
        </div>

        <h3 className="text-sm font-semibold text-gray-700 line-clamp-2 min-h-10">
          {product.productName || product.name}
        </h3>

        {lowStock && (
          <p className="text-[11px] font-semibold text-amber-700">Only {product.stockQuantity} left</p>
        )}

        {product.description && (
          <p className="text-xs text-gray-500 line-clamp-1">
            {htmlToPlainText(product.description)}
          </p>
        )}

        {product.discountPercent > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-400 line-through">
              {formatMoney(
                (product.sellingPrice || product.price) /
                  (1 - product.discountPercent / 100)
              )}
            </span>
            <span className="text-green-600 font-bold">
              {product.discountPercent}% off
            </span>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="mt-4">
        {cartItem ? (
          <div className="flex items-center justify-between bg-teal-50 rounded-xl border border-teal-200 p-1">
            <button
              onClick={() =>
                onUpdateQty?.(
                  product._id,
                  cartItem.qty - (product.minOrderQty || 1)
                )
              }
              className="p-1.5 text-teal-700 hover:bg-white rounded-lg transition-colors"
            >
              <Minus className="w-4 h-4" />
            </button>
            <span className="font-bold text-teal-800 text-sm">{cartItem.qty}</span>
            <button
              onClick={() =>
                onUpdateQty?.(
                  product._id,
                  cartItem.qty +
                    (product.minOrderQty || 1)
                )
              }
              disabled={cartItem.qty >= product.stockQuantity}
              className="p-1.5 text-teal-700 hover:bg-white rounded-lg transition-colors disabled:opacity-30"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => onAdd?.(product)}
            disabled={outOfStock}
            className={`w-full py-2.5 rounded-xl font-bold text-xs tracking-widest uppercase transition-all ${
              outOfStock
                ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                : "bg-teal-50 text-teal-700 border border-teal-200 hover:bg-teal-700 hover:text-white"
            }`}
          >
            {outOfStock ? "Out of Stock" : "Add to Cart"}
          </button>
        )}
      </div>
    </div>
  );
};
