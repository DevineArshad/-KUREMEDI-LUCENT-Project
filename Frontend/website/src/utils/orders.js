const ORDER_STATUS_META = {
  PENDING: { label: "Processing", tone: "amber" },
  PLACED: { label: "Placed", tone: "blue" },
  CONFIRMED: { label: "Confirmed", tone: "teal" },
  DISPATCHED: { label: "Delivering", tone: "indigo" },
  DELIVERED: { label: "Delivered", tone: "emerald" },
  CANCELLED: { label: "Cancelled", tone: "rose" },
  REFUNDED: { label: "Refunded", tone: "rose" },
};

export const ORDER_STATUS_SEQUENCE = ["PENDING", "PLACED", "CONFIRMED", "DISPATCHED", "DELIVERED", "CANCELLED", "REFUNDED"];

export function normalizeOrderStatus(status) {
  return String(status || "PLACED").toUpperCase();
}

export function formatOrderNumber(orderId) {
  const value = String(orderId || "").slice(-8).toUpperCase();
  return value || "--------";
}

export function getOrderStatusMeta(status) {
  const normalized = normalizeOrderStatus(status);
  return ORDER_STATUS_META[normalized] || ORDER_STATUS_META.PLACED;
}

export function isOrderDelivered(status) {
  return normalizeOrderStatus(status) === "DELIVERED";
}

export function getOrderDeliveryLabel(status) {
  return isOrderDelivered(status) ? "Delivered" : "Not delivered";
}

export function getOrderProgressLabel(status) {
  const normalized = normalizeOrderStatus(status);
  if (normalized === "REFUNDED") return "Refunded";
  if (normalized === "CANCELLED") return "Cancelled";
  if (normalized === "DELIVERED") return "Delivered";
  if (normalized === "DISPATCHED") return "Delivering";
  if (normalized === "CONFIRMED") return "Confirmed";
  if (normalized === "PLACED") return "Order placed";
  return "Processing";
}

export function getOrderStatusClasses(status) {
  const tone = getOrderStatusMeta(status).tone;
  const variants = {
    amber: "bg-amber-100 text-amber-800 border-amber-200",
    blue: "bg-blue-100 text-blue-800 border-blue-200",
    teal: "bg-teal-100 text-teal-800 border-teal-200",
    indigo: "bg-indigo-100 text-indigo-800 border-indigo-200",
    emerald: "bg-emerald-100 text-emerald-800 border-emerald-200",
    rose: "bg-rose-100 text-rose-800 border-rose-200",
  };

  return variants[tone] || variants.blue;
}

export function flattenOrderedProducts(orders) {
  if (!Array.isArray(orders)) return [];

  return orders.flatMap((order) => {
    const items = Array.isArray(order?.items) ? order.items : [];
    const status = normalizeOrderStatus(order?.status);
    const statusMeta = getOrderStatusMeta(status);

    return items.map((item, index) => {
      const productId = typeof item?.product === "object" ? item?.product?._id : item?.product || null;
      const productName = item?.productName || item?.product?.productName || item?.product?.name || "Ordered product";
      const quantity = Number(item?.quantity || 1);
      const unitPrice = Number(item?.price || 0);
      const lineTotal = Number(item?.lineTotal ?? unitPrice * quantity ?? 0);

      return {
        id: `${order?._id || "order"}-${productId || index}`,
        orderId: order?._id || "",
        orderNumber: formatOrderNumber(order?._id),
        orderDate: order?.createdAt || null,
        status,
        statusLabel: statusMeta.label,
        statusTone: statusMeta.tone,
        deliveryLabel: getOrderDeliveryLabel(status),
        progressLabel: getOrderProgressLabel(status),
        isDelivered: isOrderDelivered(status),
        productId,
        productName,
        quantity,
        unitPrice,
        lineTotal,
        shiprocketShipmentId: order?.shiprocketShipmentId || null,
        shiprocketAwb: order?.shiprocketAwb || null,
        trackingUrl: order?.trackingUrl || null,
      };
    });
  });
}