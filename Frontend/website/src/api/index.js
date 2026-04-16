/**
 * Website API - mirrors app API structure. Same endpoints as React Native app.
 */
 import { API_BASE_CANDIDATES } from "../config";
 import { apiGet, apiPost, apiPut, apiDelete } from "./client";

const parseFetchResponse = async (res, fallbackLabel = "Request") => {
  const raw = await res.text();
  let data = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = { message: raw };
    }
  }
  if (!res.ok) {
    const error = new Error(data?.message || `${fallbackLabel} failed with status ${res.status}`);
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
};

const isNetworkFailure = (error) => {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("network request failed") ||
    message.includes("failed to fetch") ||
    message.includes("fetch failed") ||
    message.includes("networkerror")
  );
};

const fetchWithFallback = async (path, init = {}) => {
  const bases = Array.isArray(API_BASE_CANDIDATES) ? API_BASE_CANDIDATES : [];
  let lastError = null;

  for (const base of bases) {
    try {
      return await fetch(`${base}${path}`, init);
    } catch (error) {
      lastError = error;
      if (!isNetworkFailure(error)) {
        throw error;
      }
    }
  }

  if (lastError) {
    const error = new Error(
      `Network request failed after trying ${bases.length} API host(s). Check backend availability and NEXT_PUBLIC_API_URL.`
    );
    error.cause = lastError;
    throw error;
  }

  throw new Error("No API base URL configured");
};

export const getProducts = (params = {}) => {
  const clean = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v != null && v !== "")
  );
  const q = new URLSearchParams(clean).toString();
  return apiGet(`/products${q ? `?${q}` : ""}`);
};

export const getProductById = (id) => apiGet(`/products/${id}`);

export const getCategories = () => apiGet("/categories");

export const getBrands = () => apiGet("/brands");

export const sendOtp = (phone) => apiPost("/auth/send-otp", { phone });

export const verifyOtp = (phone, otp) => apiPost("/auth/verify-otp", { phone, otp });

export const loginWithPassword = (email, password) =>
  apiPost("/auth/login", { email, password });

export const sendPasswordResetOtp = (phone) =>
  apiPost("/auth/password-reset/send-otp", { phone });

export const verifyPasswordResetOtp = (phone, otp) =>
  apiPost("/auth/password-reset/verify-otp", { phone, otp });

export const completePasswordReset = (tempToken, data) =>
  fetchWithFallback(`/auth/password-reset/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tempToken}`,
    },
    body: JSON.stringify(data),
  }).then((r) => parseFetchResponse(r, "Password reset"));

export const completeRegistration = (tempToken, data) =>
  fetchWithFallback(`/auth/complete-registration`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tempToken}`,
    },
    body: JSON.stringify(data),
  }).then((r) => parseFetchResponse(r, "Registration"));

export const getMe = () => apiGet("/auth/me");

export const getCart = () => apiGet("/cart");

export const addToCart = (productId, quantity = 1) =>
  apiPost("/cart/add", { productId, quantity });

export const updateCartQty = (productId, quantity) =>
  apiPut("/cart/update", { productId, quantity });

export const removeFromCart = (productId) =>
  apiDelete(`/cart/remove/${productId}`);

export const clearCart = () => apiDelete("/cart/clear");

export const updateProfile = (data) => apiPut("/auth/me", data);

export const submitKyc = async (formData) => {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  if (!token) throw new Error("Not authenticated");
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180000);
  let res;
  try {
    res = await fetchWithFallback(`/auth/kyc`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Upload timed out. Please use smaller files and try again.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
  return parseFetchResponse(res, "KYC submission");
};

export const getWallet = () => apiGet("/wallet");

export const getMyOrders = () => apiGet("/orders/my");

export const getOrderTracking = (orderId) => apiGet(`/orders/${orderId}/tracking`);

export const getMarketingBanners = () => apiGet("/marketing/banners");

export const createWalletRechargeOrder = (amount) =>
  apiPost("/wallet/recharge", { amount });

export const verifyWalletRecharge = (data) =>
  apiPost("/wallet/recharge/verify", data);

export const getAddresses = () => apiGet("/addresses");

export const addAddress = (data) => apiPost("/addresses", data);

export const getMinimumCheckoutAmount = () =>
  apiGet("/config/minimum-checkout-amount");

export const createPaymentOrder = (data) =>
  apiPost("/payment/create-order", data || {});

export const verifyPayment = (data) =>
  apiPost("/payment/verify-payment", data);

export const getPaymentStatus = (razorpayOrderId) =>
  apiGet(`/payment/status/${encodeURIComponent(String(razorpayOrderId || "").trim())}`);

// --- Support API ---

export const getMySupportTickets = () => apiGet("/support/tickets");

export const getSupportTicketById = (id) => apiGet(`/support/tickets/${id}`);

export const createSupportTicket = (data) =>
  apiPost("/support/tickets", {
    message: data.message,
    subject: data.subject,
    category: data.category || data.problemType,
    priority: data.priority,
    contactName: data.contactName,
    contactPhone: data.contactPhone,
    contactEmail: data.contactEmail,
    attachment: data.attachment,
  }).then((res) => res.data);

export const sendSupportMessage = (ticketId, body, attachment) =>
  apiPost(`/support/tickets/${ticketId}/messages`, { body, ...(attachment && { attachment }) });
