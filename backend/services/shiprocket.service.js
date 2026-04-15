import axios from "axios";

const SHIPROCKET_API_BASE = "https://apiv2.shiprocket.in/v1/external";
const TOKEN_TTL_MS = 60 * 60 * 1000;
const FALLBACK_ITEM_WEIGHT_KG = 0.5;

const tokenCache = {
  token: "",
  expiresAt: 0,
  pending: null,
};

const normalizeText = (value) => String(value || "").trim();
const lowerText = (value) => normalizeText(value).toLowerCase();

const getErrorMessage = (error) =>
  normalizeText(
    error?.response?.data?.message ||
      error?.response?.data?.error ||
      error?.response?.data?.errors?.[0]?.message ||
      error?.shiprocket?.message ||
      error?.message ||
      "",
  );

const clearTokenCache = () => {
  tokenCache.token = "";
  tokenCache.expiresAt = 0;
  tokenCache.pending = null;
};

const shouldRefreshToken = (error) => {
  const status = Number(error?.response?.status || error?.shiprocket?.status || 0);
  if (status === 401 || status === 403) return true;

  const message = lowerText(getErrorMessage(error));
  return (
    message.includes("access forbidden") ||
    message.includes("unauthorized") ||
    message.includes("invalid token") ||
    message.includes("token expired") ||
    message.includes("jwt expired")
  );
};

const logShiprocketError = (stage, error, extra = {}) => {
  console.error("Shiprocket error", {
    stage,
    message: getErrorMessage(error),
    status: error?.response?.status || error?.shiprocket?.status || null,
    response: error?.response?.data || error?.shiprocket?.response || null,
    ...extra,
  });
};

const raiseShiprocketError = (stage, error, fallbackMessage) => {
  const message = getErrorMessage(error) || fallbackMessage;
  const wrapped = new Error(message);
  wrapped.shiprocket = {
    stage,
    message,
    status: error?.response?.status || error?.shiprocket?.status || null,
    response: error?.response?.data || error?.shiprocket?.response || null,
  };
  return wrapped;
};

const shiprocketRequest = async (runner) => {
  let refreshed = false;

  while (true) {
    const token = await getShiprocketToken({ forceRefresh: refreshed });

    try {
      return await runner(token);
    } catch (error) {
      if (refreshed || !shouldRefreshToken(error)) {
        throw error;
      }

      clearTokenCache();
      refreshed = true;
    }
  }
};

const pickFirstString = (...values) => {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) return text;
  }
  return "";
};

const digitsOnly = (value) => normalizeText(value).replace(/\D/g, "");

const resolveItemWeight = (weight) => {
  const numeric = Number(weight);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.round(numeric * 100) / 100;
  }
  return FALLBACK_ITEM_WEIGHT_KG;
};

const roundWeight = (weight) => Math.round(Number(weight || 0) * 100) / 100;

const calculateTotalWeight = (orderDoc = {}, items = []) => {
  const storedTotalWeight = Number(orderDoc.totalWeight || orderDoc.weight);
  if (Number.isFinite(storedTotalWeight) && storedTotalWeight > 0) {
    return Math.max(0.01, roundWeight(storedTotalWeight));
  }

  const total = (Array.isArray(items) ? items : []).reduce((sum, item) => {
    const itemWeight = resolveItemWeight(item?.weight);
    const quantity = Number(item?.quantity || item?.units || 1);
    return sum + itemWeight * (Number.isFinite(quantity) && quantity > 0 ? quantity : 1);
  }, 0);

  return Math.max(0.01, roundWeight(total));
};

const inferCity = (shippingAddress = {}) => {
  const direct = pickFirstString(shippingAddress.city);
  if (direct) return direct;

  const parts = pickFirstString(shippingAddress.address)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length >= 2) return parts[parts.length - 2];
  return parts[0] || "";
};

