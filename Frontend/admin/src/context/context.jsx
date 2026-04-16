import { useState } from "react";
import axios from "axios";
import { ContextApi } from "./contextApi";
import { ADMIN_API_BASE_URL, ADMIN_UPLOAD_BASE_URL } from "../lib/baseUrl";
import { getErrorMessage } from "../utils/errorHandler";

const BASE_URL = ADMIN_API_BASE_URL;
const PRODUCT_UPLOAD_TIMEOUT_MS = 90000;
const GENERAL_API_BASE_CANDIDATES = Array.from(
  new Set([BASE_URL, "https://backend.kuremedi.com/api"])
);
const PRODUCT_UPLOAD_BASE_CANDIDATES = Array.from(
  new Set([BASE_URL, "https://backend.kuremedi.com/api"])
);

const shouldRetryUploadOnAlternateHost = (error) => {
  if (error?.response) return false;
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || "").toLowerCase();
  return (
    code === "ERR_NETWORK" ||
    code === "ECONNABORTED" ||
    message.includes("network") ||
    message.includes("timeout")
  );
};

const buildProductUploadUrl = (base, id) =>
  id ? `${base}/products/${id}` : `${base}/products`;

const requestGetWithFallback = async (path) => {
  let lastError = null;

  for (let index = 0; index < GENERAL_API_BASE_CANDIDATES.length; index += 1) {
    const base = GENERAL_API_BASE_CANDIDATES[index];
    try {
      return await axios.get(`${base}${path}`);
    } catch (error) {
      lastError = error;
      const isLastCandidate = index === GENERAL_API_BASE_CANDIDATES.length - 1;
      if (isLastCandidate || !shouldRetryUploadOnAlternateHost(error)) {
        throw error;
      }
    }
  }

  throw lastError || new Error("Request failed");
};

const requestProductUploadWithFallback = async ({ method, id, formData }) => {
  let lastError = null;
  const triedHosts = [];

  for (let index = 0; index < PRODUCT_UPLOAD_BASE_CANDIDATES.length; index += 1) {
    const base = PRODUCT_UPLOAD_BASE_CANDIDATES[index];
    triedHosts.push(base);
    try {
      const response = await axios({
        method,
        url: buildProductUploadUrl(base, id),
        data: formData,
        timeout: PRODUCT_UPLOAD_TIMEOUT_MS,
        headers: { "Content-Type": "multipart/form-data" },
      });
      return response.data;
    } catch (error) {
      error.triedHosts = triedHosts.slice();
      lastError = error;
      const isLastCandidate = index === PRODUCT_UPLOAD_BASE_CANDIDATES.length - 1;
      if (isLastCandidate || !shouldRetryUploadOnAlternateHost(error)) {
        throw error;
      }
    }
  }

  if (lastError) {
    lastError.triedHosts = triedHosts.slice();
    throw lastError;
  }

  const fallbackError = new Error("Product upload failed");
  fallbackError.triedHosts = triedHosts.slice();
  throw fallbackError;
};

const normalizeOrderStatus = (status) => {
  const raw = String(status || "").trim().toUpperCase();
  if (!raw) return raw;
  if (raw === "SHIPPED") return "DISPATCHED";
  if (raw === "PROCESSING") return "CONFIRMED";
  return raw;
};

// Attach interceptor once to normalize axios errors across the admin app.
let adminAxiosInterceptorAttached = false;
if (!adminAxiosInterceptorAttached) {
  axios.defaults.timeout = 45000;
  axios.interceptors.response.use(
    (response) => response,
    (error) => {
      const friendly = getErrorMessage(error);
      if (error.response && !error.response.data) {
        error.response.data = { message: friendly };
      } else if (error.response?.data && !error.response.data.message) {
        error.response.data.message = friendly;
      }
      error.userMessage = friendly;
      error.message = friendly;
      return Promise.reject(error);
    }
  );
  adminAxiosInterceptorAttached = true;
}

