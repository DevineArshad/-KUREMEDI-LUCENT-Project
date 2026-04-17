import axios from "axios";

let shiprocketToken = "";
let tokenExpiry = null;
const FALLBACK_ITEM_WEIGHT_KG = 0.5;

const resolveItemWeight = (weight) => {
  const numeric = Number(weight);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.round(numeric * 100) / 100;
  }
  return FALLBACK_ITEM_WEIGHT_KG;
};

const roundWeight = (weight) => Math.round(Number(weight || 0) * 100) / 100;

const clearShiprocketTokenCache = () => {
  shiprocketToken = "";
  tokenExpiry = null;
};

const getShiprocketErrorMessage = (err) => {
  return String(
    err?.response?.data?.message ||
      err?.response?.data?.error ||
      err?.response?.data?.errors?.[0]?.message ||
      err?.shiprocket?.message ||
      err?.message ||
      ""
  )
    .trim()
    .toLowerCase();
};

const shouldReauthenticateShiprocket = (err) => {
  const status = Number(err?.response?.status || err?.shiprocket?.status || 0);
  if (status === 401 || status === 403) return true;

  const message = getShiprocketErrorMessage(err);
  return (
    message.includes("access forbidden") ||
    message.includes("unauthorized") ||
    message.includes("invalid token") ||
    message.includes("token expired")
  );
};

const withShiprocketAuthRetry = async (requestFn) => {
  let refreshedOnce = false;

  while (true) {
    const token = await getShiprocketToken({ forceRefresh: refreshedOnce });

    try {
      return await requestFn(token);
    } catch (err) {
      if (refreshedOnce || !shouldReauthenticateShiprocket(err)) {
        throw err;
      }
      clearShiprocketTokenCache();
      refreshedOnce = true;
    }
  }
};

/* ---------------------------------------------------------
   1️⃣ Login & Auto Cache Token
---------------------------------------------------------- */
export const getShiprocketToken = async ({ forceRefresh = false } = {}) => {
  if (!process.env.SHIPROCKET_EMAIL || !process.env.SHIPROCKET_PASSWORD) {
    const e = new Error("Shiprocket credentials missing. Set SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD in .env");
    e.shiprocket = { stage: "config", message: "SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD required" };
    throw e;
  }
  try {
    if (!forceRefresh && shiprocketToken && tokenExpiry && new Date() < tokenExpiry) {
      return shiprocketToken;
    }

    const res = await axios.post(
      "https://apiv2.shiprocket.in/v1/external/auth/login",
      {
        email: process.env.SHIPROCKET_EMAIL,
        password: process.env.SHIPROCKET_PASSWORD,
      },
    );

    shiprocketToken = res.data.token;
    tokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    return shiprocketToken;
  } catch (err) {
    const responseMessage =
      err.response?.data?.message ||
      err.response?.data?.error ||
      err.response?.data?.errors?.[0]?.message ||
      err.message ||
      "Failed to login to Shiprocket";
    const e = new Error(responseMessage);
    e.shiprocket = {
      stage: "login",
      message: responseMessage,
      response: err.response?.data,
      status: err.response?.status,
    };
    throw e;
  }
};

/* ---------------------------------------------------------
   2️⃣ Create Shiprocket Order (After Payment)
---------------------------------------------------------- */
/**
 * Map our Order document (user populated, items) to the shape createShiprocketOrder expects.
 * Use this when calling from payment.controller (after payment success).
 */
