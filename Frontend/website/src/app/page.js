"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Heart,
  ChevronRight,
  ChevronLeft,
  Plus,
  Minus,
  Search,
  FlaskConical,
  Stethoscope,
  Pill,
  ShieldPlus,
  BookOpenText,
  BadgePercent,
} from "lucide-react";
import { useAppContext } from "@/context/context";
import { KycBanner } from "@/components/KycBanner";
import { ProductCard } from "@/components/ProductCard";
import { getProductSlug, getCategorySlug, getBrandSlug } from "@/utils/product";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { showToast } from "@/utils/toast";
import Image from "next/image";

import {
  SkeletonBanner,
  SkeletonSectionTitle,
  SkeletonCategoryRow,
  SkeletonBrandRow,
  SkeletonProductRow,
} from "@/components/Skeleton";

const FALLBACK_BANNERS = [
  {
    image: "/banners/medicine-banner-1.svg",
    redirectUrl: "",
    ctaText: "Shop now",
    title: "Trusted medicines, delivered fast",
    subtitle: "Smart pricing for pharmacies and clinics",
    textColor: "#ffffff",
    subtitleColor: "#e2e8f0",
    buttonColor: "#0f172a",
  },
  {
    image: "/banners/medicine-banner-2.svg",
    redirectUrl: "",
    ctaText: "Shop now",
    title: "Bulk health essentials in one place",
    subtitle: "Top brands with reliable availability",
    textColor: "#ffffff",
    subtitleColor: "#e2e8f0",
    buttonColor: "#0f172a",
  },
  {
    image: "/banners/medicine-banner-3.svg",
    redirectUrl: "",
    ctaText: "Shop now",
    title: "Better stock, better margins",
    subtitle: "Explore seasonal offers on daily movers",
    textColor: "#ffffff",
    subtitleColor: "#e2e8f0",
    buttonColor: "#0f172a",
  },
];