const inferState = (shippingAddress = {}) => {
  const direct = pickFirstString(shippingAddress.state);
  if (direct) return direct;

  const pincode = digitsOnly(shippingAddress.pincode);
  const prefix = Number(pincode.slice(0, 2));
  const map = {
    11: "Delhi",
    12: "Haryana",
    13: "Uttar Pradesh",
    14: "Punjab",
    15: "Punjab",
    16: "Chandigarh",
    17: "Himachal Pradesh",
    18: "Jammu and Kashmir",
    19: "Punjab",
    20: "Maharashtra",
    21: "Madhya Pradesh",
    22: "Madhya Pradesh",
    23: "Uttar Pradesh",
    24: "Uttar Pradesh",
    25: "Uttar Pradesh",
    26: "Uttar Pradesh",
    27: "Uttar Pradesh",
    28: "Uttar Pradesh",
    29: "Uttar Pradesh",
    30: "Rajasthan",
    31: "Rajasthan",
    32: "Rajasthan",
    33: "Punjab",
    34: "Rajasthan",
    36: "Gujarat",
    37: "Gujarat",
    38: "Gujarat",
    39: "Gujarat",
    40: "Maharashtra",
    41: "Maharashtra",
    42: "Maharashtra",
    43: "Maharashtra",
    44: "Maharashtra",
    45: "Madhya Pradesh",
    46: "Madhya Pradesh",
    48: "Madhya Pradesh",
    49: "Chhattisgarh",
    50: "Telangana",
    51: "Andhra Pradesh",
    52: "Andhra Pradesh",
    53: "Andhra Pradesh",
    56: "Karnataka",
    57: "Karnataka",
    58: "Karnataka",
    59: "Karnataka",
    60: "Tamil Nadu",
    61: "Tamil Nadu",
    62: "Tamil Nadu",
    63: "Tamil Nadu",
    64: "Tamil Nadu",
    67: "Andhra Pradesh",
    68: "Kerala",
    69: "Kerala",
    70: "West Bengal",
    71: "West Bengal",
    72: "West Bengal",
    73: "West Bengal",
    74: "West Bengal",
    75: "Odisha",
    76: "Odisha",
    77: "Odisha",
    78: "Assam",
    79: "Assam",
    80: "Bihar",
    81: "Bihar",
    82: "Jharkhand",
    83: "Uttar Pradesh",
    84: "Bihar",
    85: "Jharkhand",
    91: "Uttar Pradesh",
  };

  if (prefix && map[prefix]) return map[prefix];

  const raw = pickFirstString(shippingAddress.address).toUpperCase();
  const checks = [
    ["UTTAR PRADESH", "Uttar Pradesh"],
    ["MAHARASHTRA", "Maharashtra"],
    ["RAJASTHAN", "Rajasthan"],
    ["KARNATAKA", "Karnataka"],
    ["TAMIL NADU", "Tamil Nadu"],
    ["WEST BENGAL", "West Bengal"],
    ["GUJARAT", "Gujarat"],
    ["MADHYA PRADESH", "Madhya Pradesh"],
    ["BIHAR", "Bihar"],
    ["DELHI", "Delhi"],
    ["PUNJAB", "Punjab"],
    ["HARYANA", "Haryana"],
    ["KERALA", "Kerala"],
    ["ANDHRA", "Andhra Pradesh"],
    ["TELANGANA", "Telangana"],
    ["ODISHA", "Odisha"],
    ["ORISSA", "Odisha"],
  ];

  for (const [needle, state] of checks) {
    if (raw.includes(needle)) return state;
  }

  return "Uttar Pradesh";
};

const normalizePaymentMode = (order = {}) => {
  const direct = lowerText(order.paymentMode || order.payment_method || order.paymentMethod);
  if (direct === "cod") return "COD";
  if (direct === "prepaid" || direct === "online") return "Prepaid";

  const paymentStatus = lowerText(order.payment_status);
  if (paymentStatus === "paid" || paymentStatus === "partial_paid") return "Prepaid";
  return "COD";
};

