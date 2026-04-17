"use client";

import { Download, Loader2 } from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";
import { useContextApi } from "../../hooks/useContextApi";
import toast from "react-hot-toast";

const TABS = [
  { key: "all", label: "All Orders" },
  { key: "processing", label: "Processing" },
  { key: "DISPATCHED", label: "Shipped" },
  { key: "DELIVERED", label: "Delivered" },
  { key: "CANCELLED", label: "Cancelled" },
];

const STATUS_OPTIONS = [
  "PLACED",
  "CONFIRMED",
  "DISPATCHED",
  "DELIVERED",
  "CANCELLED",
];

const formatDate = (d) => {
  if (!d) return "-";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "-";

  return dt.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
};



const Orders = () => {
  const { getallOrders, updateOrderStatus, setActiveTab: setGlobalActiveTab, setSelectedOrderId, getOrderById } = useContextApi();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("all");
  const [updatingId, setUpdatingId] = useState(null);




  const handleViewOrder = (orderId) => {
    console.log("Clicked Order ID:", orderId);
    setSelectedOrderId(orderId);
    setGlobalActiveTab("Order Detail");
  };

  const fetchOrderById = async (orderId) => {
    try {
      const response = await getOrderById(orderId);
      return response.data;
    } catch (error) {
      console.error("❌ Error fetching order by ID:", error);
      throw error;
    }
  };


  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getallOrders();
      // API returns array directly as response body; axios puts it in res.data
      let data = res?.data;
      if (!Array.isArray(data) && data?.data) data = data.data;
      setOrders(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("fetch orders error", err);
      toast.error(err?.response?.data?.message || "Failed to load orders");
      setOrders([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetch on mount only
  }, []);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const filteredOrders = orders.filter((o) => {
    const s = (o.status || "").toUpperCase();
    if (activeTab === "all") return true;
    if (activeTab === "processing")
      return ["PLACED", "CONFIRMED"].includes(s);
    return s === activeTab;
  });

  const stats = {
    total: orders.length,
    processing: orders.filter((o) =>
      ["PLACED", "CONFIRMED"].includes((o.status || "").toUpperCase())
    ).length,
    shipped: orders.filter((o) =>
      (o.status || "").toUpperCase() === "DISPATCHED"
    ).length,
    revenue: orders.reduce((sum, o) => sum + (o.totalAmt || 0), 0),
  };

  const tabCounts = {
    all: orders.length,
    processing: stats.processing,
    DISPATCHED: stats.shipped,
    DELIVERED: orders.filter((o) =>
      (o.status || "").toUpperCase() === "DELIVERED"
    ).length,
    CANCELLED: orders.filter((o) =>
      (o.status || "").toUpperCase() === "CANCELLED"
    ).length,
  };

  const handleStatusChange = async (orderId, newStatus, currentStatus) => {
    console.log("orderId", orderId);
    const normalizedCurrent = String(currentStatus || "").toUpperCase();
    const normalizedTarget = String(newStatus || "").toUpperCase();

    let extraPayload = {};
    if (
      normalizedTarget === "CANCELLED" &&
      ["DISPATCHED", "DELIVERED"].includes(normalizedCurrent)
    ) {
      const confirmed = window.confirm(
        "This order is already dispatched/delivered. Cancel anyway?"
      );
      if (!confirmed) return;
      extraPayload.forceCancel = true;
    }

    setUpdatingId(orderId);
    try {
      const result = await updateOrderStatus(orderId, "status", newStatus, extraPayload);
      if (Array.isArray(result?.warnings) && result.warnings.length > 0) {
        result.warnings.forEach((w) => toast(w));
      } else if (result?.awbMessage) {
        toast(result.awbMessage);
      } else if (result?.awbError) {
        toast.error(result?.awbError?.message || "AWB generation failed");
      } else {
        toast.success("Status updated");
      }
      await fetchOrders();
    } catch (error) {
      const apiCode = String(error?.response?.data?.code || "");
      if (apiCode === "CANCEL_REQUIRES_CONFIRMATION") {
        const confirmed = window.confirm(
          "This order is already dispatched/delivered. Confirm cancellation?"
        );
        if (confirmed) {
          try {
            await updateOrderStatus(orderId, "status", newStatus, { forceCancel: true });
            toast.success("Order status updated");
            await fetchOrders();
          } catch (retryError) {
            toast.error(retryError?.response?.data?.message || "Failed to update status");
          }
        }
      } else {
        toast.error(error?.response?.data?.message || "Failed to update status");
      }
    } finally {
      setUpdatingId(null);
    }
  };



  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">
            Order Management
          </h1>
          <p className="text-gray-500">
            Track and manage all orders with complete details
          </p>
        </div>

        <button
          onClick={fetchOrders}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-white border rounded-lg text-sm hover:bg-gray-100 disabled:opacity-70"
        >
          {loading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Download size={16} />
          )}
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition
              ${activeTab === key
                ? "bg-blue-600 text-white"
                : "bg-white border text-gray-700 hover:bg-gray-100"
              }`}
          >
            {label} ({tabCounts[key] ?? 0})
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <StatCard title="Total Orders" value={stats.total} />
        <StatCard title="Processing" value={stats.processing} />
        <StatCard title="Shipped" value={stats.shipped} />
        <StatCard title="Total Revenue" value={`₹${stats.revenue.toFixed(0)}`} />
      </div>

      <div className="bg-white rounded-xl shadow overflow-hidden overflow-x-auto">
        <table className="w-full text-sm min-w-225">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="p-3 text-left">Order ID</th>
              <th className="p-3 text-left">Retailer</th>
              <th className="p-3 text-left">Items</th>
              <th className="p-3 text-left">Amount</th>
              <th className="p-3 text-left">Payment</th>
              <th className="p-3 text-left">Payment Status</th>
              <th className="p-3 text-left">Order Date</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-left">Shipment / AWB</th>
              <th className="p-3 text-left">Message</th>
              <th className="p-3 text-left">Actions</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan="11" className="text-center py-10">
                  <Loader2 className="animate-spin mx-auto h-8 w-8 text-blue-500" />
                </td>
              </tr>
            ) : filteredOrders.length === 0 ? (
              <tr>
                <td colSpan="11" className="text-center py-10 text-gray-500">
                  No orders found
                </td>
              </tr>
            ) : (
              filteredOrders.map((order) => {
                const userName =
                  order.user?.name ||
                  order.user?.phone ||
                  (typeof order.user === "string" ? order.user : "-");
                const itemCount =
                  (order.cartItems || []).reduce((s, i) => s + (i.quantity || 0), 0) || 0;
                const itemNames =
                  (order.cartItems || [])
                    .slice(0, 2)
                    .map((i) => i.name || i.productId?.name || "Item")
                    .join(", ") || "-";
                const status = (order.status || "PLACED").toUpperCase();
                const isUpdating = updatingId === order._id;
                const shiprocketCharge = Number(order.shiprocketChargeAmount || 0);
                const shiprocketCurrency = String(order.shiprocketChargeCurrency || "INR").toUpperCase();
                const hasDispatchMessage = status === "DISPATCHED";

                let messageContent = "-";
                let messageClass = "text-gray-600";

                if (hasDispatchMessage && order.shiprocketBalanceWarning) {
                  messageContent = order.shiprocketBalanceWarning;
                  messageClass = "text-red-700";
                } else if (hasDispatchMessage && shiprocketCharge > 0) {
                  messageContent = `Shiprocket charge deducted: ${shiprocketCurrency} ${shiprocketCharge.toFixed(2)}`;
                  messageClass = "text-emerald-700";
                } else if (hasDispatchMessage && order.shiprocketMessage) {
                  messageContent = order.shiprocketMessage;
                  messageClass = "text-amber-700";
                }

                return (
                  <tr
                    key={order._id}
                    className="border-t border-gray-100 hover:bg-gray-50"
                  >
                    <td className="p-3">
                      <span className="font-mono text-xs text-gray-600">
                        {String(order._id).slice(-8)}
                      </span>
                    </td>
                    <td className="p-3">{userName}</td>
                    <td className="p-3">
                      <span title={itemNames}>{itemCount} items</span>
                    </td>
                    <td className="p-3 font-medium">₹{order.totalAmt ?? 0}</td>
                    <td className="p-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs ${(order.paymentMethod || "ONLINE") === "ONLINE"
                          ? "bg-green-100 text-green-800"
                          : "bg-amber-100 text-amber-800"
                          }`}
                      >
                        {order.paymentMethod || "ONLINE"}
                      </span>
                    </td>
                    <td className="p-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs ${String(order.paymentStatus || "unpaid").toLowerCase() === "refunded"
                          ? "bg-green-100 text-green-800"
                          : String(order.paymentStatus || "unpaid").toLowerCase() === "refund_pending"
                            ? "bg-orange-100 text-orange-800"
                            : String(order.paymentStatus || "unpaid").toLowerCase() === "paid"
                              ? "bg-blue-100 text-blue-800"
                              : "bg-gray-100 text-gray-700"
                          }`}
                      >
                        {String(order.paymentStatus || "unpaid").toLowerCase() === "refund_pending"
                          ? "Refund Pending"
                          : String(order.paymentStatus || "unpaid").toLowerCase() === "refunded"
                            ? "Refunded"
                            : String(order.paymentStatus || "unpaid").toLowerCase() === "paid"
                              ? "Paid"
                              : "Unpaid"}
                      </span>
                    </td>
                    <td className="p-3 text-gray-600">
                      {formatDate(order.orderDate || order.createdAt)}
                    </td>
                    <td className="p-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs ${status === "DELIVERED"
                          ? "bg-green-100 text-green-800"
                          : status === "CANCELLED"
                            ? "bg-red-100 text-red-800"
                            : status === "DISPATCHED"
                              ? "bg-blue-100 text-blue-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                      >
                        {status}
                      </span>
                    </td>
                    <td className="p-3 text-xs text-gray-600 font-mono">
                      {order.shiprocketBalanceWarning ? (
                        <div className="bg-red-50 border border-red-200 rounded p-2">
                          <p className="text-red-700 text-xs font-medium">{order.shiprocketBalanceWarning}</p>
                        </div>
                      ) : order.shiprocketShipmentId ? (
                        <span title={`AWB: ${order.shiprocketAwb || "—"}`}>
                          ID: {String(order.shiprocketShipmentId).slice(0, 8)}
                          {order.shiprocketAwb ? ` · ${order.shiprocketAwb}` : ""}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="p-3 text-xs max-w-75">
                      <p className={messageClass}>{messageContent}</p>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleViewOrder(order._id)}
                          className="text-blue-600 text-xs hover:text-blue-800 font-medium px-2 py-1 hover:bg-blue-50 rounded transition"
                        >
                          View
                        </button>
                        <select
                          value={status}
                          onChange={(e) =>
                            handleStatusChange(order._id, e.target.value, status)
                          }
                          disabled={isUpdating}
                          className="text-xs border rounded px-2 py-1 bg-white disabled:opacity-60"
                        >
                          {STATUS_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                        {isUpdating && (
                          <Loader2
                            size={14}
                            className="inline ml-1 animate-spin text-blue-500"
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const StatCard = ({ title, value }) => (
  <div className="bg-white rounded-xl shadow p-5">
    <p className="text-sm text-gray-500 mb-1">{title}</p>
    <h3 className="text-2xl font-bold text-gray-900">{value}</h3>
  </div>
);

export default Orders;
