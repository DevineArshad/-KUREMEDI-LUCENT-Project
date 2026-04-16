"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCcw } from "lucide-react";
import toast from "react-hot-toast";
import { useContextApi } from "../../hooks/useContextApi";

const formatDate = (d) => {
  if (!d) return "-";
  const dt = new Date(d);
  return dt.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const paymentStatusLabel = (value) => {
  const status = String(value || "unpaid").toLowerCase();
  if (status === "refund_pending") return "Refund Pending";
  if (status === "refunded") return "Refunded";
  if (status === "paid") return "Paid";
  return "Unpaid";
};

const paymentStatusClass = (value) => {
  const status = String(value || "unpaid").toLowerCase();
  if (status === "refund_pending") return "bg-orange-100 text-orange-800";
  if (status === "refunded") return "bg-green-100 text-green-800";
  if (status === "paid") return "bg-blue-100 text-blue-800";
  return "bg-gray-100 text-gray-700";
};

const CancelledOrders = () => {
  const {
    getallOrders,
    processOrderRefund,
    retryShiprocketCancel,
    setSelectedOrderId,
    setActiveTab,
  } = useContextApi();

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processingRefundId, setProcessingRefundId] = useState(null);
  const [retryingShiprocketId, setRetryingShiprocketId] = useState(null);

  const fetchCancelledOrders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getallOrders();
      const data = Array.isArray(res?.data)
        ? res.data
        : Array.isArray(res?.data?.data)
          ? res.data.data
          : [];
      const cancelled = data.filter(
        (o) => String(o?.status || "").toUpperCase() === "CANCELLED"
      );
      setOrders(cancelled);
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load cancelled orders");
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [getallOrders]);

  useEffect(() => {
    fetchCancelledOrders();
  }, [fetchCancelledOrders]);

  const handleViewOrder = (orderId) => {
    setSelectedOrderId(orderId);
    setActiveTab("Order Detail");
  };

  const handleRefund = async (order) => {
    const paymentStatus = String(order.paymentStatus || "unpaid").toLowerCase();
    if (!["refund_pending", "paid"].includes(paymentStatus)) return;

    setProcessingRefundId(order._id);
    try {
      const res = await processOrderRefund(order._id);
      toast.success(res?.message || "Refund processed successfully");
      await fetchCancelledOrders();
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to process refund");
    } finally {
      setProcessingRefundId(null);
    }
  };

  const handleRetryShiprocket = async (orderId) => {
    setRetryingShiprocketId(orderId);
    try {
      const res = await retryShiprocketCancel(orderId);
      toast(res?.message || "Shiprocket cancellation retried");
      await fetchCancelledOrders();
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to retry Shiprocket cancellation");
    } finally {
      setRetryingShiprocketId(null);
    }
  };

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Cancelled Orders</h1>
          <p className="text-gray-500">Manual refund management for cancelled paid orders</p>
        </div>
        <button
          type="button"
          onClick={fetchCancelledOrders}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 bg-white border rounded-lg text-sm hover:bg-gray-100 disabled:opacity-70"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCcw size={16} />}
          Refresh
        </button>
      </div>

      <div className="bg-white rounded-xl shadow overflow-hidden overflow-x-auto">
        <table className="w-full text-sm min-w-245">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="p-3 text-left">Order ID</th>
              <th className="p-3 text-left">Retailer</th>
              <th className="p-3 text-left">Amount</th>
              <th className="p-3 text-left">Payment Method</th>
              <th className="p-3 text-left">Payment Status</th>
              <th className="p-3 text-left">Refund ID</th>
              <th className="p-3 text-left">Refund Time</th>
              <th className="p-3 text-left">Shiprocket Cancel</th>
              <th className="p-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="9" className="text-center py-10">
                  <Loader2 className="animate-spin mx-auto h-8 w-8 text-blue-500" />
                </td>
              </tr>
            ) : orders.length === 0 ? (
              <tr>
                <td colSpan="9" className="text-center py-10 text-gray-500">
                  No cancelled orders found
                </td>
              </tr>
            ) : (
              orders.map((order) => {
                const isRefunding = processingRefundId === order._id;
                const isRetrying = retryingShiprocketId === order._id;
                const paymentStatus = String(order.paymentStatus || "unpaid").toLowerCase();
                const canRefund = ["refund_pending", "paid"].includes(paymentStatus);
                const shiprocketCancelStatus = String(order.shiprocketCancelStatus || "not_required").toLowerCase();

                return (
                  <tr key={order._id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="p-3 font-mono text-xs text-gray-600">{String(order._id).slice(-8)}</td>
                    <td className="p-3">{order.user?.name || order.user?.phone || "-"}</td>
                    <td className="p-3 font-medium">₹{order.totalAmt ?? 0}</td>
                    <td className="p-3">{order.paymentMethod || "-"}</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded text-xs ${paymentStatusClass(paymentStatus)}`}>
                        {paymentStatusLabel(paymentStatus)}
                      </span>
                    </td>
                    <td className="p-3 text-xs font-mono text-gray-700">{order.refundId || "-"}</td>
                    <td className="p-3 text-gray-600">{formatDate(order.refundTime)}</td>
                    <td className="p-3 text-xs">
                      {shiprocketCancelStatus === "failed" ? (
                        <div className="space-y-1">
                          <span className="px-2 py-0.5 rounded bg-red-100 text-red-800">Failed</span>
                          {order.shiprocketCancelError ? (
                            <div className="text-red-700 max-w-55 truncate" title={order.shiprocketCancelError}>
                              {order.shiprocketCancelError}
                            </div>
                          ) : null}
                        </div>
                      ) : shiprocketCancelStatus === "success" ? (
                        <span className="px-2 py-0.5 rounded bg-green-100 text-green-800">Cancelled</span>
                      ) : shiprocketCancelStatus === "pending" ? (
                        <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800">Pending</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-700">Not required</span>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleViewOrder(order._id)}
                          className="text-blue-600 text-xs hover:text-blue-800 font-medium px-2 py-1 hover:bg-blue-50 rounded transition"
                        >
                          View
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRefund(order)}
                          disabled={!canRefund || isRefunding}
                          className="text-xs px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
                        >
                          {paymentStatus === "refunded"
                            ? "Refunded"
                            : isRefunding
                              ? "Processing..."
                              : "Process Refund"}
                        </button>
                        {shiprocketCancelStatus === "failed" ? (
                          <button
                            type="button"
                            onClick={() => handleRetryShiprocket(order._id)}
                            disabled={isRetrying}
                            className="text-xs px-2 py-1 rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-60"
                          >
                            {isRetrying ? "Retrying..." : "Retry Shipment Cancel"}
                          </button>
                        ) : null}
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

export default CancelledOrders;
