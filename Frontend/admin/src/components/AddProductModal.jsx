import React, { useState, useEffect, useRef } from "react";
import { X, Plus, Trash2, AlertCircle } from "lucide-react";
import { useContextApi } from "../hooks/useContextApi";
import { resolveUploadUrl } from "../lib/baseUrl";
import { getErrorMessage, logError } from "../utils/errorHandler";

const getProductImageUrl = (path) => {
    if (!path) return "";
    if (path.startsWith("blob:") || path.startsWith("http") || path.startsWith("data:")) return path;
    return resolveUploadUrl(path);
};

const MAX_PRODUCT_IMAGES = 6;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const COMPRESS_MIN_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1920;
const COMPRESS_QUALITY = 0.82;
const ALLOWED_IMAGE_MIME = [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/heic",
    "image/heif",
];

const AddProductModal = ({ onClose, onSuccess, productId, product }) => {
    const {
        GetCategoryData,
        getBrands,
        createProductWithFormData,
        getProductsById,
        updateProductWithFormData,
    } = useContextApi();

    const [loading, setLoading] = useState(false);
    const [categories, setCategories] = useState([]);
    const [brands, setBrands] = useState([]);
    const [imageFiles, setImageFiles] = useState([]);
    const [existingImageUrls, setExistingImageUrls] = useState([]);
    const [imagePreviews, setImagePreviews] = useState([]);
    const [errorMsg, setErrorMsg] = useState("");
    const [successMsg, setSuccessMsg] = useState("");

    const toMb = (bytes = 0) => (Number(bytes || 0) / (1024 * 1024)).toFixed(1);

    const shouldCompressFile = (file) => {
        const type = String(file?.type || "").toLowerCase();
        const compressible = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
        return Number(file?.size || 0) >= COMPRESS_MIN_BYTES && compressible.includes(type);
    };

    const compressImageFile = (file) =>
        new Promise((resolve) => {
            if (!shouldCompressFile(file)) {
                resolve(file);
                return;
            }

            const img = new Image();
            const objectUrl = URL.createObjectURL(file);

            img.onload = () => {
                try {
                    const width = Number(img.width || 0);
                    const height = Number(img.height || 0);
                    if (!width || !height) {
                        URL.revokeObjectURL(objectUrl);
                        resolve(file);
                        return;
                    }

                    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(width, height));
                    const targetWidth = Math.max(1, Math.round(width * scale));
                    const targetHeight = Math.max(1, Math.round(height * scale));

                    const canvas = document.createElement("canvas");
                    canvas.width = targetWidth;
                    canvas.height = targetHeight;
                    const ctx = canvas.getContext("2d");
                    if (!ctx) {
                        URL.revokeObjectURL(objectUrl);
                        resolve(file);
                        return;
                    }

                    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

                    const normalizedType = String(file.type || "").toLowerCase();
                    const outType = normalizedType === "image/png" ? "image/jpeg" : normalizedType;

                    canvas.toBlob(
                        (blob) => {
                            URL.revokeObjectURL(objectUrl);
                            if (!blob || blob.size >= file.size) {
                                resolve(file);
                                return;
                            }
                            const nextName = outType === "image/jpeg"
                                ? String(file.name || "image").replace(/\.(png|webp)$/i, ".jpg")
                                : file.name;
                            const compressed = new File([blob], nextName, {
                                type: outType,
                                lastModified: Date.now(),
                            });
                            resolve(compressed);
                        },
                        outType,
                        COMPRESS_QUALITY
                    );
                } catch {
                    URL.revokeObjectURL(objectUrl);
                    resolve(file);
                }
            };

            img.onerror = () => {
                URL.revokeObjectURL(objectUrl);
                resolve(file);
            };

            img.src = objectUrl;
        });

    const [formData, setFormData] = useState({
        productName: "",
        mrp: "",
        sellingPrice: "",
        composition: "",
        ingredients: "",
        keyUses: "",
        safetyInformation: "",
        // ...existing code...
        packing: "",
        discount: "",
        gst: "",
        gstMode: "exclude",

        category: "",
        brand: "",
        manufacturer: "",
        hsnCode: "",
        batchNumber: "",
        expiryDate: "",
        stockQuantity: "",
        minStockLevel: "",
        minOrderQty: "",
        isActive: true,
        isPrescriptionRequired: false,
    });

    const formatDate = (dateString) => {
        if (!dateString) return "";
        return new Date(dateString).toISOString().split("T")[0];
    };

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [catRes, brandRes] = await Promise.all([
                    GetCategoryData(),
                    getBrands ? getBrands() : { data: [] },
                ]);
                setCategories(catRes?.data || []);
                setBrands(brandRes?.data || []);

                if (productId || product) {
                    setLoading(true);
                    const item = product || await getProductsById(productId);
                    const rawImages = item?.productImages || item?.images || [];
                    const urls = Array.isArray(rawImages) ? rawImages : [];

                    setFormData({
                        productName: item.productName || "",
                        mrp: item.mrp || "",
                        sellingPrice: item.sellingPrice || "",
                        composition: item.composition || "",
                        ingredients: item.ingredients || "",
                        keyUses: item.keyUses || "",
                        safetyInformation: item.safetyInformation || "",
                        // ...existing code...
                        packing: item.packing || "",
                        discount: item.discountPercent ?? item.discount ?? "",
                        gst: (item.gstMode || (Number(item.gstPercent ?? item.gst ?? 0) > 0 ? "include" : "exclude")) === "include"
                            ? (item.gstPercent ?? item.gst ?? "")
                            : 0,
                        gstMode: item.gstMode || (Number(item.gstPercent ?? item.gst ?? 0) > 0 ? "include" : "exclude"),
                        category: item.category?._id || item.category || "",
                        brand: item.brand?._id || item.brand || "",
                        manufacturer: item.manufacturer || "",
                        hsnCode: item.hsnCode || "",
                        batchNumber: item.batchNumber || "",
                        expiryDate: formatDate(item.expiryDate),
                        stockQuantity: item.stockQuantity ?? "",
                        minStockLevel: item.minStockLevel ?? "",
                        minOrderQty: item.minOrderQty ?? "",
                        isActive: item.isActive ?? true,
                        isPrescriptionRequired: item.prescriptionRequired ?? item.isPrescriptionRequired ?? false,
                    });
                    setExistingImageUrls(urls);
                    setImageFiles([]);
                    setImagePreviews(urls.map((img) => getProductImageUrl(img)));
                } else {
                    setFormData({
                        productName: "",
                        mrp: "",
                        sellingPrice: "",
                        composition: "",
                        ingredients: "",
                        keyUses: "",
                        safetyInformation: "",
                        // ...existing code...
                        packing: "",
                        discount: "",
                        gst: "",
                        gstMode: "exclude",
                        category: "",
                        brand: "",
                        manufacturer: "",
                        hsnCode: "",
                        batchNumber: "",
                        expiryDate: "",
                        stockQuantity: "",
                        minStockLevel: "",
                        minOrderQty: "",
                        isActive: true,
                        isPrescriptionRequired: false,
                    });
                    setExistingImageUrls([]);
                    setImageFiles([]);
                    setImagePreviews([]);
                }
            } catch (error) {
                console.error("Error initializing modal:", error);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [productId, product, GetCategoryData, getBrands, getProductsById]);

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        const nextValue = type === "checkbox" ? checked : value;
        setFormData((prev) => {
            if (name === "gstMode") {
                const isExclude = nextValue === "exclude";
                return {
                    ...prev,
                    gstMode: nextValue,
                    gst: isExclude ? 0 : prev.gst,
                };
            }
            if (name === "gst") {
                const gstNumber = Number(nextValue);
                return {
                    ...prev,
                    gst: nextValue,
                    gstMode: gstNumber > 0 ? "include" : prev.gstMode,
                };
            }
            return {
                ...prev,
                [name]: nextValue,
            };
        });
    };

    const handleImageUpload = async (e) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;

        const processedFiles = await Promise.all(files.map((file) => compressImageFile(file)));

        const invalidTypeFiles = processedFiles.filter(
            (file) => !ALLOWED_IMAGE_MIME.includes(String(file.type || "").toLowerCase())
        );
        const typeValidFiles = processedFiles.filter(
            (file) => ALLOWED_IMAGE_MIME.includes(String(file.type || "").toLowerCase())
        );

        const oversizedFiles = typeValidFiles.filter((file) => Number(file?.size || 0) > MAX_IMAGE_BYTES);
        const sizeValidFiles = typeValidFiles.filter((file) => Number(file?.size || 0) <= MAX_IMAGE_BYTES);

        const availableSlots = Math.max(0, MAX_PRODUCT_IMAGES - imagePreviews.length);
        const slotCappedFiles = sizeValidFiles.slice(0, availableSlots);
        const skippedBySlots = Math.max(0, sizeValidFiles.length - slotCappedFiles.length);

        const acceptedFiles = [];
        acceptedFiles.push(...slotCappedFiles);

        const warnings = [];
        if (invalidTypeFiles.length) {
            warnings.push(`Skipped ${invalidTypeFiles.length} file(s): unsupported format (use JPG, PNG, WEBP, GIF, HEIC, HEIF).`);
        }
        if (oversizedFiles.length) {
            const names = oversizedFiles
                .slice(0, 2)
                .map((file) => `${file.name || "file"} (${toMb(file.size)}MB)`)
                .join(", ");
            warnings.push(`Skipped ${oversizedFiles.length} file(s): each image can be up to 5MB (${names}${oversizedFiles.length > 2 ? ", ..." : ""}).`);
        }
        if (skippedBySlots > 0) {
            warnings.push(`Skipped ${skippedBySlots} file(s): maximum ${MAX_PRODUCT_IMAGES} images allowed.`);
        }

        if (acceptedFiles.length === 0) {
            setErrorMsg(warnings.join("\n") || "No valid images were selected.");
            e.target.value = "";
            return;
        }

        setErrorMsg(warnings.join("\n"));
        const newPreviews = acceptedFiles.map((f) => URL.createObjectURL(f));
        setImageFiles((prev) => [...prev, ...acceptedFiles]);
        setImagePreviews((prev) => [...prev, ...newPreviews]);
        e.target.value = "";
    };

    const removeImage = (index) => {
        const isExisting = index < existingImageUrls.length;
        if (isExisting) {
            setExistingImageUrls((prev) => prev.filter((_, i) => i !== index));
            setImagePreviews((prev) => prev.filter((_, i) => i !== index));
        } else {
            const fileIndex = index - existingImageUrls.length;
            setImageFiles((prev) => prev.filter((_, i) => i !== fileIndex));
            setImagePreviews((prev) => prev.filter((_, i) => i !== index));
        }
    };

    const buildFormData = () => {
        const fd = new FormData();
        fd.append("productName", formData.productName.trim());
        fd.append("mrp", String(formData.mrp || 0));
        fd.append("sellingPrice", String(formData.sellingPrice || 0));
        fd.append("composition", formData.composition || "");
        fd.append("ingredients", formData.ingredients || "");
        fd.append("keyUses", formData.keyUses || "");
        fd.append("safetyInformation", formData.safetyInformation || "");
        // ...existing code...
        fd.append("packing", formData.packing || "");
        fd.append("discountPercent", String(formData.discount || 0));
        fd.append("gstPercent", String(formData.gstMode === "include" ? (formData.gst || 0) : 0));
        fd.append("gstMode", String(formData.gstMode || "exclude"));
        fd.append("category", formData.category || "");
        fd.append("brand", formData.brand || "");
        fd.append("manufacturer", formData.manufacturer || "");
        fd.append("hsnCode", formData.hsnCode || "");
        fd.append("batchNumber", formData.batchNumber || "");
        fd.append("expiryDate", formData.expiryDate || "");
        fd.append("stockQuantity", String(formData.stockQuantity || 0));
        fd.append("minStockLevel", String(formData.minStockLevel || 0));
        fd.append("minOrderQty", String(formData.minOrderQty || 1));
        fd.append("isActive", String(formData.isActive));
        fd.append("prescriptionRequired", String(formData.isPrescriptionRequired));

        imageFiles.forEach((file) => fd.append("productImages", file));

        if (productId && existingImageUrls.length > 0) {
            fd.append("existingProductImages", JSON.stringify(existingImageUrls));
        }
        return fd;
    };

    const handleSubmit = async (e) => {
        e?.preventDefault();
        setErrorMsg("");
        setSuccessMsg("");

        const productName = formData.productName?.trim();
        const sellingPrice = Number(formData.sellingPrice);
        const mrp = Number(formData.mrp);
        const category = formData.category;
        const brand = formData.brand;
        const discount = Number(formData.discount || 0);
        const gst = Number(formData.gst || 0);
        const errs = [];
        if (!productName) errs.push("Product name is required.");
        if (!productId && (!imageFiles?.length)) errs.push("At least one product image is required.");
        const oversizedAtSubmit = imageFiles.filter((file) => Number(file?.size || 0) > MAX_IMAGE_BYTES);
        if (oversizedAtSubmit.length > 0) {
            errs.push("Each image can be up to 10MB.");
        }
        if (category === "" || !category) errs.push("Category is required.");
        if (brand === "" || !brand) errs.push("Brand is required.");
        if (sellingPrice === undefined || sellingPrice === "" || isNaN(sellingPrice) || sellingPrice < 0)
            errs.push("Selling price is required and must be a valid number.");
        if (mrp === undefined || mrp === "" || isNaN(mrp) || mrp < 0)
            errs.push("MRP is required and must be a valid number.");
        if (!isNaN(sellingPrice) && !isNaN(mrp) && sellingPrice > mrp)
            errs.push("Selling price cannot be greater than MRP.");
        if (isNaN(discount) || discount < 0 || discount > 100)
            errs.push("Discount must be between 0 and 100.");
        if (isNaN(gst) || gst < 0)
            errs.push("GST must be 0 or greater.");
        if (errs.length) {
            setErrorMsg(errs.join("\n"));
            return;
        }
        setLoading(true);
        try {
            const fd = buildFormData();
            if (productId) {
                await updateProductWithFormData(productId, fd);
                setSuccessMsg("Product updated successfully!");
            } else {
                await createProductWithFormData(fd);
                setSuccessMsg("Product added successfully!");
            }
            setTimeout(() => {
                if (onSuccess) onSuccess();
                onClose();
            }, 1000);
        } catch (error) {
            const errorMessage = getErrorMessage(error, {
                isUpload: true,
                operation: productId ? "update product upload" : "create product upload",
                files: imageFiles,
                maxImageBytes: MAX_IMAGE_BYTES,
                triedHosts: error?.triedHosts,
            });
            setErrorMsg(errorMessage);
            logError("Product submission", error);
        } finally {
            setLoading(false);
        }
    };

    const allPreviews = imagePreviews;
    const gstMode = formData.gstMode || "exclude";
    const baseSelling = Number(formData.sellingPrice || 0);
    const discountPercent = Math.min(100, Math.max(0, Number(formData.discount || 0)));
    const gstPercent = formData.gstMode === "include" ? Math.max(0, Number(formData.gst || 0)) : 0;
    const discounted = Math.max(0, baseSelling - (baseSelling * discountPercent) / 100);
    const gstAmount = gstMode === "include" ? (baseSelling * gstPercent) / 100 : 0;
    const finalPrice = discounted + gstAmount;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-center p-6 border-b sticky top-0 bg-white z-10">
                    <h2 className="text-xl font-bold text-gray-800">
                        {productId ? "Edit Product" : "Add New Product"}
                    </h2>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
                        <X size={24} />
                    </button>
                </div>

                {errorMsg && (
                    <div className="mx-6 mt-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
                        <AlertCircle size={20} className="text-red-600 shrink-0 mt-0.5" />
                        <div className="flex-1">
                            <h3 className="font-semibold text-red-800">Error</h3>
                            <p className="text-red-700 text-sm mt-1 whitespace-pre-wrap">{errorMsg}</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setErrorMsg("")}
                            className="text-red-600 hover:text-red-800 mt-1"
                        >
                            <X size={18} />
                        </button>
                    </div>
                )}

                {successMsg && (
                    <div className="mx-6 mt-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-start gap-3">
                        <div className="w-5 h-5 rounded-full bg-green-600 flex items-center justify-center shrink-0 mt-0.5">
                            <span className="text-white text-xs font-bold">✓</span>
                        </div>
                        <div className="flex-1">
                            <h3 className="font-semibold text-green-800">Success</h3>
                            <p className="text-green-700 text-sm mt-1">{successMsg}</p>
                        </div>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="block text-sm font-medium text-gray-700">Product Images (max 6)</label>
                            <div className="grid grid-cols-3 gap-2 mb-2">
                                {Array.from({ length: 6 }).map((_, idx) => {
                                    if (allPreviews[idx]) {
                                        return (
                                            <div key={idx} className="relative group aspect-square border rounded-lg overflow-hidden bg-gray-100">
                                                <img
                                                    src={allPreviews[idx]}
                                                    alt="Preview"
                                                    className="w-full h-full object-cover"
                                                    onError={(e) => {
                                                        e.target.onerror = null;
                                                        e.target.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150"><rect width="100%25" height="100%25" fill="%23f3f4f6"/><text x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" fill="%239ca3af" font-size="16">Image Error</text></svg>';
                                                    }}
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => removeImage(idx)}
                                                    className="absolute top-1 right-1 bg-red-500 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        );
                                    } else if (allPreviews.length === idx) {
                                        // Show upload button in the first empty slot
                                        return (
                                            <label key={idx} className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-lg aspect-square cursor-pointer hover:bg-gray-50 transition">
                                                <Plus size={24} className="text-gray-400" />
                                                <input type="file" multiple accept="image/*" onChange={handleImageUpload} className="hidden" />
                                            </label>
                                        );
                                    } else {
                                        // Show placeholder for other empty slots
                                        return (
                                            <div key={idx} className="aspect-square border rounded-lg bg-gray-100 flex items-center justify-center">
                                                <span className="text-gray-200 text-3xl select-none">+</span>
                                            </div>
                                        );
                                    }
                                })}
                            </div>
                        </div>

                        <InputField label="Product Name" name="productName" value={formData.productName} onChange={handleChange} required />
                        <RichTextField
                            label="Composition"
                            value={formData.composition}
                            onChange={(value) => setFormData((prev) => ({ ...prev, composition: value }))}
                            placeholder="Write product composition. You can use bold, lists, and basic formatting."
                        />
                        <RichTextField
                            label="Ingredients"
                            value={formData.ingredients}
                            onChange={(value) => setFormData((prev) => ({ ...prev, ingredients: value }))}
                            placeholder="Write ingredients. You can use bold, lists, and basic formatting."
                        />
                        <RichTextField
                            label="Key Uses"
                            value={formData.keyUses}
                            onChange={(value) => setFormData((prev) => ({ ...prev, keyUses: value }))}
                            placeholder="Write key uses. You can use bold, lists, and basic formatting."
                        />
                        <RichTextField
                            label="Safety Information"
                            value={formData.safetyInformation}
                            onChange={(value) => setFormData((prev) => ({ ...prev, safetyInformation: value }))}
                            placeholder="Write safety information. You can use bold, lists, and basic formatting."
                        />

                        {/* Section Styles removed */}
                        <InputField label="Packing" name="packing" value={formData.packing} onChange={handleChange} placeholder="e.g. 10 tabs, 1 pouch, Strip of 15" />

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Category *</label>
                                <select name="category" value={formData.category} onChange={handleChange} className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none" required>
                                    <option value="">Select Category</option>
                                    {categories.map((cat) => <option key={cat._id} value={cat._id}>{cat.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Brand *</label>
                                <select name="brand" value={formData.brand} onChange={handleChange} className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none" required>
                                    <option value="">Select Brand</option>
                                    {brands.map((brand) => <option key={brand._id} value={brand._id}>{brand.name}</option>)}
                                </select>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <InputField label="MRP" name="mrp" type="number" value={formData.mrp} onChange={handleChange} required />
                            <InputField label="Selling Price" name="sellingPrice" type="number" value={formData.sellingPrice} onChange={handleChange} required />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <InputField label="Discount %" name="discount" type="number" value={formData.discount} onChange={handleChange} />
                            <InputField
                                label="GST %"
                                name="gst"
                                type="number"
                                value={formData.gst}
                                onChange={handleChange}
                                disabled={formData.gstMode === "exclude"}
                                placeholder={formData.gstMode === "exclude" ? "Disabled for GST Excluded" : ""}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">GST Type</label>
                            <div className="grid grid-cols-2 gap-3">
                                <label className="flex items-center gap-2 border border-gray-300 rounded-lg px-3 py-2 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="gstMode"
                                        value="exclude"
                                        checked={formData.gstMode === "exclude"}
                                        onChange={handleChange}
                                    />
                                    <span className="text-sm text-gray-700">GST Excluded</span>
                                </label>
                                <label className="flex items-center gap-2 border border-gray-300 rounded-lg px-3 py-2 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="gstMode"
                                        value="include"
                                        checked={formData.gstMode === "include"}
                                        onChange={handleChange}
                                    />
                                    <span className="text-sm text-gray-700">GST Included</span>
                                </label>
                            </div>
                            <p className="text-xs text-gray-500 mt-2">
                                {formData.gstMode === "include"
                                    ? "GST amount will be added on selling price."
                                    : "GST is excluded. GST % is disabled and no GST is calculated."}
                            </p>
                        </div>
                        <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">
                            <p className="font-medium mb-1">Price Preview</p>
                            <p>Selling price: Rs {baseSelling.toFixed(2)}</p>
                            <p>Discount amount: Rs {(baseSelling - discounted).toFixed(2)}</p>
                            <p>GST ({gstPercent.toFixed(2)}%): Rs {gstAmount.toFixed(2)}</p>
                            <p className="font-semibold">Final selling price: Rs {finalPrice.toFixed(2)}</p>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <InputField label="HSN Code" name="hsnCode" value={formData.hsnCode} onChange={handleChange} />
                            <InputField label="Batch Number" name="batchNumber" value={formData.batchNumber} onChange={handleChange} />
                        </div>
                        <InputField label="Expiry Date" name="expiryDate" type="date" value={formData.expiryDate} onChange={handleChange} />
                        <div className="grid grid-cols-3 gap-4">
                            <InputField label="Stock Qty" name="stockQuantity" type="number" value={formData.stockQuantity} onChange={handleChange} />
                            <InputField label="Min Stock" name="minStockLevel" type="number" value={formData.minStockLevel} onChange={handleChange} />
                            <InputField label="Min Order" name="minOrderQty" type="number" value={formData.minOrderQty} onChange={handleChange} />
                        </div>
                        <div className="flex gap-6 mt-4 pt-2">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" name="isActive" checked={formData.isActive} onChange={handleChange} className="w-4 h-4 text-blue-600 rounded" />
                                <span className="text-sm font-medium text-gray-700">Active</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" name="isPrescriptionRequired" checked={formData.isPrescriptionRequired} onChange={handleChange} className="w-4 h-4 text-blue-600 rounded" />
                                <span className="text-sm font-medium text-gray-700">Prescription Required</span>
                            </label>
                        </div>
                    </div>
                </form>

                <div className="p-6 border-t bg-gray-50 flex justify-end gap-3 sticky bottom-0">
                    <button type="button" onClick={onClose} className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100 font-medium">Cancel</button>
                    <button type="button" onClick={handleSubmit} disabled={loading} className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50 flex items-center gap-2">
                        {loading && <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></div>}
                        {productId ? "Update Product" : "Add Product"}
                    </button>
                </div>
            </div>
        </div>
    );
};

const InputField = ({ label, name, type = "text", value, onChange, placeholder, required, disabled }) => (
    <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{label} {required && "*"}</label>
        <input type={type} name={name} value={value} onChange={onChange} placeholder={placeholder} disabled={disabled} className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none placeholder-gray-400 disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed" required={required} />
    </div>
);

const TextAreaField = ({ label, name, value, onChange, placeholder }) => (
    <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
        <textarea name={name} value={value} onChange={onChange} placeholder={placeholder} rows="2" className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none placeholder-gray-400 resize-none" />
    </div>
);

const RichTextField = ({ label, value, onChange, placeholder }) => {
    const editorRef = useRef(null);

    useEffect(() => {
        if (!editorRef.current) return;
        const current = editorRef.current.innerHTML;
        const next = value || "";
        if (current !== next) {
            editorRef.current.innerHTML = next;
        }
    }, [value]);

    const runCommand = (command) => {
        document.execCommand(command, false, null);
        editorRef.current?.focus();
        onChange(editorRef.current?.innerHTML || "");
    };

    const handleInput = () => {
        onChange(editorRef.current?.innerHTML || "");
    };

    const handlePaste = (e) => {
        e.preventDefault();
        const text = e.clipboardData.getData("text/plain");
        document.execCommand("insertText", false, text);
        onChange(editorRef.current?.innerHTML || "");
    };

    return (
        <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>

            <div className="border border-gray-300 rounded-lg overflow-hidden">
                <div className="flex items-center gap-1 border-b bg-gray-50 p-2">
                    <button type="button" onClick={() => runCommand("bold")} className="px-2 py-1 text-xs font-semibold rounded border border-gray-300 bg-white hover:bg-gray-100">B</button>
                    <button type="button" onClick={() => runCommand("italic")} className="px-2 py-1 text-xs italic rounded border border-gray-300 bg-white hover:bg-gray-100">I</button>
                    <button type="button" onClick={() => runCommand("underline")} className="px-2 py-1 text-xs underline rounded border border-gray-300 bg-white hover:bg-gray-100">U</button>
                    <button type="button" onClick={() => runCommand("insertUnorderedList")} className="px-2 py-1 text-xs rounded border border-gray-300 bg-white hover:bg-gray-100">• List</button>
                    <button type="button" onClick={() => runCommand("insertOrderedList")} className="px-2 py-1 text-xs rounded border border-gray-300 bg-white hover:bg-gray-100">1. List</button>
                    <button
                        type="button"
                        onClick={() => {
                            if (editorRef.current) editorRef.current.innerHTML = "";
                            onChange("");
                        }}
                        className="ml-auto px-2 py-1 text-xs rounded border border-gray-300 bg-white hover:bg-gray-100"
                    >
                        Clear
                    </button>
                </div>

                <div
                    ref={editorRef}
                    contentEditable
                    onInput={handleInput}
                    onPaste={handlePaste}
                    data-placeholder={placeholder || "Write composition..."}
                    className="min-h-22.5 max-h-56 overflow-y-auto px-3 py-2 focus:outline-none"
                    style={{ whiteSpace: "pre-wrap" }}
                />
            </div>

            <p className="text-xs text-gray-500 mt-1">Formatting supported: bold, italic, underline, bullets, numbering.</p>
        </div>
    );
};

const StylePair = ({ label, textColor, bgColor, onTextColor, onBgColor }) => (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
        <div className="sm:col-span-1">
            <label className="block text-xs font-semibold text-gray-600 mb-1">{label}</label>
        </div>
        <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Text color</label>
            <input type="color" value={textColor} onChange={(e) => onTextColor(e.target.value)} className="h-10 w-full rounded-lg border border-gray-300 bg-white p-1" />
        </div>
        <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Background</label>
            <input type="color" value={bgColor} onChange={(e) => onBgColor(e.target.value)} className="h-10 w-full rounded-lg border border-gray-300 bg-white p-1" />
        </div>
    </div>
);

export default AddProductModal;