export const mapOrderToShiprocketPayload = (orderDoc) => {
  const addr = orderDoc.shippingAddress || {};
  const user = orderDoc.user || {};
  const rawAddress = addr.address || "";

  // Try to extract pincode (last 6-digit number in address) if not explicitly provided
  let inferredPincode = addr.pincode || "";
  if (!inferredPincode && rawAddress) {
    const match = rawAddress.match(/(\d{6})(?!.*\d{6})/);
    if (match) inferredPincode = match[1];
  }

  // Try to infer city from comma-separated address parts if not provided
  let inferredCity = addr.city || "";
  if (!inferredCity && rawAddress) {
    const parts = rawAddress
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length >= 2) {
      inferredCity = parts[parts.length - 2]; // e.g. "... Azamgarh, Azamgarh 276001"
    } else if (parts.length === 1) {
      inferredCity = parts[0];
    }
  }

  // Shiprocket requires billing_state; infer from pincode or address when missing
  const pincodeToState = {
    11: "Delhi", 12: "Haryana", 13: "Uttar Pradesh", 14: "Punjab", 15: "Punjab",
    16: "Chandigarh", 17: "Himachal Pradesh", 18: "Jammu and Kashmir", 19: "Punjab",
    20: "Maharashtra", 21: "Madhya Pradesh", 22: "Madhya Pradesh", 23: "Uttar Pradesh",
    24: "Uttar Pradesh", 25: "Uttar Pradesh", 26: "Uttar Pradesh", 27: "Uttar Pradesh",
    28: "Uttar Pradesh", 29: "Uttar Pradesh", 30: "Rajasthan", 31: "Rajasthan",
    32: "Rajasthan", 33: "Punjab", 34: "Rajasthan", 36: "Gujarat", 37: "Gujarat",
    38: "Gujarat", 39: "Gujarat", 40: "Maharashtra", 41: "Maharashtra", 42: "Maharashtra",
    43: "Maharashtra", 44: "Maharashtra", 45: "Madhya Pradesh", 46: "Madhya Pradesh",
    48: "Madhya Pradesh", 49: "Chhattisgarh", 50: "Telangana", 51: "Andhra Pradesh",
    52: "Andhra Pradesh", 53: "Andhra Pradesh", 56: "Karnataka", 57: "Karnataka",
    58: "Karnataka", 59: "Karnataka", 60: "Tamil Nadu", 61: "Tamil Nadu", 62: "Tamil Nadu",
    63: "Tamil Nadu", 64: "Tamil Nadu", 67: "Andhra Pradesh", 68: "Kerala",
    69: "Kerala", 70: "West Bengal", 71: "West Bengal", 72: "West Bengal",
    73: "West Bengal", 74: "West Bengal", 75: "Odisha", 76: "Odisha", 77: "Odisha",
    78: "Assam", 79: "Assam", 80: "Bihar", 81: "Bihar", 82: "Jharkhand",
    83: "Uttar Pradesh", 84: "Bihar", 85: "Jharkhand", 91: "Uttar Pradesh",
  };
  let inferredState = (addr.state || "").trim();
  if (!inferredState && inferredPincode.length >= 2) {
    const prefix = parseInt(inferredPincode.slice(0, 2), 10);
    inferredState = pincodeToState[prefix] || "Uttar Pradesh";
  }
  // Try to infer from address text
  if (!inferredState && rawAddress) {
    const upper = rawAddress.toUpperCase();
    if (upper.includes("UTTAR PRADESH") || upper.includes(" U.P") || upper.includes(", UP") || upper.includes("UP ")) inferredState = "Uttar Pradesh";
    else if (upper.includes("MAHARASHTRA")) inferredState = "Maharashtra";
    else if (upper.includes("RAJASTHAN")) inferredState = "Rajasthan";
    else if (upper.includes("KARNATAKA")) inferredState = "Karnataka";
    else if (upper.includes("TAMIL NADU") || upper.includes("TAMILNADU")) inferredState = "Tamil Nadu";
    else if (upper.includes("WEST BENGAL") || upper.includes("BENGAL")) inferredState = "West Bengal";
    else if (upper.includes("GUJARAT")) inferredState = "Gujarat";
    else if (upper.includes("MADHYA PRADESH") || upper.includes(" M.P") || upper.includes("MP ")) inferredState = "Madhya Pradesh";
    else if (upper.includes("BIHAR")) inferredState = "Bihar";
    else if (upper.includes("DELHI") || upper.includes(" NCR")) inferredState = "Delhi";
    else if (upper.includes("PUNJAB")) inferredState = "Punjab";
    else if (upper.includes("HARYANA")) inferredState = "Haryana";
    else if (upper.includes("KERALA")) inferredState = "Kerala";
    else if (upper.includes("ANDHRA PRADESH") || upper.includes("ANDHRA")) inferredState = "Andhra Pradesh";
    else if (upper.includes("TELANGANA")) inferredState = "Telangana";
    else if (upper.includes("ODISHA") || upper.includes("ORISSA")) inferredState = "Odisha";
    else if (upper.includes("CHHATTISGARH")) inferredState = "Chhattisgarh";
    else if (upper.includes("ASSAM")) inferredState = "Assam";
    else if (upper.includes("JHARKHAND")) inferredState = "Jharkhand";
    else if (upper.includes("HIMACHAL")) inferredState = "Himachal Pradesh";
    else if (upper.includes("JAMMU") || upper.includes("KASHMIR")) inferredState = "Jammu and Kashmir";
    else inferredState = "Uttar Pradesh";
  }
  if (!inferredState) inferredState = "Uttar Pradesh";

  return {
    _id: orderDoc._id,
    delivery_address: {
      address_line:
        [addr.address, addr.shopName].filter(Boolean).join(", ") ||
        "Address not provided",
      city: inferredCity || addr.city || addr.shopName || "",
      pincode: inferredPincode || "",
      state: inferredState,
    },
    userId: {
      name: user.name || "Customer",
      email: user.email || "noemail@example.com",
      mobile: user.phone || "9999999999",
    },
    cartItems: (orderDoc.items || []).map((it) => ({
      name: it.productName || "Product",
      productId: it.product?._id || it.product,
      quantity: it.quantity || 1,
      price: it.price || 0,
      weight: resolveItemWeight(it.weight),
    })),
    totalAmt: orderDoc.payableAmount ?? orderDoc.totalAmount ?? 0,
    totalWeight:
      Number(orderDoc.totalWeight) > 0
        ? Number(orderDoc.totalWeight)
        : (orderDoc.items || []).reduce((total, it) => {
            return total + resolveItemWeight(it.weight) * Number(it.quantity || 1);
          }, 0),
    payment_status:
      orderDoc.razorpayPaymentId || (orderDoc.walletAmount >= (orderDoc.payableAmount ?? orderDoc.totalAmount ?? 0))
        ? "paid"
        : "pending",
  };
};