const extractFirstValue = (response, keys) => {
  const values = [];
  for (const key of keys) {
    values.push(response?.[key]);
    values.push(response?.data?.[key]);
    values.push(response?.response?.[key]);
    values.push(response?.response?.data?.[key]);
    values.push(response?.shipments?.[0]?.[key]);
    values.push(response?.data?.shipments?.[0]?.[key]);
    values.push(response?.response?.data?.shipments?.[0]?.[key]);
  }

  for (const value of values) {
    const text = normalizeText(value);
    if (text) return text;
  }

  return null;
};

const extractAwbCode = (response) => {
  const direct = extractFirstValue(response, ["awb_code", "awb", "awbCode", "awb_number", "awbNo"]);
  if (direct) return direct;

  const scan = (node) => {
    if (!node || typeof node !== "object") return null;

    for (const [key, value] of Object.entries(node)) {
      if (key.toLowerCase().includes("awb")) {
        const text = normalizeText(value);
        if (text) return text;
      }

      if (value && typeof value === "object") {
        const nested = scan(value);
        if (nested) return nested;
      }
    }

    return null;
  };

  return scan(response);
};

const extractTrackingStatus = (response) => {
  const payload = response?.data ?? response;
  const candidates = [
    payload?.tracking_data?.shipment_track?.[0]?.current_status,
    payload?.tracking_data?.shipment_track?.[0]?.current_status_state,
    payload?.tracking_data?.shipment_track?.[0]?.status,
    payload?.tracking_data?.shipment_track_activities?.[0]?.["sr-status"],
    payload?.tracking_data?.shipment_track_activities?.[0]?.activity,
    payload?.tracking_data?.shipment_status,
    payload?.shipment_status,
    payload?.status,
    payload?.current_status,
    payload?.message,
  ];

  for (const candidate of candidates) {
    const text = normalizeText(candidate);
    if (text) return text;
  }

  return "";
};

const getPickupLocations = async () => {
  try {
    const response = await shiprocketRequest((token) =>
      axios.get(`${SHIPROCKET_API_BASE}/settings/company/pickup`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }),
    );

    const payload = response?.data ?? response ?? {};
    const arrays = [payload?.data, payload?.pickup_locations, payload?.pickupLocations].filter(Array.isArray);
    const locations = arrays
      .flat()
      .map((item) => (typeof item === "string" ? { pickup_location: item } : item))
      .filter(Boolean)
      .map((item) => normalizeText(item.pickup_location || item.pickupLocation || item.name))
      .filter(Boolean);

    return [...new Set(locations)];
  } catch (error) {
    logShiprocketError("pickup_locations", error);
    return [];
  }
};

const getPickupLocation = (payload) =>
  normalizeText(
    payload?.pickup_location ||
      payload?.pickupLocation ||
      process.env.SHIPROCKET_PICKUP_LOCATION ||
      process.env.PICKUP_LOCATION ||
      "Main",
  );

const extractPickupLocationsFromError = (error) => {
  const payload = error?.response?.data || {};
  const candidates = [];

  const pushCandidate = (value) => {
    const text = normalizeText(value);
    if (text) candidates.push(text);
  };

  const scan = (node) => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const item of node) scan(item);
      return;
    }
    if (typeof node !== "object") return;

    pushCandidate(node.pickup_location);
    pushCandidate(node.pickupLocation);
    pushCandidate(node.name);

    for (const value of Object.values(node)) {
      if (value && typeof value === "object") scan(value);
    }
  };

  scan(payload);
  return [...new Set(candidates)];
};

