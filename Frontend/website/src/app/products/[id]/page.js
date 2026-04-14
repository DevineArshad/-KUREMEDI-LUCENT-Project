"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import DOMPurify from "dompurify";
import {
  ArrowRight,
  BadgePercent,
  ChevronLeft,
  Heart,
  Minus,
  Plus,
  Share2,
  ShoppingCart,
  ShieldCheck,
  Star,
  Truck,
} from "lucide-react";
import { useAppContext } from "@/context/context";
import { getProductSlug, normalizeProduct, parseProductSlugOrId, slugify } from "@/utils/product";
import { showToast } from "@/utils/toast";

const isMongoId = (value) => typeof value === "string" && /^[a-f0-9]{24}$/i.test(value);

const formatMoney = (value) =>
  `₹${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export default function ProductDetailPage() {
  const params = useParams();
  const router = useRouter();
  const slugOrId = params?.id;
  const { getProductById, getProducts, addToCart, token, user, toggleWishlist, isInWishlist } = useAppContext();

  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [qty, setQty] = useState(1);
  const [activeImage, setActiveImage] = useState(0);
  const [similarProduct, setSimilarProducts] = useState([]);
  const [loadingSimilar, setLoadingSimilar] = useState(false);
  const similarScrollRef = useRef(null);

  useEffect(() => {
    if (!slugOrId) return;
    setLoading(true);

    const { id } = parseProductSlugOrId(slugOrId);
    const effectiveId = id || (isMongoId(slugOrId) ? slugOrId : null);

    if (effectiveId) {
      getProductById(effectiveId)
        .then((data) => {
          const normalized = normalizeProduct(data);
          setProduct(normalized);
          if (normalized?.minOrderQty) setQty(normalized.minOrderQty);
        })
        .finally(() => setLoading(false));
      return;
    }

    getProducts()
      .then((res) => {
        const list = Array.isArray(res) ? res : res?.data ?? [];
        const name = decodeURIComponent(slugOrId).replace(/-/g, " ");
        const found = list.find(
          (item) =>
            slugify(item.productName || item.name || "") === slugOrId ||
            getProductSlug(item) === slugOrId ||
            (item.productName || item.name || "").toLowerCase() === name.toLowerCase(),
        );
        const normalized = found ? normalizeProduct(found) : null;
        setProduct(normalized);
        if (normalized?.minOrderQty) setQty(normalized.minOrderQty);
      })
      .finally(() => setLoading(false));
  }, [slugOrId, getProductById, getProducts]);

  useEffect(() => {
    if (!product?.categoryName) return;
    setLoadingSimilar(true);
    getProducts({ category: product.categoryName })
      .then((res) => {
        const list = Array.isArray(res) ? res : res?.data ?? [];
        const similar = list
          .filter((item) => item._id !== product._id)
          .slice(0, 10)
          .map((item) => normalizeProduct(item));
        setSimilarProducts(similar);
      })
      .finally(() => setLoadingSimilar(false));
  }, [product?.categoryName, product?._id, getProducts]);

  if (loading || !product) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-4 animate-pulse">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-teal-100 border-t-teal-600" />
          <p className="font-medium text-gray-500">{loading ? "Fetching Details..." : "Product not found"}</p>
        </div>
      </div>
    );
  }

  const imageList = product.images?.length ? product.images : [product?.image].filter(Boolean);
  const minQty = product.minOrderQty ?? 1;
  const maxQty = Math.min(product.stockQuantity ?? 9999, 9999);
  const basePrice = Number(product.sellingPrice ?? product.price ?? 0);
  const mrpValue = Number(product.mrp ?? basePrice);
  const hasValidMrp = Number.isFinite(mrpValue) && mrpValue > 0;
  const discountPercent = Math.max(0, Math.min(100, Number(product.discountPercent || 0)));
  const discountAmount = (basePrice * discountPercent) / 100;
  const discountedPrice = Math.max(0, basePrice - discountAmount);
  const gstPercentValue = Math.max(0, Number(product.gstPercent || 0));
  const gstAmount = gstPercentValue > 0 ? (discountedPrice * gstPercentValue) / 100 : 0;
  const saveAmount = Math.max(0, basePrice - discountedPrice);
  const totalBeforeGst = Number(discountedPrice * qty).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const showDiscount = discountPercent > 0;
  const wished = isInWishlist?.(product._id);

  const descriptionHtml = DOMPurify.sanitize(String(product.description || product.composition || ""), {
    ALLOWED_TAGS: ["b", "strong", "i", "em", "u", "ul", "ol", "li", "p", "br"],
    ALLOWED_ATTR: [],
  });
  const ingredientsHtml = DOMPurify.sanitize(String(product.ingredients || product.composition || ""), {
    ALLOWED_TAGS: ["b", "strong", "i", "em", "u", "ul", "ol", "li", "p", "br"],
    ALLOWED_ATTR: [],
  });
  const keyUsesHtml = DOMPurify.sanitize(String(product.keyUses || ""), {
    ALLOWED_TAGS: ["b", "strong", "i", "em", "u", "ul", "ol", "li", "p", "br"],
    ALLOWED_ATTR: [],
  });
  const safetyHtml = DOMPurify.sanitize(String(product.safetyInformation || ""), {
    ALLOWED_TAGS: ["b", "strong", "i", "em", "u", "ul", "ol", "li", "p", "br"],
    ALLOWED_ATTR: [],
  });

  // ...existing code...

  const handleAddToCart = async () => {
    if (!token) return router.push("/login");
    if (user?.kyc !== "APPROVED") {
      showToast("Complete KYC verification to order.", "info", "KYC Required");
      return router.push("/profile");
    }
    try {
      await addToCart(product._id, qty);
      showToast("Added to cart");
      router.push("/cart");
    } catch (err) {
      showToast(err?.message || "Could not add to cart.", "error");
    }
  };

  const handleBuyNow = async () => {
    if (!token) return router.push("/login");
    if (user?.kyc !== "APPROVED") {
      showToast("Complete KYC verification to order.", "info", "KYC Required");
      return router.push("/profile");
    }
    try {
      await addToCart(product._id, qty);
      router.push("/checkout");
    } catch (err) {
      showToast(err?.message || "Could not proceed to checkout.", "error");
    }
  };

  const handleShare = async () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    const shareData = {
      title: product?.name || "Product",
      text: product?.name ? `${product.name} - ${formatMoney(basePrice)}` : undefined,
      url,
    };

    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share(shareData);
        showToast("Shared successfully");
        return;
      } catch (error) {
        if (error?.name !== "AbortError" && navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(url || "").then(() => showToast("Link copied to clipboard"));
          return;
        }
      }
    }

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url || "").then(() => showToast("Link copied to clipboard"));
    } else {
      showToast("Share not supported on this device");
    }
  };

  const handleDecreaseQty = () => {
    if (qty <= minQty) {
      showToast(`Minimum buy quantity is ${minQty} unit${minQty > 1 ? "s" : ""}.`, "info");
      return;
    }
    setQty(Math.max(minQty, qty - 1));
  };

  const handleIncreaseQty = () => {
    if (qty >= maxQty) {
      showToast(`Only ${maxQty} stock quantity are present.`, "error");
      return;
    }
    setQty(Math.min(maxQty, qty + 1));
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,#f8fafc_0%,#eef6ff_38%,#ffffff_100%)]">
      <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-3">
          <button
            onClick={() => router.back()}
            className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-slate-600 transition hover:text-blue-600"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8">
        {(product.stockQuantity ?? 0) > 0 && (product.stockQuantity ?? 0) <= 20 && (
          <div className="mb-5 rounded-2xl border border-amber-300 bg-amber-100 px-4 py-3 text-sm font-bold text-amber-900">
            Only {product.stockQuantity} product left in stock
          </div>
        )}

        <div className="grid gap-8 xl:grid-cols-[1.05fr_1.15fr]">
          <section className="space-y-4">
            <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-[0_18px_55px_rgba(15,23,42,0.08)] md:p-6">
              <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-slate-50 p-4 md:p-8">
                <button
                  onClick={handleShare}
                  className="absolute left-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:text-blue-600"
                  aria-label="Share product"
                >
                  <Share2 className="h-4 w-4" />
                </button>
                <button
                  onClick={() => toggleWishlist?.(product)}
                  className={`absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full border bg-white shadow-sm transition ${wished ? "border-pink-300 text-pink-600" : "border-slate-200 text-slate-500 hover:text-pink-600"}`}
                  aria-label="Wishlist"
                >
                  <Heart className={`h-4 w-4 ${wished ? "fill-pink-500" : ""}`} />
                </button>

                <div className="flex min-h-96 items-center justify-center">
                  <img
                    src={imageList[activeImage] || "https://placehold.co/700?text=No+Image"}
                    alt={product.name}
                    className="max-h-96 w-full object-contain transition-transform duration-300 hover:scale-[1.03]"
                    onError={(event) => {
                      event.currentTarget.onerror = null;
                      event.currentTarget.src = "https://placehold.co/700?text=No+Image";
                    }}
                  />
                </div>
              </div>

              {imageList.length > 1 && (
                <div className="mt-4 flex gap-3 overflow-x-auto pb-1">
                  {imageList.map((img, index) => (
                    <button
                      key={index}
                      onClick={() => setActiveImage(index)}
                      className={`shrink-0 rounded-2xl border bg-white p-2 transition ${activeImage === index ? "border-blue-500 shadow-md" : "border-slate-200 hover:border-slate-300"}`}
                    >
                      <img
                        src={img}
                        alt="thumb"
                        className="h-16 w-16 object-contain"
                        onError={(event) => {
                          event.currentTarget.onerror = null;
                          event.currentTarget.src = "https://placehold.co/120?text=No+Image";
                        }}
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50/80 p-4">
                <div className="flex items-center gap-3">
                  <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-600" />
                  <div>
                    <p className="text-sm font-bold text-emerald-700">100% Genuine Medicines</p>
                    <p className="text-xs text-emerald-600">Quality verified products</p>
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-sky-100 bg-sky-50/80 p-4">
                <div className="flex items-center gap-3">
                  <Truck className="h-5 w-5 shrink-0 text-sky-600" />
                  <div>
                    <p className="text-sm font-bold text-sky-700">Fast Delivery</p>
                    <p className="text-xs text-sky-600">Delivery support at checkout</p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-6">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_18px_55px_rgba(15,23,42,0.08)] md:p-7">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                  <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
                  Highly rated
                </span>
                {product.hsnCode && (
                  <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                    HSN {product.hsnCode}
                  </span>
                )}
              </div>

              <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 md:text-4xl">{product.name}</h1>
              {product.brand && (
                <Link href={`/brands/${slugify(product.brand)}`} className="mt-2 inline-flex text-sm font-semibold text-blue-700 hover:underline">
                  {product.brand}
                </Link>
              )}

              <div className="mt-2 text-sm text-slate-500">{product.packSize || product.unit || ""}</div>

              <div className="mt-5 rounded-3xl border border-slate-200 bg-linear-to-br from-white to-slate-50 p-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">MRP</p>
                    <p className="mt-1 text-2xl font-black text-slate-900">{formatMoney(hasValidMrp ? mrpValue : basePrice)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Selling Price</p>
                    <p className={`mt-1 text-2xl font-black text-slate-500 ${showDiscount ? "line-through" : ""}`}>
                      {formatMoney(basePrice)}
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-bold text-emerald-700">
                    <BadgePercent className="h-4 w-4" />
                    {discountPercent.toFixed(0)}% OFF
                  </div>
                  <p className="text-sm text-slate-500">Save {formatMoney(saveAmount)} from selling price</p>
                </div>

                <div className="mt-4 border-t border-slate-200 pt-4">
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Discounted Price</p>
                  <p className="mt-1 text-3xl font-black text-emerald-700">{formatMoney(discountedPrice)}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    GST {gstPercentValue > 0 ? `(${gstPercentValue.toFixed(2)}%)` : ""} is added at checkout billing.
                  </p>
                </div>
              </div>

              <div className="mt-5 flex flex-col gap-4 sm:flex-row">
                <div className="flex items-center rounded-full border border-slate-200 bg-white px-3 py-2 shadow-sm">
                  <button
                    onClick={handleDecreaseQty}
                    className={`rounded-full px-3 py-2 text-slate-500 transition hover:bg-slate-100 ${qty <= minQty ? "opacity-40" : ""}`}
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="min-w-14 px-3 text-center text-lg font-bold text-slate-900">{qty}</span>
                  <button
                    onClick={handleIncreaseQty}
                    className={`rounded-full px-3 py-2 text-slate-500 transition hover:bg-slate-100 ${qty >= maxQty ? "opacity-40" : ""}`}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>

                <button
                  onClick={handleAddToCart}
                  disabled={(product.stockQuantity ?? 0) <= 0}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-linear-to-r from-blue-600 to-cyan-500 px-6 py-3.5 text-base font-bold text-white shadow-lg shadow-blue-100 transition hover:from-blue-700 hover:to-cyan-600 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  <ShoppingCart className="h-5 w-5" />
                  {(product.stockQuantity ?? 0) <= 0 ? "Out of Stock" : "Add to Cart"}
                </button>

                <button
                  onClick={handleBuyNow}
                  disabled={(product.stockQuantity ?? 0) <= 0}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-amber-400 px-6 py-3.5 text-base font-bold text-slate-900 shadow-lg shadow-amber-100 transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:bg-amber-200"
                >
                  Buy Now
                  <ArrowRight className="h-5 w-5" />
                </button>
              </div>

              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Total before GST</p>
                    <p className="mt-1 text-2xl font-black text-slate-900">₹{totalBeforeGst}</p>
                  </div>
                  <div className="text-right text-xs text-slate-500">GST will be applied at billing/checkout</div>
                </div>
              </div>
            </div>

          </section>
        </div>

        <section className="mx-auto mt-8 grid max-w-6xl gap-6 md:grid-cols-2">
          <div id="description" className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_18px_55px_rgba(15,23,42,0.08)] md:p-7">
            <h2 className="text-lg font-bold text-slate-900">Product Description</h2>
            <div className="mt-3 text-sm leading-6 text-slate-700">
              {product.description ? (
                <div className="space-y-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5" dangerouslySetInnerHTML={{ __html: descriptionHtml }} />
              ) : (
                <p>No description available for this product.</p>
              )}
            </div>
            <div className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">
              GST on this product: {gstPercentValue.toFixed(2)}%
            </div>
            {product.expiryDate && (
              <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">
                Expiry Date: {new Date(product.expiryDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
              </div>
            )}
          </div>

          <div id="ingredients" className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_18px_55px_rgba(15,23,42,0.08)] md:p-7">
            <h2 className="text-lg font-bold text-slate-900">Ingredients</h2>
            <div className="mt-3 text-sm text-slate-700">
              {product.ingredients ? (
                <span dangerouslySetInnerHTML={{ __html: ingredientsHtml }} />
              ) : product.composition ? (
                <span>{product.composition}</span>
              ) : (
                <span>Composition details are available in the product description above.</span>
              )}
            </div>
          </div>

          <div id="key-uses" className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_18px_55px_rgba(15,23,42,0.08)] md:p-7">
            <h2 className="text-lg font-bold text-slate-900">Key Uses</h2>
            <div className="mt-3 text-sm leading-6 text-slate-700">
              {product.keyUses ? (
                <div className="space-y-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5" dangerouslySetInnerHTML={{ __html: keyUsesHtml }} />
              ) : (
                <ul className="list-disc space-y-2 pl-5">
                  <li>Use as directed on the label or by your healthcare provider.</li>
                  <li>Check pack information for product-specific instructions.</li>
                  <li>Keep out of reach of children.</li>
                </ul>
              )}
            </div>
          </div>

          <div id="safety" className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_18px_55px_rgba(15,23,42,0.08)] md:p-7">
            <h2 className="text-lg font-bold text-slate-900">Safety Information</h2>
            <div className="mt-3 text-sm leading-6 text-slate-700">
              {product.safetyInformation ? (
                <div className="space-y-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5" dangerouslySetInnerHTML={{ __html: safetyHtml }} />
              ) : (
                <p>Store in a cool, dry place and follow all product warnings. If you experience side effects, contact a healthcare professional.</p>
              )}
            </div>
          </div>
        </section>

        {loadingSimilar ? (
          <div className="mt-16 rounded-3xl border border-slate-200 bg-white p-6 text-slate-500 shadow-sm">
            Loading similar products...
          </div>
        ) : similarProduct.length > 0 ? (
          <section className="mt-16">
            <h2 className="mb-6 text-2xl font-bold text-slate-900">Similar Products</h2>
            <div ref={similarScrollRef} className="flex gap-6 overflow-x-auto pb-6 no-scrollbar scroll-smooth">
              {similarProduct.map((item) => (
                <Link
                  key={item._id}
                  href={`/products/${getProductSlug(item)}`}
                  className="w-56 shrink-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
                >
                  <div className="mb-4 flex h-40 w-full items-center justify-center rounded-2xl bg-slate-50">
                    <img src={item.image} alt={item.name} className="max-h-full max-w-full object-contain" />
                  </div>
                  <p className="mb-2 text-lg font-bold text-emerald-700">₹{item.price}</p>
                  <h3 className="mb-3 min-h-10 text-sm font-semibold text-slate-800 line-clamp-2">{item.name}</h3>
                  <button
                    onClick={(event) => {
                      event.preventDefault();
                      addToCart(item._id, item.minOrderQty || 1);
                    }}
                    className="w-full rounded-xl border border-blue-100 bg-blue-50 py-2 text-xs font-semibold uppercase text-blue-700 transition hover:bg-blue-600 hover:text-white"
                  >
                    Quick Add
                  </button>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}