export const ContextProvider = ({ children }) => {

  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState("Home"); // ✅ fixed typo

  const [selectedOrderId, setSelectedOrderId] = useState(null);


  const login = (name) => setUser(name);
  const logout = () => setUser(null);




  console.log("Base URL:", BASE_URL);

  const GetCategoryData = async () => {
    try {
      const response = await requestGetWithFallback("/categories");
      return response.data; // { success, data }
    } catch (error) {
      console.error("Error fetching categories:", error);
      throw error;
    }
  };


  const loginuser = async (data) => {
    console.log("🟢 Sending login data:", data);

    try {
      const response = await axios.post(`${BASE_URL}/auth/login`, data, {
        headers: {
          "Content-Type": "application/json",
        },
      });

      console.log("✅ Login Success:", response.data);
      return response;
    } catch (error) {
      console.error(
        "❌ Login error:",
        error.response?.data || error.message
      );
      throw error; // ✅ rethrow so your login page catches it
    }
  };

  const getAdminForgotSecurityQuestions = async (email) => {
    try {
      const response = await axios.post(
        `${BASE_URL}/auth/admin/forgot-password/questions`,
        { email },
        { headers: { "Content-Type": "application/json" } }
      );
      return response.data;
    } catch (error) {
      console.error("❌ Error loading admin forgot-password questions:", error?.response?.data || error);
      throw error;
    }
  };

  const verifyAdminForgotSecurityAnswers = async ({ email, securityQuestions }) => {
    try {
      const response = await axios.post(
        `${BASE_URL}/auth/admin/forgot-password/verify-security-answers`,
        { email, securityQuestions },
        { headers: { "Content-Type": "application/json" } }
      );
      return response.data;
    } catch (error) {
      console.error("❌ Error verifying admin security answers:", error?.response?.data || error);
      throw error;
    }
  };

  const resetAdminForgotPassword = async ({ resetToken, newPassword, confirmPassword }) => {
    try {
      const response = await axios.post(
        `${BASE_URL}/auth/admin/forgot-password/reset`,
        { resetToken, newPassword, confirmPassword },
        { headers: { "Content-Type": "application/json" } }
      );
      return response.data;
    } catch (error) {
      console.error("❌ Error resetting admin password via forgot-password flow:", error?.response?.data || error);
      throw error;
    }
  };


  const updateUserKYCStatus = async (userId, isVerified) => {
    try {
      const response = await axios.put(`${BASE_URL}/auth/kyc-status/${userId}`, {
        isVerified,
      });
      console.log("✅ KYC status updated:", response.data);
      return response.data;
    } catch (error) {
      console.error("❌ Error updating KYC status:", error);
      throw error;
    }
  };

  const AddCategoryData = async (categoryData) => {
    try {
      const response = await axios.post(
        `${BASE_URL}/categories`,
        categoryData
      );
      console.log("✅ Category added successfully:", response.data);
      return response.data; // { success, message, category }
    } catch (error) {
      console.error("❌ Error adding category:", error.response?.data || error);
      throw error;
    }
  };

  const createCategoryWithFormData = async (formData) => {
    try {
      const response = await axios.post(`${BASE_URL}/categories`, formData);
      return response.data;
    } catch (error) {
      console.error("❌ Error creating category:", error.response?.data || error);
      throw error;
    }
  };

  const updateCategoryWithFormData = async (id, formData) => {
    try {
      const response = await axios.put(`${BASE_URL}/categories/${id}`, formData);
      return response.data;
    } catch (error) {
      console.error("❌ Error updating category:", error.response?.data || error);
      throw error;
    }
  };

  const uploadImage = async (image) => {
    try {
      const formData = new FormData()
      formData.append('image', image)

      const response = await axios.post(`${BASE_URL}/file/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      }


      )
      console.log('Response image:', response)
      return response.data
    } catch (error) {
      return error
    }
  }

  const UpdateCategoryData = async (categoryData) => {
    try {
      if (!categoryData._id) {
        throw new Error("Category _id is required for update");
      }
      const response = await axios.put(
        `${BASE_URL}/categories/${categoryData._id}`,
        categoryData
      );
      console.log("✅ Category updated successfully:", response.data);
      return response.data; // { success, message, category }
    } catch (error) {
      console.error("❌ Error updating category:", error.response?.data || error);
      throw error;
    }
  };


  const DeleteCategory = async (categoryId) => {
    try {
      const response = await axios.delete(
        `${BASE_URL}/categories/${categoryId}`
      );
      console.log("✅ Category deleted successfully:", response.data);
      return response.data; // { success, message }
    } catch (error) {
      console.error("❌ Error deleting category:", error.response?.data || error);
      throw error;
    }
  };

  const GetSubCategoryData = async () => {
    try {
      const response = axios.post(`${BASE_URL}/subcategory/get`);
      //console.log('Categories fetched successfully:', response);
      console.table((await response).data.data);
      return response;

    }
    catch (error) {
      console.error("Error fetching categories:", error);
    }
  }

  const updatesubcategory = async (data) => {
    try {
      const res = axios.put(`${BASE_URL}/subcategory/update`, data)
      return res
    } catch (error) {
      console.error("update subcategory ", error)
    }
  }
  const createsubcategory = async (data) => {
    try {
      const res = axios.post(`${BASE_URL}/subcategory/create`, data)
      return res
    } catch (error) {
      console.error("update subcategory ", error)
    }
  }
  const deletesubcategory = async (_id) => {
    try {
      const res = await axios.delete(`${BASE_URL}/subcategory/delete`, {
        data: { _id }, // wrap in `data` for DELETE request
      });
      return res;
    } catch (error) {
      console.error("delete subcategory:", error);
    }
  };




  const getProducts = async () => {
    try {
      const response = await axios.get(`${BASE_URL}/products`);
      console.log("✅ Products fetched:", response.data);
      return response.data; // array of products
    } catch (error) {
      console.error("❌ Error fetching products:", error.response?.data || error);
      throw error;
    }
  };

  const createProducts = async (data) => {
    try {
      const response = await axios.post(`${BASE_URL}/products`, data);
      console.log("✅ Product created:", response.data);
      return response.data;
    } catch (error) {
      console.error("❌ Error creating product:", error.response?.data || error);
      throw error;
    }
  };

  const createProductWithFormData = async (formData) => {
    try {
      return await requestProductUploadWithFallback({
        method: "post",
        formData,
      });
    } catch (error) {
      console.error("❌ Error creating product:", error.response?.data || error);
      throw error;
    }
  };

  const updateProductWithFormData = async (id, formData) => {
    try {
      return await requestProductUploadWithFallback({
        method: "put",
        id,
        formData,
      });
    } catch (error) {
      console.error("❌ Error updating product:", error.response?.data || error);
      throw error;
    }
  };

  const updateProducts = async (data) => {
    try {
      if (!data._id) {
        throw new Error("Product _id is required");
      }
      const response = await axios.put(
        `${BASE_URL}/products/${data._id}`,
        data
      );
      console.log("✅ Product updated:", response.data);
      return response.data;
    } catch (error) {
      console.error("❌ Error updating product:", error.response?.data || error);
      throw error;
    }
  };

  const deleteProducts = async (id) => {
    try {
      const response = await axios.delete(`${BASE_URL}/products/${id}`);
      console.log("✅ Product deleted:", response.data);
      return response.data;
    } catch (error) {
      console.error("❌ Error deleting product:", error.response?.data || error);
      throw error;
    }
  };

  const bulkImportProducts = async (products) => {
    try {
      const response = await axios.post(`${BASE_URL}/products/bulk`, { products });
      return response.data;
    } catch (error) {
      console.error("❌ Bulk import failed:", error.response?.data || error);
      throw error;
    }
  };
  const getAllEnquiries = async () => {
    try {
      const res = await axios.get(`${BASE_URL}/enquiry/get`);
      return res.data;
    } catch (error) {
      console.error("Error fetching enquiries:", error.message);
      throw error;
    }
  };
  const updateOrderStatus = async (orderId, field, value, extraPayload = {}) => {
    try {
      const normalizedValue = field === "status" ? normalizeOrderStatus(value) : value;
      // dynamically assign the field to update
      const payload = { orderId, [field]: normalizedValue, ...extraPayload };
      const requestConfig = { headers: getAuthHeaders() };

      const response = await axios.put(
        `${BASE_URL}/payment/update-status`,
        payload,
        requestConfig
      );
      console.log("✅ Order status updated:", response.data);
      return response.data;
    } catch (error) {
      const statusCode = Number(error?.response?.status || 0);
      const canTryLegacyStatusRoute = field === "status";

      // Backward compatibility: some deployments still expose the legacy admin status route.
      if (canTryLegacyStatusRoute && [403, 404, 405].includes(statusCode)) {
        try {
          const legacyResponse = await axios.put(
            `${BASE_URL}/orders/${orderId}/status`,
            { status: normalizeOrderStatus(value) },
            { headers: getAuthHeaders() }
          );
          console.log("✅ Order status updated (legacy route):", legacyResponse.data);
          return legacyResponse.data;
        } catch (legacyError) {
          console.error(
            "❌ Error updating order status via legacy route:",
            legacyError.response?.data || legacyError
          );
          throw legacyError;
        }
      }

      console.error("❌ Error updating order status:", error.response?.data || error);
      throw error;
    }
  };

  const processOrderRefund = async (orderId) => {
    try {
      const response = await axios.post(
        `${BASE_URL}/payment/orders/${orderId}/process-refund`,
        {},
        { headers: getAuthHeaders() }
      );
      return response.data;
    } catch (error) {
      console.error("❌ Error processing refund:", error.response?.data || error);
      throw error;
    }
  };

  const retryShiprocketCancel = async (orderId) => {
    try {
      const response = await axios.post(
        `${BASE_URL}/payment/orders/${orderId}/retry-shiprocket-cancel`,
        {},
        { headers: getAuthHeaders() }
      );
      return response.data;
    } catch (error) {
      console.error("❌ Error retrying Shiprocket cancellation:", error.response?.data || error);
      throw error;
    }
  };

  const generateOrderAwb = async (orderId, force = false) => {
    try {
      const response = await axios.post(
        `${BASE_URL}/payment/orders/${orderId}/shiprocket/generate-awb`,
        { force },
        { headers: getAuthHeaders() }
      );
      return response.data;
    } catch (error) {
      console.error("❌ Error generating AWB:", error.response?.data || error);
      throw error;
    }
  };

  const getOrderById = async (orderId) => {
    try {
      const response = await axios.get(`${BASE_URL}/payment/orders/${orderId}`, {
        headers: getAuthHeaders(),
      });
      return response.data;
    } catch (error) {
      console.error("❌ Error fetching order by ID:", error);
      throw error;
    }
  };


  const getallOrders = async () => {
    const base = BASE_URL.replace(/\/$/, "");
    const url = base.includes("/api") ? `${base}/payment/orders` : `${base}/api/payment/orders`;
    try {
      const res = await axios.get(url, { headers: getAuthHeaders() });
      return res;
    } catch (error) {
      console.error("fetch orders error", error);
      throw error;
    }
  };

  const getReferralAmount = async () => {
    const base = BASE_URL.replace(/\/$/, "");
    const url = base.includes("/api") ? `${base}/config/referral-amount` : `${base}/api/config/referral-amount`;
    const res = await axios.get(url);
    return res.data?.amount ?? 50;
  };

  const setReferralAmount = async (amount) => {
    const base = BASE_URL.replace(/\/$/, "");
    const url = base.includes("/api") ? `${base}/config/referral-amount` : `${base}/api/config/referral-amount`;
    await axios.put(url, { amount });
    return { success: true };
  };

  const getReferralRewards = async () => {
    const res = await axios.get(`${BASE_URL}/config/referral-rewards`);
    return res.data || {};
  };

  const setReferralRewards = async (rewards) => {
    const res = await axios.put(`${BASE_URL}/config/referral-rewards`, rewards);
    return res.data?.rewards || rewards;
  };

  const [enquiries, setEnquiries] = useState([]);

  // 🔹 Fetch Enquiries
  const fetchEnquiries = async () => {
    try {
      const res = await fetch(`${BASE_URL}/lead`);
      const data = await res.json();
      setEnquiries(data);
    } catch (err) {
      console.error("Error fetching enquiries:", err);
    }
  };

  // 🔹 Add Enquiry
  const addEnquiry = async (newData) => {
    try {
      const res = await fetch(`${BASE_URL}/lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newData),
      });
      const data = await res.json();
      setEnquiries((prev) => [data, ...prev]);
    } catch (err) {
      console.error(err);
    }
  };

  // 🔹 Update Enquiry
  const updateEnquiry = async (id, updatedData) => {
    try {
      const res = await fetch(`${BASE_URL}/lead/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedData),
      });
      const data = await res.json();
      setEnquiries((prev) =>
        prev.map((item) => (item._id === id ? data : item))
      );
    } catch (err) {
      console.error(err);
    }
  };

  // 🔹 Delete Enquiry
  const deleteEnquiry = async (id) => {
    try {
      await fetch(`${BASE_URL}/lead/${id}`, { method: "DELETE" });
      setEnquiries((prev) => prev.filter((item) => item._id !== id));
    } catch (err) {
      console.error(err);
    }
  };


  //blog 


  // ✅ Fetch all categories
  const fetchblogCategories = async () => {
    try {
      const res = await axios.get(`${BASE_URL}/blogcategory/get`);
      return (res.data || []);
    } catch (error) {
      console.error("Error fetching blog categories:", error);
    }
  };

  // ✅ Create new category
  const addblogCategory = async (formData) => {
    try {
      const res = await axios.post(`${BASE_URL}/blogcategory/create`, formData);
      return ((prev) => [...prev, res.data]);
    } catch (error) {
      console.error("Error adding category:", error);
    }
  };

  // ✅ Update category
  const updateblogCategory = async (id, formData) => {
    try {
      const res = await axios.put(`${BASE_URL}/blogcategory/update/${id}`, formData);
      return ((prev) =>
        prev.map((cat) => (cat._id === id ? res.data : cat))
      );
    } catch (error) {
      console.error("Error updating category:", error);
    }
  };

  // ✅ Delete category
  const deleteblogCategory = async (id) => {
    try {
      await axios.delete(`${BASE_URL}/blogcategory/delete/${id}`);
      return ((prev) => prev.filter((cat) => cat._id !== id));
    } catch (error) {
      console.error("Error deleting category:", error);
    }
  };

  const FILE_URL = import.meta.env.VITE_FILE_URL;

  // ✅ Fetch all blogs
  const fetchBlogs = async () => {
    try {
      const res = await axios.get(`${BASE_URL}/blog/get`);
      return res.data; // return array directly
    } catch (err) {
      console.error("Error fetching blogs:", err);
      return [];
    }
  };

  // ✅ Get blog by ID
  const getBlogById = async (id) => {
    try {
      const res = await axios.get(`${BASE_URL}/blog/get/${id}`);
      return res.data;
    } catch (err) {
      console.error("Error fetching blog:", err);
      return null;
    }
  };

  // ✅ Create new blog
  const addBlog = async (formData) => {
    try {
      const res = await axios.post(`${BASE_URL}/blog/create`, formData);
      return res.data;
    } catch (err) {
      console.error("Error adding blog:", err);
      throw err;
    }
  };

  // ✅ Update blog
  const updateBlog = async (id, updatedData) => {
    try {
      const res = await axios.put(`${BASE_URL}/blog/update/${id}`, updatedData);
      return res.data;
    } catch (err) {
      console.error("Error updating blog:", err);
      throw err;
    }
  };

  // ✅ Delete blog
  const deleteBlog = async (id) => {
    try {
      const res = await axios.delete(`${BASE_URL}/blog/delete/${id}`);
      return res.data;
    } catch (err) {
      console.error("Error deleting blog:", err);
      throw err;
    }
  };



  const getAllUsers = async () => {
    try {
      const response = await axios.get(`${BASE_URL}/auth/users`, {
        headers: getAuthHeaders(),
      });
      return response.data;
    } catch (error) {
      console.error(" Error fetching users:", error?.response?.data || error);
      throw error;
    }
  };

  const changeAdminPassword = async ({ currentPassword, newPassword, confirmPassword }) => {
    try {
      const response = await axios.put(
        `${BASE_URL}/auth/admin/password`,
        { currentPassword, newPassword, confirmPassword },
        { headers: { ...getAuthHeaders(), "Content-Type": "application/json" } }
      );
      return response.data;
    } catch (error) {
      console.error("❌ Error changing admin password:", error?.response?.data || error);
      throw error;
    }
  };

  const verifyAdminSecurityPassword = async (password) => {
    try {
      const response = await axios.post(
        `${BASE_URL}/auth/admin/security/verify-password`,
        { password },
        { headers: { ...getAuthHeaders(), "Content-Type": "application/json" } }
      );
      return response.data;
    } catch (error) {
      console.error("❌ Error verifying admin security password:", error?.response?.data || error);
      throw error;
    }
  };

  const getAdminSecurityQuestions = async () => {
    try {
      const response = await axios.get(`${BASE_URL}/auth/admin/security-questions`, {
        headers: getAuthHeaders(),
      });
      return response.data;
    } catch (error) {
      console.error("❌ Error loading admin security questions:", error?.response?.data || error);
      throw error;
    }
  };

  const updateAdminSecurityQuestions = async (securityQuestions) => {
    try {
      const response = await axios.put(
        `${BASE_URL}/auth/admin/security-questions`,
        { securityQuestions },
        { headers: { ...getAuthHeaders(), "Content-Type": "application/json" } }
      );
      return response.data;
    } catch (error) {
      console.error("❌ Error updating admin security questions:", error?.response?.data || error);
      throw error;
    }
  };

  const requestAdminEmailChangeOldOtp = async ({ currentEmail, newEmail }) => {
    try {
      const response = await axios.post(
        `${BASE_URL}/auth/admin/email-change/request-old`,
        { currentEmail, newEmail },
        { headers: { ...getAuthHeaders(), "Content-Type": "application/json" } }
      );
      return response.data;
    } catch (error) {
      console.error(
        "❌ Error requesting current email OTP:",
        error?.response?.data?.message || error?.message || "Unknown error",
        error?.response?.data || error
      );
      throw error;
    }
  };

  const verifyAdminEmailChangeOldOtp = async ({ currentEmail, newEmail, otp }) => {
    try {
      const response = await axios.post(
        `${BASE_URL}/auth/admin/email-change/verify-old`,
        { currentEmail, newEmail, otp },
        { headers: { ...getAuthHeaders(), "Content-Type": "application/json" } }
      );
      return response.data;
    } catch (error) {
      console.error(
        "❌ Error verifying current email OTP:",
        error?.response?.data?.message || error?.message || "Unknown error",
        error?.response?.data || error
      );
      throw error;
    }
  };

  const verifyAdminEmailChangeNewOtp = async ({ currentEmail, newEmail, otp }) => {
    try {
      const response = await axios.post(
        `${BASE_URL}/auth/admin/email-change/verify-new`,
        { currentEmail, newEmail, otp },
        { headers: { ...getAuthHeaders(), "Content-Type": "application/json" } }
      );
      return response.data;
    } catch (error) {
      console.error(
        "❌ Error verifying new email OTP:",
        error?.response?.data?.message || error?.message || "Unknown error",
        error?.response?.data || error
      );
      throw error;
    }
  };

  const getMyProfile = async () => {
    try {
      const response = await axios.get(`${BASE_URL}/auth/me`, {
        headers: getAuthHeaders(),
      });
      return response.data;
    } catch (error) {
      console.error("❌ Error fetching my profile:", error?.response?.data || error);
      throw error;
    }
  };

  const getAdminUsers = async () => {
    try {
      const response = await axios.get(`${BASE_URL}/auth/admin/users`, {
        headers: getAuthHeaders(),
      });
      return response.data;
    } catch (error) {
      console.error("❌ Error fetching admin users:", error?.response?.data || error);
      throw error;
    }
  };

  const createAdminUser = async ({ name, email, password }) => {
    try {
      const response = await axios.post(
        `${BASE_URL}/auth/admin/users`,
        { name, email, password },
        { headers: { ...getAuthHeaders(), "Content-Type": "application/json" } }
      );
      return response.data;
    } catch (error) {
      console.error("❌ Error creating admin user:", error?.response?.data || error);
      throw error;
    }
  };

  const deleteAdminUser = async (userId) => {
    try {
      const response = await axios.delete(`${BASE_URL}/auth/admin/users/${userId}`, {
        headers: getAuthHeaders(),
      });
      return response.data;
    } catch (error) {
      console.error("❌ Error deleting admin user:", error?.response?.data || error);
      throw error;
    }
  };

  const deleteUser = async (userId) => {
    try {
      const response = await axios.delete(`${BASE_URL}/auth/users/${userId}`, {
        headers: getAuthHeaders(),
      });
      return response.data;
    } catch (error) {
      console.error(" Error deleting user:", error?.response?.data || error);
      throw error;
    }
  };

  const blockUser = async (userId, isBlocked, reason = "") => {
    try {
      const response = await axios.patch(
        `${BASE_URL}/auth/users/${userId}/block`,
        { isBlocked, reason },
        { headers: { ...getAuthHeaders(), "Content-Type": "application/json" } }
      );
      return response.data;
    } catch (error) {
      console.error(" Error blocking/unblocking user:", error?.response?.data || error);
      throw error;
    }
  };

  const getDeletedUsersHistory = async (limit = 50) => {
    try {
      const response = await axios.get(`${BASE_URL}/auth/users/deleted-history?limit=${encodeURIComponent(limit)}`, {
        headers: getAuthHeaders(),
      });
      return response.data;
    } catch (error) {
      console.error(" Error fetching deleted users history:", error?.response?.data || error);
      throw error;
    }
  };


  const kycStatusUpdate = async (userId, status) => {
    try {
      const response = await axios.put(`${BASE_URL}/auth/kycstatus`, {
        userId,
        kycStatus: status,
      });
      console.log("✅ KYC status updated:", response.data);
      return response.data;
    } catch (error) {
      console.error(" Error updating KYC status:", error);
    }
  };


  // Brand APIs
  const getBrands = async () => {
    try {
      const response = await requestGetWithFallback("/brands");
      return response.data; // { success, data }
    } catch (error) {
      console.error("❌ Error fetching brands:", error.response?.data || error);
      throw error;
    }
  };

  const createBrand = async (data) => {
    try {
      const response = await axios.post(`${BASE_URL}/brands`, data);
      return response.data;
    } catch (error) {
      console.error("❌ Error creating brand:", error.response?.data || error);
      throw error;
    }
  };

  const createBrandWithFormData = async (formData) => {
    try {
      const response = await axios.post(`${BASE_URL}/brands`, formData);
      return response.data;
    } catch (error) {
      console.error("❌ Error creating brand:", error.response?.data || error);
      throw error;
    }
  };

  const updateBrandWithFormData = async (id, formData) => {
    try {
      const response = await axios.put(`${BASE_URL}/brands/${id}`, formData);
      return response.data;
    } catch (error) {
      console.error("❌ Error updating brand:", error.response?.data || error);
      throw error;
    }
  };

  const updateBrand = async (id, data) => {
    try {
      const response = await axios.put(`${BASE_URL}/brands/${id}`, data);
      return response.data;
    } catch (error) {
      console.error("❌ Error updating brand:", error.response?.data || error);
      throw error;
    }
  };

  const deleteBrand = async (id) => {
    try {
      const response = await axios.delete(`${BASE_URL}/brands/${id}`);
      return response.data;
    } catch (error) {
      console.error("❌ Error deleting brand:", error.response?.data || error);
      throw error;
    }
  };

  const getProductsById = async (id) => {
    try {
      // const response = await axios.get(`${BASE_URL}/products/${id}`);
      return response.data;
    } catch (error) {
      console.error("❌ Error fetching product:", error.response?.data || error);
      throw error;
    }
  };

  const updateProduct = async (id, data) => {
    try {
      const response = await axios.put(`${BASE_URL}/products/${id}`, data);
      return response.data;
    } catch (error) {
      console.error("❌ Error updating product:", error.response?.data || error);
      throw error;
    }
  };

  const updateKYCStatus = async (userId, status) => {
    try {
      const response = await axios.put(
        `${BASE_URL}/auth/kyc-status/${userId}`,
        { status },
        { headers: getAuthHeaders() }
      );
      console.log("✅ KYC status updated:", response.data);
      return response.data;
    } catch (error) {
      console.error("❌ Error updating KYC status:", error.response?.data || error);
      throw error;
    }
  };

  const getKycHistory = async () => {
    try {
      const response = await axios.get(`${BASE_URL}/auth/kyc-history`, {
        headers: getAuthHeaders(),
      });
      return response.data;
    } catch (error) {
      const statusCode = Number(error?.response?.status || 0);
      const message = String(error?.response?.data?.message || error?.message || "").toLowerCase();
      const isMissingRoute = statusCode === 404 || message.includes("route not found");

      if (!isMissingRoute) {
        console.error("❌ Error fetching KYC history:", error.response?.data || error);
        throw error;
      }

      // Backward compatibility: derive minimal history from /auth/users when /auth/kyc-history is not deployed.
      const usersResponse = await axios.get(`${BASE_URL}/auth/users`, {
        headers: getAuthHeaders(),
      });
      const users = Array.isArray(usersResponse?.data?.users)
        ? usersResponse.data.users
        : Array.isArray(usersResponse?.data)
        ? usersResponse.data
        : [];

      const mapUserToKycHistory = (user) => {
        const docs = {
          aadharDoc: String(user?.aadharDoc || ""),
          drugLicenseDoc: String(user?.drugLicenseDoc || ""),
          gstDoc: String(user?.gstDoc || ""),
          panDoc: String(user?.panDoc || ""),
          shopImage: String(user?.shopImage || ""),
          cancelChequeDoc: String(user?.cancelChequeDoc || ""),
        };

        return {
          _id: user?._id,
          name: user?.name || "",
          email: user?.email || "",
          phone: user?.phone || "",
          role: user?.role || "user",
          currentStatus: user?.kyc || "BLANK",
          currentRejectionReason: user?.kycRejectionReason || "",
          hasAnyDocument: Object.values(docs).some(Boolean),
          documents: docs,
          history: [
            {
              status: user?.kyc || "BLANK",
              event: "LEGACY_SNAPSHOT",
              rejectionReason: user?.kycRejectionReason || "",
              changedAt: user?.updatedAt || user?.createdAt || new Date().toISOString(),
              changedBy: null,
            },
          ],
          updatedAt: user?.updatedAt,
          createdAt: user?.createdAt,
        };
      };

      return {
        success: true,
        users: users.map(mapUserToKycHistory),
        fallback: true,
      };
    }
  };

  const deleteAllKycDocuments = async (userId) => {
    try {
      const response = await axios.delete(`${BASE_URL}/auth/kyc-documents/${userId}`, {
        headers: getAuthHeaders(),
      });
      return response.data;
    } catch (error) {
      const statusCode = Number(error?.response?.status || 0);
      const message = String(error?.response?.data?.message || error?.message || "").toLowerCase();
      const isMissingRoute = statusCode === 404 || message.includes("route not found");
      if (isMissingRoute) {
        throw new Error("Delete endpoint not deployed on backend yet. Please deploy latest backend.");
      }
      console.error("❌ Error deleting KYC documents:", error.response?.data || error);
      throw error;
    }
  };

  const getAuthHeaders = () => {
    const token = localStorage.getItem("adminToken");
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const getAgents = async (statusFilter) => {
    try {
      const url = statusFilter ? `${BASE_URL}/agents?status=${encodeURIComponent(statusFilter)}` : `${BASE_URL}/agents`;
      const response = await axios.get(url, { headers: getAuthHeaders() });
      const data = response.data;
      return {
        agents: Array.isArray(data?.agents) ? data.agents : [],
        total: data?.total ?? 0,
        active: data?.active ?? 0,
        pending: data?.pending ?? 0,
        inactive: data?.inactive ?? 0,
        retailers: data?.retailers ?? 0,
        payout: data?.payout ?? 0,
      };
    } catch (error) {
      console.error("❌ Error fetching agents:", error.response?.data || error);
      throw error;
    }
  };

  const getAgentById = async (id) => {
    try {
      const response = await axios.get(`${BASE_URL}/agents/${id}`, { headers: getAuthHeaders() });
      return response.data;
    } catch (error) {
      console.error("❌ Error fetching agent:", error.response?.data || error);
      throw error;
    }
  };

  const createAgent = async (data) => {
    try {
      const response = await axios.post(`${BASE_URL}/agents`, data, { headers: { ...getAuthHeaders(), "Content-Type": "application/json" } });
      return response.data;
    } catch (error) {
      console.error("❌ Error creating agent:", error.response?.data || error);
      throw error;
    }
  };

  const updateAgent = async (id, data) => {
    try {
      const response = await axios.put(`${BASE_URL}/agents/${id}`, data, { headers: { ...getAuthHeaders(), "Content-Type": "application/json" } });
      return response.data;
    } catch (error) {
      console.error("❌ Error updating agent:", error.response?.data || error);
      throw error;
    }
  };

  const deleteAgent = async (id) => {
    try {
      const response = await axios.delete(`${BASE_URL}/agents/${id}`, { headers: getAuthHeaders() });
      return response.data;
    } catch (error) {
      console.error("❌ Error deleting agent:", error.response?.data || error);
      throw error;
    }
  };

  const updateAgentKycStatus = async (agentId, status) => {
    try {
      const response = await axios.put(
        `${BASE_URL}/agents/${agentId}/kyc-status`,
        { status },
        { headers: { ...getAuthHeaders(), "Content-Type": "application/json" } }
      );
      return response.data;
    } catch (error) {
      console.error("❌ Error updating agent KYC:", error.response?.data || error);
      throw error;
    }
  };

  const getUploadBaseUrl = () => ADMIN_UPLOAD_BASE_URL;

  const getMarketingBanners = async () => {
    try {
      const response = await axios.get(`${BASE_URL}/marketing/admin/banners`, { headers: getAuthHeaders() });
      return response.data;
    } catch (error) {
      console.error("❌ Error fetching marketing banners:", error.response?.data || error);
      throw error;
    }
  };

  const createMarketingBanner = async ({
    name,
    image,
    isActive = true,
    redirectUrl = "",
    ctaText = "Shop now",
    title = "",
    subtitle = "",
    textColor = "#ffffff",
    subtitleColor = "#e2e8f0",
    buttonColor = "#0f172a",
  }) => {
    try {
      const formData = new FormData();
      formData.append("name", name);
      formData.append("isActive", String(isActive));
      formData.append("image", image);
      formData.append("redirectUrl", redirectUrl);
      formData.append("ctaText", ctaText);
      formData.append("title", title);
      formData.append("subtitle", subtitle);
      formData.append("textColor", textColor);
      formData.append("subtitleColor", subtitleColor);
      formData.append("buttonColor", buttonColor);
      const response = await axios.post(`${BASE_URL}/marketing/banners`, formData, {
        headers: {
          ...getAuthHeaders(),
          "Content-Type": "multipart/form-data",
        },
      });
      return response.data;
    } catch (error) {
      console.error("❌ Error creating marketing banner:", error.response?.data || error);
      throw error;
    }
  };

  const updateMarketingBanner = async (id, payload = {}) => {
    try {
      const formData = new FormData();
      if (payload.name !== undefined) formData.append("name", payload.name);
      if (payload.isActive !== undefined) formData.append("isActive", String(payload.isActive));
      if (payload.image) formData.append("image", payload.image);
      if (payload.redirectUrl !== undefined) formData.append("redirectUrl", payload.redirectUrl);
      if (payload.ctaText !== undefined) formData.append("ctaText", payload.ctaText);
      if (payload.title !== undefined) formData.append("title", payload.title);
      if (payload.subtitle !== undefined) formData.append("subtitle", payload.subtitle);
      if (payload.textColor !== undefined) formData.append("textColor", payload.textColor);
      if (payload.subtitleColor !== undefined) formData.append("subtitleColor", payload.subtitleColor);
      if (payload.buttonColor !== undefined) formData.append("buttonColor", payload.buttonColor);
      const response = await axios.put(`${BASE_URL}/marketing/banners/${id}`, formData, {
        headers: {
          ...getAuthHeaders(),
          "Content-Type": "multipart/form-data",
        },
      });
      return response.data;
    } catch (error) {
      console.error("❌ Error updating marketing banner:", error.response?.data || error);
      throw error;
    }
  };

  const deleteMarketingBanner = async (id) => {
    try {
      const response = await axios.delete(`${BASE_URL}/marketing/banners/${id}`, { headers: getAuthHeaders() });
      return response.data;
    } catch (error) {
      console.error("❌ Error deleting marketing banner:", error.response?.data || error);
      throw error;
    }
  };

  const getReferralsTracking = async () => {
    try {
      const response = await axios.get(`${BASE_URL}/agents/referrals`, { headers: getAuthHeaders() });
      return response.data;
    } catch (error) {
      console.error("❌ Error fetching referrals:", error.response?.data || error);
      throw error;
    }
  };

  const reprocessReferralReward = async (userId) => {
    try {
      const response = await axios.post(
        `${BASE_URL}/auth/reprocess-referral-reward/${userId}`,
        {},
        { headers: getAuthHeaders() }
      );
      return response.data;
    } catch (error) {
      console.error("❌ Reprocess referral reward:", error.response?.data || error);
      throw error;
    }
  };

  // Support / Customer care (admin)
  const getSupportTickets = async (params = {}) => {
    try {
      const q = new URLSearchParams(params).toString();
      const url = q ? `${BASE_URL}/support/admin/tickets?${q}` : `${BASE_URL}/support/admin/tickets`;
      const response = await axios.get(url, { headers: getAuthHeaders() });
      return response.data;
    } catch (error) {
      console.error(" Error fetching support tickets:", error.response?.data || error);
      throw error;
    }
  };

  const getSupportTicketById = async (id) => {
    try {
      const response = await axios.get(`${BASE_URL}/support/admin/tickets/${id}`, { headers: getAuthHeaders() });
      return response.data;
    } catch (error) {
      console.error(" Error fetching support ticket:", error.response?.data || error);
      throw error;
    }
  };

  const replySupportTicket = async (id, body) => {
    try {
      const response = await axios.post(
        `${BASE_URL}/support/admin/tickets/${id}/reply`,
        { body },
        { headers: { ...getAuthHeaders(), "Content-Type": "application/json" } }
      );
      return response.data;
    } catch (error) {
      console.error(" Error replying to ticket:", error.response?.data || error);
      throw error;
    }
  };

  const updateSupportTicketStatus = async (id, status) => {
    try {
      const response = await axios.put(
        `${BASE_URL}/support/admin/tickets/${id}/status`,
        { status },
        { headers: { ...getAuthHeaders(), "Content-Type": "application/json" } }
      );
      return response.data;
    } catch (error) {
      console.error(" Error updating ticket status:", error.response?.data || error);
      throw error;
    }
  };

  const addSupportCallNote = async (id, note) => {
    try {
      const response = await axios.post(
        `${BASE_URL}/support/admin/tickets/${id}/call-note`,
        { note: note || "Outbound call made." },
        { headers: { ...getAuthHeaders(), "Content-Type": "application/json" } }
      );
      return response.data;
    } catch (error) {
      console.error("❌ Error adding call note:", error.response?.data || error);
      throw error;
    }
  };

  const initiateSupportCall = async (id) => {
    try {
      const response = await axios.post(
        `${BASE_URL}/support/admin/tickets/${id}/initiate-call`,
        {},
        { headers: getAuthHeaders() }
      );
      return response.data;
    } catch (error) {
      console.error("❌ Error initiating call:", error.response?.data || error);
      throw error;
    }
  };

  const updateSupportTicketNotes = async (id, adminNotes) => {
    try {
      const response = await axios.put(
        `${BASE_URL}/support/admin/tickets/${id}/notes`,
        { adminNotes },
        { headers: { ...getAuthHeaders(), "Content-Type": "application/json" } }
      );
      return response.data;
    } catch (error) {
      console.error("❌ Error updating ticket notes:", error.response?.data || error);
      throw error;
    }
  };

  return (
    <ContextApi.Provider
      value={{
        fetchBlogs,
        getBlogById,
        getProducts,
        loginuser,
        getAdminForgotSecurityQuestions,
        verifyAdminForgotSecurityAnswers,
        resetAdminForgotPassword,
        updateProduct,
        addBlog,
        getProductsById,
        selectedOrderId,
        setSelectedOrderId,
        getOrderById,
        updateKYCStatus,
        getKycHistory,
        deleteAllKycDocuments,
        updateBlog, getAllUsers, deleteUser, blockUser, getDeletedUsersHistory, kycStatusUpdate, updateUserKYCStatus,
        changeAdminPassword, verifyAdminSecurityPassword, getAdminSecurityQuestions, updateAdminSecurityQuestions, requestAdminEmailChangeOldOtp, verifyAdminEmailChangeOldOtp, verifyAdminEmailChangeNewOtp, getMyProfile, getAdminUsers, createAdminUser, deleteAdminUser,
        deleteBlog, fetchblogCategories, addblogCategory, updateblogCategory, deleteblogCategory, enquiries, addEnquiry, updateEnquiry, deleteEnquiry, fetchEnquiries, user, login, getallOrders, createProducts, createProductWithFormData, updateProductWithFormData, updateProducts, deleteProducts, bulkImportProducts, deletesubcategory, createsubcategory, updatesubcategory, updateOrderStatus, processOrderRefund, retryShiprocketCancel, generateOrderAwb, getAllEnquiries, logout, activeTab, setActiveTab, GetSubCategoryData, GetCategoryData, AddCategoryData, createCategoryWithFormData, updateCategoryWithFormData, uploadImage, UpdateCategoryData, DeleteCategory, getBrands, createBrand, createBrandWithFormData, updateBrand, updateBrandWithFormData, deleteBrand, getReferralAmount, setReferralAmount, getReferralRewards, setReferralRewards,
        getAgents, getAgentById, createAgent, updateAgent, deleteAgent, updateAgentKycStatus, getUploadBaseUrl, getReferralsTracking, reprocessReferralReward,
        getMarketingBanners, createMarketingBanner, updateMarketingBanner, deleteMarketingBanner,
        getSupportTickets, getSupportTicketById, replySupportTicket, updateSupportTicketStatus, addSupportCallNote, updateSupportTicketNotes, initiateSupportCall,
      }}
    >
      {children}
    </ContextApi.Provider>

  );
};