const buildPayload = (orderDoc = {}) => {
  const shippingAddress = orderDoc.shippingAddress || {};
  const customerName = pickFirstString(orderDoc.customerName, orderDoc.user?.name, orderDoc.userId?.name, shippingAddress.name, "Customer");
  const orderId = pickFirstString(orderDoc.orderId, orderDoc._id);
  const pincode = digitsOnly(orderDoc.pincode || shippingAddress.pincode || orderDoc.delivery_address?.pincode);
  const totalAmount = Number(orderDoc.payableAmount ?? orderDoc.totalAmount ?? orderDoc.totalAmt ?? 0);
  const items = Array.isArray(orderDoc.items) ? orderDoc.items : Array.isArray(orderDoc.cartItems) ? orderDoc.cartItems : [];
  const totalWeight = calculateTotalWeight(orderDoc, items);

  return {
    order_id: orderId,
    order_date: new Date().toISOString().slice(0, 10) + ` ${String(new Date().getHours()).padStart(2, "0")}:${String(new Date().getMinutes()).padStart(2, "0")}`,
    pickup_location: getPickupLocation(orderDoc),
    billing_customer_name: customerName.split(/\s+/)[0] || customerName || "Customer",
    billing_last_name: customerName.split(/\s+/).slice(1).join(" ").trim(),
    billing_address: pickFirstString(orderDoc.address, shippingAddress.address, shippingAddress.shopName, "Address not provided"),
    billing_city: pickFirstString(shippingAddress.city, inferCity(shippingAddress)),
    billing_pincode: pincode || "110001",
    billing_state: pickFirstString(shippingAddress.state, inferState(shippingAddress)),
    billing_country: "India",
    billing_email: pickFirstString(orderDoc.user?.email, orderDoc.userId?.email, "noemail@example.com"),
    billing_phone: pickFirstString(shippingAddress.phone, orderDoc.user?.phone, orderDoc.userId?.mobile, orderDoc.userId?.phone, "9999999999"),
    shipping_is_billing: true,
    order_items: items.map((item) => ({
      name: pickFirstString(item.productName, item.name, "Product"),
      sku: pickFirstString(item.sku, item.productId?._id, item.productId, item.product) || "sku",
      units: Number(item.quantity || 1),
      selling_price: Number(item.price || item.finalSellingPrice || 0),
    })),
    payment_method: normalizePaymentMode(orderDoc),
    sub_total: totalAmount,
    length: Number(orderDoc.length || 20),
    breadth: Number(orderDoc.breadth || 15),
    height: Number(orderDoc.height || 10),
    weight: totalWeight,
    cod_amount: normalizePaymentMode(orderDoc) === "COD" ? totalAmount : 0,
  };
};

export const invalidateShiprocketTokenCache = () => clearTokenCache();

export const getShiprocketToken = async ({ forceRefresh = false } = {}) => {
  const email = normalizeText(process.env.SHIPROCKET_EMAIL);
  const password = normalizeText(process.env.SHIPROCKET_PASSWORD);

  if (!email || !password) {
    const error = new Error("Shiprocket credentials missing. Set SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD in .env");
    error.shiprocket = { stage: "config", message: "SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD are required" };
    throw error;
  }

  if (!forceRefresh && tokenCache.token && tokenCache.expiresAt > Date.now()) {
    return tokenCache.token;
  }

  if (tokenCache.pending) {
    return tokenCache.pending;
  }

  tokenCache.pending = (async () => {
    try {
      const response = await axios.post(`${SHIPROCKET_API_BASE}/auth/login`, { email, password });
      const token = normalizeText(response?.data?.token);
      if (!token) {
        throw new Error("Shiprocket login did not return a token");
      }

      tokenCache.token = token;
      tokenCache.expiresAt = Date.now() + TOKEN_TTL_MS;
      return token;
    } catch (error) {
      clearTokenCache();
      throw raiseShiprocketError("login", error, "Failed to login to Shiprocket");
    } finally {
      tokenCache.pending = null;
    }
  })();

  return tokenCache.pending;
};

export const mapOrderToShiprocketPayload = (orderDoc) => buildPayload(orderDoc);