export const createShiprocketOrder = async (order) => {
  try {
    // ✅ PREPAID / PARTIAL PAID = Prepaid
    // ❌ COD only when admin chooses COD intentionally (you don't have COD)
    const paymentMethod =
      order.payment_status === "paid" || order.payment_status === "partial_paid"
        ? "Prepaid"
        : "COD";

    const delivery = order.delivery_address || {};
    const userId = order.userId || {};
    // Clean and fix the address for Shiprocket
    const cleanAddress = (delivery.address_line || "")
      .replace(/,/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // Ensure address has a house number
    const finalAddress = /^\d+/.test(cleanAddress)
      ? cleanAddress
      : `House No. 1 ${cleanAddress}`;

    const pickupLocation = process.env.SHIPROCKET_PICKUP_LOCATION || process.env.PICKUP_LOCATION || "Home";
    const totalWeight = Math.max(
      0.01,
      roundWeight(
        Number(order.totalWeight) > 0
          ? Number(order.totalWeight)
          : (order.cartItems || []).reduce((total, item) => {
              const itemWeight = resolveItemWeight(item?.weight);
              return total + itemWeight * Number(item?.quantity || 1);
            }, 0),
      ),
    );

    // Shiprocket expects order_date as "YYYY-MM-DD HH:mm"
    const now = new Date();
    const orderDateStr =
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ` +
      `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    const fullName = (userId.name || "Customer").trim();
    const nameParts = fullName.indexOf(" ") >= 0 ? fullName.split(/\s+/) : [fullName, ""];
    const billingFirstName = nameParts[0] || "Customer";
    const billingLastName = nameParts.slice(1).join(" ").trim() || "";

    // Ensure state is always provided; default to Uttar Pradesh if missing
    const billingState = (delivery.state || "").trim() || "Uttar Pradesh";

    const payload = {
      order_id: order._id?.toString?.() || order._id,
      order_date: orderDateStr,
      pickup_location: pickupLocation,
      billing_customer_name: billingFirstName,
      billing_last_name: billingLastName,
      billing_address: finalAddress || delivery.address_line || "Address",
      billing_city: delivery.city || "",
      billing_pincode: (delivery.pincode || "").toString().trim() || "110001",
      billing_state: billingState,
      billing_country: "India",
      billing_email: userId.email || "noemail@example.com",
      billing_phone: (userId.mobile || userId.phone || "9999999999").toString().trim(),
      shipping_is_billing: true,
      order_items: (order.cartItems || []).map((item) => ({
        name: item.name || "Product",
        sku: (item.productId?._id ?? item.productId)?.toString?.() || "sku",
        units: item.quantity || 1,
        selling_price: item.price || 0,
      })),
      payment_method: paymentMethod,
      sub_total: order.totalAmt ?? 0,
      length: 20,
      breadth: 15,
      height: 10,
      weight: totalWeight,
    };

    const postOrder = (body, token) =>
      axios.post(
        "https://apiv2.shiprocket.in/v1/external/orders/create/adhoc",
        body,
        { headers: { Authorization: `Bearer ${token}` } },
      );

    const res = await withShiprocketAuthRetry(async (token) => {
      try {
        return await postOrder(payload, token);
      } catch (err) {
        const data = err.response?.data;
        const isWrongPickup =
          data?.message &&
          typeof data.message === "string" &&
          data.message.toLowerCase().includes("pickup location");
        const locations = data?.data?.data ?? data?.data;
        const list = Array.isArray(locations) ? locations : [];

        if (isWrongPickup && list.length > 0 && list[0].pickup_location) {
          payload.pickup_location = list[0].pickup_location;
          return await postOrder(payload, token);
        }

        throw err;
      }
    });

    return res.data;
  } catch (err) {
    const details = err.response?.data || err.message || err;
    const e = new Error(
      typeof details === "string" ? details : JSON.stringify(details),
    );
    e.shiprocket = {
      stage: "create_order",
      response: err.response?.data,
      status: err.response?.status,
      message: err.message,
    };
    throw e;
  }
};

/* ---------------------------------------------------------
   3️⃣ Generate AWB after order creation
   Returns full response so caller can read awb_code from various shapes
---------------------------------------------------------- */
export const generateAWB = async (shipmentId) => {
  try {
    const res = await withShiprocketAuthRetry((token) =>
      axios.post(
        "https://apiv2.shiprocket.in/v1/external/courier/assign/awb",
        { shipment_id: Number(shipmentId) || shipmentId },
        { headers: { Authorization: `Bearer ${token}` } },
      )
    );

    const data = res.data;
    return data?.response?.data ?? data?.response ?? data ?? {};
  } catch (err) {
    const details = err.response?.data || err.message;
    const e = new Error("Failed to generate AWB");
    e.shiprocket = { stage: "awb", response: err.response?.data, status: err.response?.status };
    throw e;
  }
};

/* ---------------------------------------------------------
   3b. Generate Label (PDF URL) – call after AWB
   Returns { label_url } or similar; pass single shipment_id or array
---------------------------------------------------------- */
export const generateLabel = async (shipmentId) => {
  try {
    const ids = Array.isArray(shipmentId) ? shipmentId : [Number(shipmentId) || shipmentId];

    const res = await withShiprocketAuthRetry((token) =>
      axios.post(
        "https://apiv2.shiprocket.in/v1/external/courier/generate/label",
        { shipment_id: ids },
        { headers: { Authorization: `Bearer ${token}` } },
      )
    );

    const data = res.data;
    const labelUrl =
      data?.label_url ??
      data?.response?.label_url ??
      data?.data?.label_url ??
      data?.url;
    return { label_url: labelUrl, raw: data };
  } catch (err) {
    const details = err.response?.data || err.message;
    const e = new Error("Failed to generate label");
    e.shiprocket = { stage: "label", response: err.response?.data, status: err.response?.status };
    throw e;
  }
};

/* ---------------------------------------------------------
   3c. Generate Manifest – required before pickup
---------------------------------------------------------- */
export const generateManifest = async (shipmentId) => {
  try {
    const ids = Array.isArray(shipmentId) ? shipmentId : [Number(shipmentId) || shipmentId];

    const res = await withShiprocketAuthRetry((token) =>
      axios.post(
        "https://apiv2.shiprocket.in/v1/external/manifests/generate",
        { shipment_id: ids },
        { headers: { Authorization: `Bearer ${token}` } },
      )
    );

    return res.data;
  } catch (err) {
    const details = err.response?.data || err.message;
    const e = new Error("Failed to generate manifest");
    e.shiprocket = { stage: "manifest", response: err.response?.data, status: err.response?.status };
    throw e;
  }
};

/* ---------------------------------------------------------
   4️⃣ Create Pickup (Admin triggers after product ready)
---------------------------------------------------------- */
export const schedulePickup = async (shipmentId) => {
  try {
    const res = await withShiprocketAuthRetry((token) =>
      axios.post(
        "https://apiv2.shiprocket.in/v1/external/courier/generate/pickup",
        { shipment_id: shipmentId },
        { headers: { Authorization: `Bearer ${token}` } },
      )
    );

    return res.data;
  } catch (err) {
    const e = new Error("Failed to schedule pickup");
    e.shiprocket = { stage: "pickup", response: err.response?.data, status: err.response?.status };
    throw e;
  }
};

/* ---------------------------------------------------------
   5️⃣ Track Shipment using AWB
---------------------------------------------------------- */
export const trackShipment = async (awb) => {
  try {
    const res = await withShiprocketAuthRetry((token) =>
      axios.get(
        `https://apiv2.shiprocket.in/v1/external/courier/track/awb/${awb}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
    );

    return res.data;
  } catch (err) {
    const e = new Error("Failed to track shipment");
    e.shiprocket = { stage: "track", response: err.response?.data, status: err.response?.status };
    throw e;
  }
};

/* ---------------------------------------------------------
   6️⃣ Cancel Shipment
---------------------------------------------------------- */
export const cancelShipment = async (shipmentId) => {
  try {
    const res = await withShiprocketAuthRetry((token) =>
      axios.post(
        "https://apiv2.shiprocket.in/v1/external/orders/cancel/shipment",
        { shipment_id: shipmentId },
        { headers: { Authorization: `Bearer ${token}` } },
      )
    );

    return res.data;
  } catch (err) {
    const responseMessage =
      err.response?.data?.message ||
      err.response?.data?.error ||
      err.response?.data?.errors?.[0]?.message ||
      err.message ||
      "Failed to cancel shipment";
    const e = new Error(responseMessage);
    e.shiprocket = {
      stage: "cancel_shipment",
      message: responseMessage,
      response: err.response?.data,
      status: err.response?.status,
    };
    throw e;
  }
};

/* ---------------------------------------------------------
   7️⃣ Cancel Order (Fallback for NEW / non-dispatched records)
---------------------------------------------------------- */
export const cancelOrder = async (orderId) => {
  try {
    const rawIds = Array.isArray(orderId) ? orderId : [orderId];
    const normalizedOrderIds = rawIds
      .map((value) => String(value || "").trim())
      .filter(Boolean);

    if (!normalizedOrderIds.length) {
      const e = new Error("Missing orderId for Shiprocket order cancellation");
      e.shiprocket = { stage: "cancel_order", message: "orderId is required" };
      throw e;
    }

    const res = await withShiprocketAuthRetry((token) =>
      axios.post(
        "https://apiv2.shiprocket.in/v1/external/orders/cancel",
        {
          // Docs indicate order_ids array; ids is sent for backward compatibility.
          order_ids: normalizedOrderIds,
          ids: normalizedOrderIds,
        },
        { headers: { Authorization: `Bearer ${token}` } },
      )
    );

    return res.data;
  } catch (err) {
    const responseMessage =
      err.response?.data?.message ||
      err.response?.data?.error ||
      err.response?.data?.errors?.[0]?.message ||
      err.message ||
      "Failed to cancel order";
    const e = new Error(responseMessage);
    e.shiprocket = {
      stage: "cancel_order",
      message: responseMessage,
      response: err.response?.data,
      status: err.response?.status,
    };
    throw e;
  }
};

/* ---------------------------------------------------------
   8️⃣ Fetch Shiprocket Wallet Balance
---------------------------------------------------------- */
export const getShiprocketWalletBalance = async () => {
  const endpoints = [
    { method: "get", url: "https://apiv2.shiprocket.in/v1/external/settings/company/details" },
    { method: "post", url: "https://apiv2.shiprocket.in/v1/external/settings/company/details" },
    { method: "get", url: "https://apiv2.shiprocket.in/v1/external/account/details" },
    { method: "get", url: "https://apiv2.shiprocket.in/v1/external/account/wallet-balance" },
    { method: "get", url: "https://apiv2.shiprocket.in/v1/external/account/balance" },
    { method: "get", url: "https://apiv2.shiprocket.in/v1/external/settings/account" },
  ];

  const parseBalance = (payload) => {
    const numericCandidates = [
      payload?.wallet_balance,
      payload?.balance,
      payload?.available_balance,
      payload?.usable_amount,
      payload?.usableAmount,
      payload?.current_balance,
      payload?.currentBalance,
      payload?.data?.wallet_balance,
      payload?.data?.balance,
      payload?.data?.available_balance,
      payload?.data?.usable_amount,
      payload?.data?.usableAmount,
      payload?.data?.current_balance,
      payload?.data?.currentBalance,
      payload?.response?.wallet_balance,
      payload?.response?.balance,
      payload?.response?.available_balance,
      payload?.response?.usable_amount,
      payload?.response?.usableAmount,
      payload?.response?.current_balance,
      payload?.response?.currentBalance,
      payload?.response?.data?.wallet_balance,
      payload?.response?.data?.balance,
      payload?.response?.data?.available_balance,
      payload?.response?.data?.usable_amount,
      payload?.response?.data?.usableAmount,
      payload?.response?.data?.current_balance,
      payload?.response?.data?.currentBalance,
    ];

    for (const candidate of numericCandidates) {
      const num = Number(candidate);
      if (Number.isFinite(num)) {
        return Math.round(num * 100) / 100;
      }
    }

    const visited = new Set();
    const deepScan = (node) => {
      if (!node || typeof node !== "object") return null;
      if (visited.has(node)) return null;
      visited.add(node);

      for (const [key, value] of Object.entries(node)) {
        const lowerKey = String(key || "").toLowerCase();
        if (/(wallet|balance)/.test(lowerKey)) {
          const num = Number(value);
          if (Number.isFinite(num)) return Math.round(num * 100) / 100;
        }
        if (value && typeof value === "object") {
          const nested = deepScan(value);
          if (nested != null) return nested;
        }
      }
      return null;
    };

    return deepScan(payload);
  };

  let lastError = null;
  for (const endpoint of endpoints) {
    try {
      const res = await withShiprocketAuthRetry((token) => {
        const config = { headers: { Authorization: `Bearer ${token}` } };
        if (endpoint.method === "post") {
          return axios.post(endpoint.url, {}, config);
        }
        return axios.get(endpoint.url, config);
      });

      const raw = res?.data || {};
      const balance = parseBalance(raw);
      if (balance != null) {
        return {
          balance,
          currency: "INR",
          raw,
        };
      }
    } catch (err) {
      lastError = err;
    }
  }

  const responseMessage =
    lastError?.response?.data?.message ||
    lastError?.response?.data?.error ||
    lastError?.response?.data?.errors?.[0]?.message ||
    lastError?.message ||
    "Failed to fetch Shiprocket wallet balance";

  const e = new Error(responseMessage);
  e.shiprocket = {
    stage: "wallet_balance",
    message: responseMessage,
    response: lastError?.response?.data,
    status: lastError?.response?.status,
  };
  throw e;
};
