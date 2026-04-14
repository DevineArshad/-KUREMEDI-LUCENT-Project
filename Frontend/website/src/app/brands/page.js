"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useAppContext } from "@/context/context";
import { getBrandSlug } from "@/utils/product";
import { SkeletonBrandRow } from "@/components/Skeleton";

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

export default function BrandsPage() {
  const { getBrands, getBrandImageUrl } = useAppContext();
  const [brands, setBrands] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getBrands()
      .then((res) => {
        const list = res?.data ?? (Array.isArray(res) ? res : []);
        setBrands(dedupeBrands(list));
      })
      .catch(() => setBrands([]))
      .finally(() => setLoading(false));
  }, [getBrands]);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Brands</h1>

      {loading ? (
        <>
          <div className="animate-pulse bg-gray-200 rounded h-8 w-48 mb-6" />
          <SkeletonBrandRow count={10} />
        </>
      ) : brands.length === 0 ? (
        <div className="flex justify-center items-center py-20">
          <p className="text-gray-500">No brands found.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6">
          {brands.map((brand, i) => (
            <Link
              key={brand._id || i}
              href={`/brands/${getBrandSlug(brand)}`}
              className="flex flex-col items-center p-6 border-2 border-gray-100 rounded-2xl hover:border-teal-300 hover:shadow-xl transition-all bg-white group"
            >
              <div className="h-20 w-full flex items-center justify-center mb-4">
                <img
                  src={getBrandImageUrl(brand?.logo)}
                  alt={brand?.name || "Brand"}
                  className="max-w-full max-h-full object-contain"
                  onError={(e) => {
                    e.target.src = "https://placehold.co/150x80?text=No+Logo";
                  }}
                />
              </div>
              <span className="text-sm font-semibold text-gray-700 group-hover:text-teal-700 transition-colors text-center line-clamp-2">
                {brand?.name || "Unnamed Brand"}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
