import React, { useEffect, useState, useMemo } from "react";
import AddProductModal from "./AddProductModal";
import BulkUploadModal from "./BulkUploadModal";
import {
  Plus,
  Search,
  Upload,
  TrendingUp,
  Package,
  ShoppingCart,
  AlertTriangle,
  XCircle,
  Filter,
  Edit,
  Trash2,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import { useContextApi } from "../hooks/useContextApi";
import { resolveUploadUrl } from "../lib/baseUrl";

const getProductImageUrl = (p) => {
  const imgs = p?.productImages || p?.images || [];
  const first = Array.isArray(imgs) ? imgs[0] : null;
  if (!first) return null;
  return resolveUploadUrl(first);
};

const getProductDisplayName = (p) => {
  const direct = String(p?.productName || p?.name || "").trim();
  if (direct) return direct;

  const brand = String(p?.brand?.name || p?.brand || "").trim();
  const batch = String(p?.batchNumber || "").trim();
  if (brand || batch) return [brand, batch ? `Batch ${batch}` : ""].filter(Boolean).join(" - ");

  const code = String(p?._id || p?.id || p?.sku || "").trim();
  return code ? `Product #${code.slice(-6)}` : "Unknown Product";
};

const Products = () => {
  const { getProducts, GetCategoryData, deleteProducts } = useContextApi();

  const [editProductId, setEditProductId] = useState(null);
  const [editProduct, setEditProduct] = useState(null);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState("");
  const [openAddModal, setOpenAddModal] = useState(false);
  const [openBulkModal, setOpenBulkModal] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 12;
  const [deleteId, setDeleteId] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [loading, setLoading] = useState(true); // Loading placeholder

  /* ================= FETCH PRODUCTS ================= */
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const prodRes = await getProducts();
        setProducts(Array.isArray(prodRes) ? prodRes : []);
        const catRes = await GetCategoryData();
        setCategories(catRes?.data || []);
      } catch (error) {
        console.error("Error loading products or categories:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [getProducts, GetCategoryData]);

  /* ================= DELETE ================= */
  const handleDelete = async () => {
    if (!deleteId) return;
    setIsDeleting(true);
    try {
      await deleteProducts(deleteId);
      setProducts(prev => prev.filter(p => (p._id || p.id) !== deleteId));
      setDeleteId(null);
    } catch (error) {
      alert("Failed to delete product.");
      console.error(error);
    } finally {
      setIsDeleting(false);
    }
  };

  /* ================= FILTER & PAGINATION ================= */
  const filteredProducts = useMemo(() => {
    return products.filter((p) =>
      (p.productName || p.name || "").toLowerCase().includes(search.toLowerCase())
    );
  }, [products, search]);

  useEffect(() => setCurrentPage(1), [search]);
  const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);
  const paginatedProducts = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredProducts.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredProducts, currentPage]);
  const goToPage = (page) => setCurrentPage(Math.min(Math.max(page, 1), totalPages));

  /* ================= STATS ================= */
  const totalProducts = products.length;
  const stockVal = (p) => p.stockQuantity ?? p.stock ?? 0;
  const minStockVal = (p) => p.minStockLevel ?? 5;
  
  // Get status and message for product
  const getStockStatus = (p) => {
    const stock = stockVal(p);
    const minStock = minStockVal(p);
    if (stock === 0) return { status: "Out of Stock", message: "Immediate restock required" };
    if (stock <= minStock) return { status: stock === minStock ? "At Minimum" : "Low Stock", message: stock === minStock ? `Minimum stock reached (${minStock})` : `Stock is ${minStock - stock} units below minimum` };
    return { status: "In Stock", message: "Stock level is healthy" };
  };
  
  const inStock = products.filter((p) => getStockStatus(p).status === "In Stock").length;
  const lowStock = products.filter((p) => {
    const s = getStockStatus(p).status;
    return s === "At Minimum" || s === "Low Stock";
  }).length;
  const outStock = products.filter((p) => getStockStatus(p).status === "Out of Stock").length;

  /* ================= EDIT ================= */
  const handleEditClick = (product) => {
    const id = product._id || product.id;
    setEditProductId(id);
    setEditProduct(product);
    setOpenAddModal(true);
  };

  return (
    <div className="p-6 bg-gray-50 min-h-screen">

      {/* ================= HEADER ================= */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Product & Inventory Management</h1>
          <p className="text-gray-500 mt-1">Manage products, stock levels, and categories</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button className="flex items-center gap-2 px-4 py-2 border rounded-lg bg-white hover:bg-gray-100">
            <TrendingUp size={18} /> Conversion Analytics
          </button>
          <button onClick={() => setOpenBulkModal(true)} className="flex items-center gap-2 px-4 py-2 border rounded-lg bg-white hover:bg-gray-100">
            <Upload size={18} /> Bulk Upload
          </button>
          <button onClick={() => { setEditProductId(null); setOpenAddModal(true); }} className="flex items-center gap-2 px-4 py-2 bg-black text-white rounded-lg hover:bg-gray-800">
            <Plus size={18} /> Add Product
          </button>
        </div>
      </div>

      {/* ================= STATS ================= */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <StatCard title="Total Products" value={totalProducts} icon={<Package size={22} />} />
        <StatCard title="In Stock" value={inStock} icon={<ShoppingCart size={22} />} color="green" />
        <StatCard title="Low Stock" value={lowStock} icon={<AlertTriangle size={22} />} color="orange" />
        <StatCard title="Out of Stock" value={outStock} icon={<XCircle size={22} />} color="red" />
      </div>

      {/* ================= MAIN TABLE ================= */}
      <div className="bg-white rounded-xl shadow-sm p-5">

        {/* Search + Filter */}
        <div className="flex flex-col md:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <Search size={18} className="absolute top-3 left-3 text-gray-400" />
            <input type="text" placeholder="Search products..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400" />
          </div>
          <button className="flex items-center gap-2 px-4 py-2 border rounded-lg hover:bg-gray-100">
            <Filter size={18} /> Filters
          </button>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-gray-600">
              <tr>
                <th className="text-left py-3 w-12">Image</th>
                <th className="text-left py-3">Name</th>
                <th className="text-left py-3">Category</th>
                <th className="text-left py-3">MRP</th>
                <th className="text-left py-3">Final Price</th>
                <th className="text-left py-3">Weight</th>
                <th className="text-left py-3">GST</th>
                <th className="text-left py-3">Stock</th>
                <th className="text-left py-3">Batch</th>
                <th className="text-left py-3">Status</th>
                <th className="text-left py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && Array.from({ length: 5 }).map((_, idx) => (
                <tr key={idx}>
                  {Array.from({ length: 11 }).map((__, cidx) => (
                    <td key={cidx} className="py-3">
                      <div className="h-4 bg-gray-200 rounded animate-pulse w-full"></div>
                    </td>
                  ))}
                </tr>
              ))}

              {!loading && paginatedProducts.length === 0 && (
                <tr>
                  <td colSpan={11} className="text-center py-8 text-gray-500">No products found</td>
                </tr>
              )}

              {!loading && paginatedProducts.map((p) => {
                const productId = p._id || p.id;
                const stock = p.stockQuantity ?? p.stock ?? 0;
                const minStock = p.minStockLevel ?? 5;
                const price = p.finalSellingPrice ?? p.price ?? p.sellingPrice;
                const gstPercent = Number(p.gstPercent || 0);
                const gstMode = p.gstMode || "exclude";
                const { status, message } = getStockStatus(p);

                return (
                  <tr key={productId} className="border-b hover:bg-gray-50">
                    <td className="py-3">
                      {getProductImageUrl(p) ? (
                        <img
                          src={getProductImageUrl(p)}
                          alt={p.productName || p.name}
                          className="h-10 w-10 rounded object-cover border"
                          onError={(e) => {
                            e.currentTarget.onerror = null;
                            e.currentTarget.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><rect width='100%25' height='100%25' fill='%23f3f4f6'/><text x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%239ca3af' font-size='16'>?</text></svg>";
                          }}
                        />
                      ) : (
                        <div className="h-10 w-10 rounded border bg-gray-100 flex items-center justify-center text-gray-400 text-xs">?</div>
                      )}
                    </td>
                    <td className="py-3 font-medium">{getProductDisplayName(p)}</td>
                    <td className="py-3">{typeof p.category === "object" ? p.category?.name : p.category || "-"}</td>
                    <td className="py-3">₹{p.mrp ?? "-"}</td>
                    <td className="py-3 font-semibold">₹{price ?? "-"}</td>
                    <td className="py-3">{Number(p.weight) > 0 ? `${Number(p.weight).toFixed(2)} kg` : "-"}</td>
                    <td className="py-3">{gstPercent}% ({gstMode})</td>
                    <td className="py-3" title={`Min: ${minStock}`}>{stock}</td>
                    <td className="py-3">{p.batchNumber}</td>
                    <td className="py-3"><StatusBadge status={status} message={message} minStock={minStock} stock={stock} /></td>
                    <td className="py-3 flex gap-2">
                      <button onClick={() => handleEditClick(p)} className="text-blue-600 hover:text-blue-800"><Edit size={16} /></button>
                      <button onClick={() => setDeleteId(productId)} className="text-red-600 hover:text-red-800"><Trash2 size={16} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="px-4 py-4 border-t flex flex-col md:flex-row justify-between items-center gap-4 bg-gray-50 mt-4 rounded-lg">
          <p className="text-sm text-gray-600">
            Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, filteredProducts.length)} of {filteredProducts.length} products
          </p>
          <div className="flex items-center gap-2">
            <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 1} className="p-2 border rounded-md bg-white hover:bg-gray-100 disabled:opacity-50"> <ChevronLeft size={18} /> </button>
            {[...Array(totalPages)].map((_, i) => {
              const pageNum = i + 1;
              if (pageNum === 1 || pageNum === totalPages || (pageNum >= currentPage - 1 && pageNum <= currentPage + 1)) {
                return <button key={i} onClick={() => goToPage(pageNum)} className={`px-3.5 py-1.5 rounded-md text-sm font-medium ${currentPage === pageNum ? "bg-blue-600 text-white" : "bg-white border hover:bg-gray-100 text-gray-700"}`}>{pageNum}</button>;
              } else if (pageNum === currentPage - 2 || pageNum === currentPage + 2) {
                return <span key={i} className="px-1 text-gray-400">...</span>;
              }
              return null;
            })}
            <button onClick={() => goToPage(currentPage + 1)} disabled={currentPage === totalPages} className="p-2 border rounded-md bg-white hover:bg-gray-100 disabled:opacity-50"> <ChevronRight size={18} /> </button>
          </div>
        </div>

      </div>

      {/* Modals */}
      {openAddModal && <AddProductModal productId={editProductId} product={editProduct} onClose={() => { setOpenAddModal(false); setEditProductId(null); setEditProduct(null); }} onSuccess={async () => { const data = await getProducts(); setProducts(Array.isArray(data) ? data : []); }} />}
      {openBulkModal && <BulkUploadModal onClose={() => setOpenBulkModal(false)} onSuccess={async () => { const data = await getProducts(); setProducts(Array.isArray(data) ? data : []); }} />}

      {/* Delete Confirmation */}
      {deleteId && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-sm w-full shadow-2xl animate-in fade-in zoom-in duration-200">
            <div className="flex items-center gap-3 text-red-600 mb-4">
              <AlertTriangle size={24} />
              <h3 className="text-lg font-bold">Delete Product?</h3>
            </div>
            <p className="text-gray-600 mb-6">Are you sure you want to delete this product? This action cannot be undone.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteId(null)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium" disabled={isDeleting}>No, Cancel</button>
              <button onClick={handleDelete} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium flex items-center gap-2" disabled={isDeleting}>{isDeleting ? "Deleting..." : "Yes, Delete"}</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default Products;

/* ================= STAT CARD ================= */
const StatCard = ({ title, value, icon, color }) => {
  const colors = { green: "text-green-600", orange: "text-orange-500", red: "text-red-600" };
  return (
    <div className="bg-white p-5 rounded-xl shadow-sm flex justify-between items-center">
      <div>
        <p className="text-gray-500 text-sm">{title}</p>
        <h2 className="text-3xl font-bold mt-1">{value}</h2>
      </div>
      <div className={`${colors[color] || "text-gray-500"}`}>{icon}</div>
    </div>
  );
};

/* ================= STATUS BADGE ================= */
const StatusBadge = ({ status, message, minStock, stock }) => {
  const map = { "In Stock": "bg-green-100 text-green-700 hover:bg-green-200", "At Minimum": "bg-yellow-100 text-yellow-700 hover:bg-yellow-200", "Low Stock": "bg-orange-100 text-orange-700 hover:bg-orange-200", "Out of Stock": "bg-red-100 text-red-700 hover:bg-red-200" };
  return <span className={`px-3 py-1 text-xs rounded-full font-medium cursor-help transition-colors ${map[status]}`} title={`${message}${minStock ? ` (Min: ${minStock})` : ''}`}>{status}</span>;
};