export const createShiprocketOrder = async (orderPayload, options = {}) => {
  const payload = { ...orderPayload };
  const desiredPickup = getPickupLocation({
    pickup_location: payload.pickup_location || options.pickupLocation,
  });

  const attemptCreate = async (pickupLocation) =>
    shiprocketRequest((token) =>
      axios.post(
        `${SHIPROCKET_API_BASE}/orders/create/adhoc`,
        {
          ...payload,
          pickup_location: pickupLocation,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      ),
    );

  try {
    return await attemptCreate(desiredPickup);
  } catch (error) {
    const message = lowerText(getErrorMessage(error));
    const pickupLooksBad =
      message.includes("pickup location") ||
      message.includes("pickup_location") ||
      message.includes("pickup is invalid") ||
      message.includes("pickup location invalid");

    if (!pickupLooksBad || options.retryPickup === false) {
      logShiprocketError("create_order", error, { pickupLocation: desiredPickup });
      throw raiseShiprocketError("create_order", error, "Failed to create Shiprocket order");
    }

    const fallbackFromError = extractPickupLocationsFromError(error);
    const fallbackFromApi = await getPickupLocations();
    const fallbackLocations = [...new Set([...fallbackFromError, ...fallbackFromApi])];
    const fallbackPickup = fallbackLocations.find((location) => location && location !== desiredPickup) || fallbackLocations[0];

    if (!fallbackPickup) {
      throw raiseShiprocketError("create_order", error, "Failed to create Shiprocket order with a valid pickup location");
    }

    try {
      return await attemptCreate(fallbackPickup);
    } catch (retryError) {
      logShiprocketError("create_order_pickup_retry", retryError, {
        pickupLocation: fallbackPickup,
        originalPickupLocation: desiredPickup,
      });
      throw raiseShiprocketError("create_order", retryError, "Failed to create Shiprocket order");
    }
  }
};

export const generateAWB = async (shipmentId) => {
  try {
    const response = await shiprocketRequest((token) =>
      axios.post(
        `${SHIPROCKET_API_BASE}/courier/assign/awb`,
        { shipment_id: Number(shipmentId) || shipmentId },
        { headers: { Authorization: `Bearer ${token}` } },
      ),
    );

    const payload = response?.data ?? response ?? {};
    return payload?.response?.data ?? payload?.response ?? payload;
  } catch (error) {
    logShiprocketError("awb", error, { shipmentId });
    throw raiseShiprocketError("awb", error, "Failed to generate AWB");
  }
};

export const generateLabel = async (shipmentId) => {
  try {
    const ids = Array.isArray(shipmentId) ? shipmentId : [Number(shipmentId) || shipmentId];
    const response = await shiprocketRequest((token) =>
      axios.post(
        `${SHIPROCKET_API_BASE}/courier/generate/label`,
        { shipment_id: ids },
        { headers: { Authorization: `Bearer ${token}` } },
      ),
    );

    const payload = response?.data ?? response ?? {};
    const labelUrl = payload?.label_url || payload?.response?.label_url || payload?.data?.label_url || payload?.url || null;
    return { label_url: labelUrl, raw: payload };
  } catch (error) {
    logShiprocketError("label", error, { shipmentId });
    throw raiseShiprocketError("label", error, "Failed to generate label");
  }
};

export const generateManifest = async (shipmentId) => {
  try {
    const ids = Array.isArray(shipmentId) ? shipmentId : [Number(shipmentId) || shipmentId];
    const response = await shiprocketRequest((token) =>
      axios.post(
        `${SHIPROCKET_API_BASE}/manifests/generate`,
        { shipment_id: ids },
        { headers: { Authorization: `Bearer ${token}` } },
      ),
    );

    return response?.data ?? response ?? {};
  } catch (error) {
    logShiprocketError("manifest", error, { shipmentId });
    throw raiseShiprocketError("manifest", error, "Failed to generate manifest");
  }
};

export const schedulePickup = async (shipmentId) => {
  try {
    const response = await shiprocketRequest((token) =>
      axios.post(
        `${SHIPROCKET_API_BASE}/courier/generate/pickup`,
        { shipment_id: shipmentId },
        { headers: { Authorization: `Bearer ${token}` } },
      ),
    );

    return response?.data ?? response ?? {};
  } catch (error) {
    logShiprocketError("pickup", error, { shipmentId });
    throw raiseShiprocketError("pickup", error, "Failed to schedule pickup");
  }
};

export const trackShipment = async (awb) => {
  try {
    const response = await shiprocketRequest((token) =>
      axios.get(`${SHIPROCKET_API_BASE}/courier/track/awb/${encodeURIComponent(normalizeText(awb))}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    return response?.data ?? response ?? {};
  } catch (error) {
    logShiprocketError("track", error, { awb });
    throw raiseShiprocketError("track", error, "Failed to track shipment");
  }
};

export const cancelShipment = async (shipmentId) => {
  try {
    const response = await shiprocketRequest((token) =>
      axios.post(
        `${SHIPROCKET_API_BASE}/orders/cancel/shipment`,
        { shipment_id: shipmentId },
        { headers: { Authorization: `Bearer ${token}` } },
      ),
    );

    return response?.data ?? response ?? {};
  } catch (error) {
    logShiprocketError("cancel", error, { shipmentId });
    throw raiseShiprocketError("cancel_shipment", error, "Failed to cancel shipment");
  }
};

export const normalizeShiprocketStatus = (value) => {
  const text = lowerText(value);
  if (!text) return "";
  if (text.includes("deliver")) return "DELIVERED";
  if (text.includes("cancel")) return "CANCELLED";
  if (text.includes("return")) return "CANCELLED";
  if (text.includes("ship") || text.includes("dispatch") || text.includes("transit") || text.includes("pickup") || text.includes("out for delivery")) {
    return "DISPATCHED";
  }
  if (text.includes("confirm") || text.includes("book")) return "CONFIRMED";
  if (text.includes("place") || text.includes("create")) return "PLACED";
  return "";
};

export const extractShiprocketTrackingStatus = (response) => extractTrackingStatus(response);

export const extractShiprocketShipmentId = (response) =>
  extractFirstValue(response, ["shipment_id", "shipmentId", "id"]);

export const extractShiprocketAwbCode = (response) => extractAwbCode(response);

export const parseShiprocketWebhookPayload = (payload) => {
  const body = payload?.body && typeof payload.body === "object" ? payload.body : payload;
  const raw = body || {};

  const shipmentId = pickFirstString(
    raw?.shipment_id,
    raw?.shipmentId,
    raw?.shipment?.id,
    raw?.data?.shipment_id,
    raw?.data?.shipmentId,
    raw?.response?.shipment_id,
    raw?.response?.shipmentId,
  );

  const awbCode = extractAwbCode(raw);
  const status = pickFirstString(
    raw?.status,
    raw?.current_status,
    raw?.data?.status,
    raw?.data?.current_status,
    raw?.tracking_data?.shipment_track?.[0]?.current_status,
    raw?.tracking_data?.shipment_track?.[0]?.status,
    raw?.shipment_status,
  );
  const orderId = pickFirstString(
    raw?.order_id,
    raw?.orderId,
    raw?.data?.order_id,
    raw?.data?.orderId,
    raw?.shipment?.order_id,
    raw?.shipment?.orderId,
  );
  const courierName = pickFirstString(
    raw?.courier_name,
    raw?.courierName,
    raw?.data?.courier_name,
    raw?.data?.courierName,
    raw?.tracking_data?.shipment_track?.[0]?.courier_name,
  );
  const trackingUrl = pickFirstString(raw?.tracking_url, raw?.trackingUrl, raw?.data?.tracking_url);

  return {
    raw,
    orderId,
    shipmentId,
    awbCode,
    courierName,
    status,
    normalizedStatus: normalizeShiprocketStatus(status),
    trackingUrl,
  };
};