const dedupeBrands = (list) => {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const result = [];

  for (const brand of list) {
    const idKey = String(brand?._id || "").trim();
    const nameKey = String(brand?.name || "").trim().toLowerCase();
    const logoKey = String(brand?.logo || "").trim().toLowerCase();
    const key = idKey || `${nameKey}|${logoKey}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(brand);
  }

  return result;
};

const HomePage = () => {
  const router = useRouter();
  const {
    getCategories,
    getImageUrl,
    getBrands,
    getMarketingBanners,
    getBrandImageUrl,
    getProducts,
    getProductImageUrl,
    addToCart,
    updateCartQty,
    cartItems,
    toggleWishlist,
    isInWishlist,
    token,
    user,
  } = useAppContext();

  const [categories, setCategories] = useState([]);
  const [brands, setBrands] = useState([]);
  const [products, setProducts] = useState([]);
  const [bannerSlides, setBannerSlides] = useState(FALLBACK_BANNERS);
  const [bannerIndex, setBannerIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [isBrandsHovered, setIsBrandsHovered] = useState(false);

  const bestSelling = useMemo(() => {
    return [...(products || [])].sort((a, b) => {
      const dA = a.discountPercent ?? 0;
      const dB = b.discountPercent ?? 0;
      if (dB !== dA) return dB - dA;
      return (b.sellingPrice ?? b.price ?? 0) - (a.sellingPrice ?? a.price ?? 0);
    });
  }, [products]);

  const newArrivals = useMemo(() => {
    return [...(products || [])].sort((a, b) => {
      const tA = new Date(a.createdAt ?? 0).getTime();
      const tB = new Date(b.createdAt ?? 0).getTime();
      return tB - tA;
    });
  }, [products]);

  const healthEssentials = useMemo(() => {
    return [...(products || [])].sort((a, b) => {
      const stockA = a.stockQuantity ?? 0;
      const stockB = b.stockQuantity ?? 0;
      if (stockA !== stockB) return stockB - stockA;
      return ((a.productName || a.name) ?? "").localeCompare((b.productName || b.name) ?? "");
    });
  }, [products]);

  const searchMatches = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) return [];

    return [...(products || [])]
      .filter((product) => {
        const productName = (product.productName || product.name || "").toLowerCase();
        return productName.includes(query);
      })
      .slice(0, 6);
  }, [products, searchText]);

  const brandLoop = useMemo(() => {
    if (!Array.isArray(brands) || brands.length === 0) return [];
    if (brands.length <= 3) return brands;
    return [...brands, ...brands];
  }, [brands]);

  const shouldAnimateBrands = brandLoop.length > brands.length;

  // Auto-slide Hero Banner
  useEffect(() => {
    if (!bannerSlides.length) return;
    const t = setInterval(() => {
      setBannerIndex((i) => (i + 1) % bannerSlides.length);
    }, 4000);
    return () => clearInterval(t);
  }, [bannerSlides.length]);

  useEffect(() => {
    if (!bannerSlides.length) return;
    setBannerIndex((prev) => (prev >= bannerSlides.length ? 0 : prev));
  }, [bannerSlides.length]);

  // Fetch Data
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const [catRes, brandRes, prodRes, bannerRes] = await Promise.all([
          getCategories(),
          getBrands(),
          getProducts(),
          getMarketingBanners(),
        ]);
        const categoriesList = Array.isArray(catRes?.data)
          ? catRes.data
          : Array.isArray(catRes)
            ? catRes
            : [];
        const brandsList = Array.isArray(brandRes?.data)
          ? brandRes.data
          : Array.isArray(brandRes)
            ? brandRes
            : [];
        const productsList = Array.isArray(prodRes?.data)
          ? prodRes.data
          : Array.isArray(prodRes)
            ? prodRes
            : [];

        setCategories(categoriesList);
        setBrands(dedupeBrands(brandsList));
        setProducts(productsList);

        const activeBanners = Array.isArray(bannerRes?.data)
          ? bannerRes.data
              .map((b) => {
                const image = getImageUrl(b?.image);
                if (!image) return null;
                return {
                  image,
                  redirectUrl: String(b?.redirectUrl || "").trim(),
                  ctaText: String(b?.ctaText || "Shop now").trim() || "Shop now",
                  title: String(b?.title || "").trim(),
                  subtitle: String(b?.subtitle || "").trim(),
                  textColor: String(b?.textColor || "#ffffff").trim() || "#ffffff",
                  subtitleColor: String(b?.subtitleColor || "#e2e8f0").trim() || "#e2e8f0",
                  buttonColor: String(b?.buttonColor || "#0f172a").trim() || "#0f172a",
                };
              })
              .filter(Boolean)
          : [];
        setBannerSlides(activeBanners.length ? activeBanners : FALLBACK_BANNERS);
      } catch (err) {
        console.error("Data load error", err);
        setBannerSlides(FALLBACK_BANNERS);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [getCategories, getBrands, getProducts, getMarketingBanners, getImageUrl]);

  if (loading) {
    return (
      <div className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-10 bg-white min-h-screen">
        <section className="text-center py-2">
          <div className="flex justify-center">
            <h1 className="text-2xl md:text-3xl font-bold text-teal-800 tracking-tight">Scaleten</h1>
          </div>
          <p className="text-sm text-gray-600 mt-1">Pharmaceutical Excellence — Your trusted partner</p>
        </section>
        <SkeletonBanner />
        <section><SkeletonSectionTitle /><SkeletonCategoryRow count={8} /></section>
        <section><SkeletonSectionTitle /><SkeletonBrandRow count={4} /></section>
        <section className="pb-8"><SkeletonSectionTitle /><SkeletonProductRow count={5} /></section>
      </div>
    );
  }

  const handleQuickSearch = (e) => {
    e.preventDefault();
    const q = searchText.trim();
    if (!q) return;
    router.push(`/search?q=${encodeURIComponent(q)}`);
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#ecfdf5_0%,#ffffff_42%,#eff6ff_100%)]">
      <div className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-10">


      {/* 2. HERO BANNER */}
      <section className="relative w-full h-44 md:h-80 rounded-3xl overflow-hidden shadow-[0_18px_50px_rgba(59,130,246,0.12)] ring-1 ring-sky-100">
        {bannerSlides.map((slide, i) => {
          const isActiveSlide = bannerIndex === i;
          const hasRedirect = !!slide?.redirectUrl;
          return (
            <div
              key={`${slide.image}-${i}`}
              className={`absolute inset-0 transition-opacity duration-1000 ${isActiveSlide ? "opacity-100 z-10" : "opacity-0 z-0"}`}
            >
              <Image
                src={slide.image}
                alt={`Banner ${i + 1}`}
                fill
                unoptimized
                priority={i === 0}
                sizes="(max-width: 768px) 100vw, 1200px"
                className="h-full w-full object-cover"
              />

              <div className="pointer-events-none absolute inset-0 z-10 bg-linear-to-r from-slate-950/60 via-slate-900/30 to-transparent" />
              <div className="pointer-events-none absolute inset-x-0 top-0 z-20 p-4 md:p-8">
                {slide.title ? (
                  <p
                    className="max-w-2xl text-xl font-black leading-tight md:text-4xl"
                    style={{ color: slide.textColor || "#ffffff" }}
                  >
                    {slide.title}
                  </p>
                ) : null}
                {slide.subtitle ? (
                  <p
                    className="mt-2 max-w-2xl text-sm font-medium md:text-base"
                    style={{ color: slide.subtitleColor || "#e2e8f0" }}
                  >
                    {slide.subtitle}
                  </p>
                ) : null}
              </div>

              {hasRedirect ? (
                <Link
                  href={slide.redirectUrl}
                  className="absolute inset-0 z-20 flex items-end p-4 md:p-6"
                  aria-label={`Open banner ${i + 1}`}
                >
                  <span
                    className="inline-flex items-center rounded-full px-4 py-2 text-xs font-bold uppercase tracking-[0.12em] text-white shadow-lg transition hover:brightness-110 md:text-sm"
                    style={{ backgroundColor: slide.buttonColor || "#0f172a" }}
                  >
                    {slide.ctaText || "Shop now"}
                  </span>
                </Link>
              ) : null}
            </div>
          );
        })}
        <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-2 z-20">
          {bannerSlides.map((_, i) => (
            <button
              key={i}
              onClick={() => setBannerIndex(i)}
              aria-label={`Go to banner ${i + 1}`}
              className={`h-2 rounded-full border border-white/45 transition-all ${bannerIndex === i ? "w-9 bg-sky-200 shadow-sm" : "w-2.5 bg-white/70 hover:bg-sky-100"
                }`}
            />
          ))}
        </div>
      </section>

      <section className="rounded-4xl border border-white/80 bg-[linear-gradient(160deg,#ffffff_0%,#eff6ff_48%,#f8fbff_100%)] p-4 shadow-[0_14px_35px_rgba(59,130,246,0.08)] md:p-6">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.28em] text-sky-600">Bulk buy stock</p>
            <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-900 md:text-3xl">What are you looking for?</h2>
          </div>
        </div>

        <div className="mb-5 space-y-3">
          <form onSubmit={handleQuickSearch} className="flex items-center gap-2 rounded-full border border-sky-100 bg-white p-1.5 shadow-[0_8px_24px_rgba(59,130,246,0.08)]">
            <div className="flex min-w-0 flex-1 items-center gap-3 px-3">
              <Search className="h-5 w-5 text-sky-400" />
              <input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                type="text"
                placeholder="Search medicines, stock, brands..."
                className="h-10 w-full border-none bg-transparent text-base text-slate-700 outline-none placeholder:text-slate-400"
              />
            </div>
            <button
              type="submit"
              className="rounded-full bg-linear-to-r from-sky-600 via-blue-600 to-cyan-500 px-6 py-2.5 text-base font-bold text-white transition-all hover:from-sky-700 hover:via-blue-700 hover:to-cyan-600 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!searchText.trim()}
            >
              Search
            </button>
          </form>

          {searchText.trim() ? (
            <div className="rounded-2xl border border-sky-100 bg-white p-3 shadow-sm">
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-sky-600">Related products</p>
              {searchMatches.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {searchMatches.map((product) => (
                    <button
                      key={product._id}
                      type="button"
                      onClick={() => router.push(`/products/${getProductSlug(product)}`)}
                      className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-left transition-all hover:border-emerald-200 hover:bg-emerald-50"
                    >
                      <span className="min-w-0 truncate text-sm font-semibold text-slate-800">
                        {product.productName || product.name}
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500">No related products found.</p>
              )}
            </div>
          ) : null}
        </div>

        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-extrabold text-slate-900 md:text-2xl tracking-tight flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-linear-to-tr from-sky-400 to-emerald-400 mr-2"></span>
            Top Brands
          </h2>
          <Link href="/brands" className="text-sky-700 bg-linear-to-r from-sky-100 to-emerald-50 px-4 py-1.5 rounded-full text-sm font-semibold flex items-center gap-1 hover:bg-sky-200 transition-all shadow-sm border border-sky-100">
            View All <ChevronRight className="w-4 h-4" />
          </Link>
        </div>

        <div
          className="overflow-hidden rounded-3xl border border-sky-100 bg-linear-to-r from-sky-50 via-white to-emerald-50 py-3 px-1 shadow-lg"
          onMouseEnter={() => setIsBrandsHovered(true)}
          onMouseLeave={() => setIsBrandsHovered(false)}
        >
          <div
            className={`flex w-max gap-6 md:gap-8 py-1 ${shouldAnimateBrands ? "marquee-track" : ""}`}
            style={{ animationPlayState: isBrandsHovered ? "paused" : "running" }}
          >
            {brandLoop.map((brand, index) => (
              <Link
                key={`${brand._id}-${index}`}
                href={`/brands/${getBrandSlug(brand)}`}
                className="group flex min-w-40 shrink-0 flex-col items-center rounded-2xl border border-white bg-white p-4 md:min-w-48 shadow transition-all duration-200 hover:scale-105 hover:shadow-xl hover:border-emerald-200"
                style={{ boxShadow: '0 4px 18px 0 rgba(16, 185, 129, 0.07)' }}
              >
                <div className="relative mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-linear-to-tr from-sky-100 to-emerald-50 shadow-md ring-2 ring-sky-100 group-hover:ring-emerald-200 transition-all">
                  <img src={getBrandImageUrl(brand?.logo)} alt={brand?.name} className="h-10 w-10 object-contain" />
                  <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold shadow group-hover:bg-sky-100 group-hover:text-sky-700 transition-all border border-emerald-200">Trusted</span>
                </div>
                <span className="text-sm font-semibold text-slate-800 text-center truncate w-full">
                  {brand.name}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <KycBanner kyc={user?.kyc} />

      {/* 3. CATEGORIES */}
      <section>
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-slate-800">Categories</h2>
          <Link href="/categories" className="text-sky-700 bg-sky-50 px-4 py-1.5 rounded-full text-sm font-semibold flex items-center gap-1 hover:bg-sky-100 transition-all">
            View All <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
        <div className="grid grid-cols-4 md:grid-cols-8 gap-4">
          {categories.map((cat) => (
            <Link key={cat._id} href={`/categories/${getCategorySlug(cat)}`} className="group text-center">
              <div className="w-16 h-16 md:w-20 md:h-20 mx-auto rounded-full bg-white flex items-center justify-center overflow-hidden mb-2 border border-slate-100 group-hover:shadow-md group-hover:border-sky-100 transition-all">
                <img src={getImageUrl(cat?.image)} alt={cat?.name} className="w-full h-full object-cover" />
              </div>
              <span className="text-[10px] md:text-xs font-medium text-gray-600 truncate block px-1">
                {cat?.name}
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* 5. PRODUCT CAROUSELS */}
      {!products?.length ? (
        <section className="py-10 flex flex-col items-center">
          <div className="w-24 h-24 rounded-full bg-gray-100 flex items-center justify-center text-gray-400">
            <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
          </div>
          <p className="mt-4 text-base font-semibold text-gray-500">No products found</p>
        </section>
      ) : (
        <>
          <ProductCarousel
            title="Best selling medicine"
            products={bestSelling}
            getProductImageUrl={getProductImageUrl}
            addToCart={addToCart}
            updateCartQty={updateCartQty}
            cartItems={cartItems}
            toggleWishlist={toggleWishlist}
            isInWishlist={isInWishlist}
            token={token}
            user={user}
          />
          <ProductCarousel
            title="New added medicine"
            products={newArrivals}
            getProductImageUrl={getProductImageUrl}
            addToCart={addToCart}
            updateCartQty={updateCartQty}
            cartItems={cartItems}
            toggleWishlist={toggleWishlist}
            isInWishlist={isInWishlist}
            token={token}
            user={user}
          />
          <ProductCarousel
            title="Health essentials"
            products={healthEssentials}
            getProductImageUrl={getProductImageUrl}
            addToCart={addToCart}
            updateCartQty={updateCartQty}
            cartItems={cartItems}
            toggleWishlist={toggleWishlist}
            isInWishlist={isInWishlist}
            token={token}
            user={user}
          />

          {/* All Products Section */}
          <section className="pt-6 border-t border-gray-200">
            <div className="flex justify-between items-center mb-8">
              <div>
                <h2 className="text-2xl font-bold text-gray-800">All Products</h2>
                <p className="text-sm text-gray-500 mt-1">Explore our complete pharmacy catalog</p>
              </div>
              <Link 
                href="/products" 
                className="text-emerald-700 bg-emerald-50 px-6 py-2.5 rounded-full text-sm font-semibold flex items-center gap-2 hover:bg-emerald-100 transition-all border border-emerald-200"
              >
                View All <ChevronRight className="w-4 h-4" />
              </Link>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {products.slice(0, 10).map((product) => {
                const wished = isInWishlist?.(product._id);
                const cartItem = cartItems.find((item) => item._id === product._id);
                const img = product?.productImages?.[0] || product?.image;
                const discountPercent = product.discountPercent || 0;

                const handleAdd = async () => {
                  if (!token) return (window.location.href = "/login");
                  if (user?.kyc !== "APPROVED") {
                    return showToast("Complete KYC to add to cart.", "info", "KYC Required");
                  }
                  try {
                    await addToCart(product._id, product.minOrderQty || 1);
                    showToast("Added to cart");
                  } catch (err) {
                    showToast(err?.message || "Could not add to cart.", "error");
                  }
                };

                return (
                  <ProductCard
                    key={product._id}
                    product={product}
                    cartItem={cartItem}
                    wished={wished}
                    onAdd={handleAdd}
                    onUpdateQty={updateCartQty}
                    onToggleWishlist={() =>
                      toggleWishlist?.({
                        _id: product._id,
                        name: product.productName,
                        price: product.sellingPrice,
                        image: getProductImageUrl(img),
                        unit: product.packSize || "1 unit",
                      })
                    }
                    imageUrl={getProductImageUrl(img)}
                    showBadge={discountPercent > 0}
                    badgeText={discountPercent > 0 ? `${discountPercent}% OFF` : ""}
                  />
                );
              })}
            </div>
          </section>
        </>
      )}
    </div>
    </div>
  );
};

// --- REUSABLE PRODUCT CAROUSEL WITH ARROWS ---
const ProductCarousel = ({
  title,
  products,
  getProductImageUrl,
  addToCart,
  updateCartQty,
  cartItems,
  toggleWishlist,
  isInWishlist,
  token,
  user,
}) => {
  const scrollRef = useRef(null);

  const scroll = (direction) => {
    if (scrollRef.current) {
      const { scrollLeft, clientWidth } = scrollRef.current;
      const moveBy = clientWidth * 0.75;
      scrollRef.current.scrollTo({
        left: direction === "left" ? scrollLeft - moveBy : scrollLeft + moveBy,
        behavior: "smooth",
      });
    }
  };

  const handleAdd = async (product) => {
    if (!token) return (window.location.href = "/login");
    if (user?.kyc !== "APPROVED") {
      return showToast("Complete KYC to add to cart.", "info", "KYC Required");
    }
    try {
      await addToCart(product._id, product.minOrderQty || 1);
      showToast("Added to cart");
    } catch (err) {
      showToast(err?.message || "Could not add to cart.", "error");
    }
  };

  return (
    <section className="relative group pb-8">
      <div className="flex justify-between items-center mb-6 px-1">
        <h2 className="text-xl font-bold text-gray-800">{title}</h2>
      </div>

      {/* Navigation Arrows (Pharma Style: Clean, Blurry White) */}
      <div className="absolute top-[40%] -translate-y-1/2 left-0 right-0 flex justify-between px-2 z-30 pointer-events-none">
        <button
          onClick={() => scroll("left")}
                className="p-2.5 rounded-full bg-white/90 backdrop-blur-md shadow-lg border border-gray-200 text-sky-700 pointer-events-auto opacity-0 group-hover:opacity-100 transition-all hover:bg-sky-600 hover:text-white"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <button
          onClick={() => scroll("right")}
                className="p-2.5 rounded-full bg-white/90 backdrop-blur-md shadow-lg border border-gray-200 text-sky-700 pointer-events-auto opacity-0 group-hover:opacity-100 transition-all hover:bg-sky-600 hover:text-white"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      <div
        ref={scrollRef}
        className="flex gap-4 overflow-x-auto pb-4 no-scrollbar scroll-smooth"
      >
        {products.map((product) => {
          const wished = isInWishlist?.(product._id);
          const cartItem = cartItems.find((item) => item._id === product._id);
          const img = product?.productImages?.[0] || product?.image;
          const outOfStock = (product.stockQuantity ?? 1) <= 0;

          return (
            <div
              key={product._id}
              className="min-w-45 md:min-w-60 shrink-0 border border-gray-100 rounded-2xl p-4 relative hover:shadow-xl hover:border-sky-100 transition-all bg-white"
            >
              {/* Wishlist */}
              <button
                onClick={() =>
                  toggleWishlist?.({
                    _id: product._id,
                    name: product.productName,
                    price: product.sellingPrice,
                    image: getProductImageUrl(img),
                    unit: product.packSize || "1 unit",
                  })
                }
                className={`absolute top-3 right-3 p-1.5 rounded-full z-10 transition-colors ${wished ? "bg-red-50 text-red-500" : "bg-gray-50 text-gray-400 hover:text-red-500"
                  }`}
              >
                <Heart className={`w-4 h-4 ${wished ? "fill-current" : ""}`} />
              </button>

              {/* Product Image */}
              <Link href={`/products/${getProductSlug(product)}`}>
                <div className="h-32 md:h-40 w-full flex items-center justify-center mb-4">
                  <img
                    src={getProductImageUrl(img) || "https://placehold.co/200x150?text=No+Image"}
                    alt={product.productName}
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
              </Link>

              {/* Info */}
              <div className="space-y-1">
                <div className="flex items-baseline justify-between">
                  <span className="text-sky-700 font-bold text-lg">₹{product.sellingPrice}</span>
                  <span className="text-[10px] text-gray-400 font-medium">{product.packSize}</span>
                </div>
                <h3 className="text-sm font-semibold text-gray-700 capitalize line-clamp-2 min-h-10">
                  {product.productName}
                </h3>
              </div>

              {/* Action Area */}
              <div className="mt-4">
                {cartItem ? (
                  <div className="flex items-center justify-between bg-teal-50 rounded-xl border border-teal-200 p-1">
                    <button
                      onClick={() => updateCartQty(product._id, cartItem.qty - (product.minOrderQty || 1))}
                      className="p-1.5 text-sky-700 hover:bg-white rounded-lg transition-colors"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <span className="font-bold text-teal-800 text-sm">{cartItem.qty}</span>
                    <button
                      onClick={() => updateCartQty(product._id, cartItem.qty + 1)}
                      disabled={cartItem.qty >= product.stockQuantity}
                      className="p-1.5 text-sky-700 hover:bg-white rounded-lg transition-colors disabled:opacity-30"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => handleAdd(product)}
                    disabled={outOfStock}
                    className={`w-full py-2.5 rounded-xl font-bold text-xs tracking-widest uppercase transition-all ${outOfStock
                      ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                      : "bg-sky-50 text-sky-700 border border-sky-200 hover:bg-sky-700 hover:text-white"
                      }`}
                  >
                    {outOfStock ? "Out of Stock" : "Add to Cart"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};

export default HomePage;