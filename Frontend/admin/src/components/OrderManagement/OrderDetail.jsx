"use client";

import React, { useState, useEffect } from "react";
import { ArrowLeft, FileText, ExternalLink } from "lucide-react";
import toast from "react-hot-toast";
import { useContextApi } from "../../hooks/useContextApi";

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
    return dt.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    });
};

const formatDateTime = (d) => {
    if (!d) return "-";
    const dt = new Date(d);
    return dt.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
};

/* ---------------- DEFAULT ORDER ---------------- */

const DEFAULT_ORDER = {
    _id: "",
    status: "PLACED",
    createdAt: "",
    paymentMethod: "",
    totalAmt: 0,
    user: {},
    address: {},
    cartItems: [],
};

/* ---------------- COMPONENT ---------------- */

const OrderDetail = () => {
    const {
        setActiveTab,
        selectedOrderId,
        getOrderById,
        updateOrderStatus,
        processOrderRefund,
        retryShiprocketCancel,
        generateOrderAwb,
    } = useContextApi();

    const [order, setOrder] = useState(DEFAULT_ORDER);
    const [loading, setLoading] = useState(false);
    const [updating, setUpdating] = useState(false);

    /* -------- FETCH ORDER -------- */
    useEffect(() => {
        if (!selectedOrderId) return;

        const fetchOrder = async () => {
            try {
                setLoading(true);

                const res = await getOrderById(selectedOrderId);
                console.log("✅ Order Data:", res);

                // ✅ IMPORTANT: API returns { data: order }
                const orderData = res?.data;

                if (!orderData) return;

                // normalize address for UI (support both address and shippingAddress)
                const addr = orderData.address || orderData.shippingAddress || {};
                const formattedOrder = {
                    ...orderData,
                    address: {
                        name: addr.shopName || orderData.user?.name || "-",
                        phone: addr.phone || orderData.user?.phone || "-",
                        addressLine1: addr.address || addr.addressLine1 || "-",
                        addressLine2: addr.addressLine2 || "",
                        city: addr.city || "",
                        state: addr.state || "",
                        pincode: addr.pincode || "",
                    },
                };

                setOrder(formattedOrder);

            } catch (error) {
                console.error("❌ Error fetching order:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchOrder();
    }, [selectedOrderId]);

    /* -------- STATUS UPDATE -------- */
    const handleStatusChange = async (status) => {
        if (!selectedOrderId || !updateOrderStatus) return;
        const nextStatus = String(status || "").toUpperCase();
        const currentStatus = String(order.status || "").toUpperCase();
        let extraPayload = {};

        if (nextStatus === "CANCELLED" && ["DISPATCHED", "DELIVERED"].includes(currentStatus)) {
            const confirmed = window.confirm(
                "This order is already dispatched/delivered. Cancel anyway?"
            );
            if (!confirmed) return;
            extraPayload.forceCancel = true;
        }

        setUpdating(true);
        try {
            const result = await updateOrderStatus(selectedOrderId, "status", status, extraPayload);
            setOrder((prev) => ({ ...prev, status }));
            if (Array.isArray(result?.warnings) && result.warnings.length > 0) {
                result.warnings.forEach((w) => toast(w));
            } else if (result?.awbMessage) {
                toast(result.awbMessage);
            } else if (result?.awbError) {
                toast.error(result?.awbError?.message || "AWB generation failed");
            } else {
                toast.success("Order status updated");
            }
            const res = await getOrderById(selectedOrderId);
            const orderData = res?.data;
            if (orderData) {
                const addr = orderData.address || orderData.shippingAddress || {};
                setOrder({
                    ...orderData,
                    address: {
                        name: addr.shopName || orderData.user?.name || "-",
                        phone: addr.phone || orderData.user?.phone || "-",
                        addressLine1: addr.address || addr.addressLine1 || "-",
                        addressLine2: addr.addressLine2 || "",
                        city: addr.city || "",
                        state: addr.state || "",
                        pincode: addr.pincode || "",
                    },
                });
            }
        } catch (error) {
            toast.error(error?.response?.data?.message || "Failed to update status");
        } finally {
            setUpdating(false);
        }
    };

    const handleProcessRefund = async () => {
        if (!selectedOrderId || !processOrderRefund) return;
        setUpdating(true);
        try {
            const result = await processOrderRefund(selectedOrderId);
            toast.success(result?.message || "Refund processed successfully");
            const refreshed = await getOrderById(selectedOrderId);
            const orderData = refreshed?.data;
            if (orderData) {
                const addr = orderData.address || orderData.shippingAddress || {};
                setOrder({
                    ...orderData,
                    address: {
                        name: addr.shopName || orderData.user?.name || "-",
                        phone: addr.phone || orderData.user?.phone || "-",
                        addressLine1: addr.address || addr.addressLine1 || "-",
                        addressLine2: addr.addressLine2 || "",
                        city: addr.city || "",
                        state: addr.state || "",
                        pincode: addr.pincode || "",
                    },
                });
            }
        } catch (error) {
            toast.error(error?.response?.data?.message || "Failed to process refund");
        } finally {
            setUpdating(false);
        }
    };

    const handleRetryShiprocketCancel = async () => {
        if (!selectedOrderId || !retryShiprocketCancel) return;
        setUpdating(true);
        try {
            const result = await retryShiprocketCancel(selectedOrderId);
            toast(result?.message || "Shiprocket cancel retried");
            const refreshed = await getOrderById(selectedOrderId);
            const orderData = refreshed?.data;
            if (orderData) {
                const addr = orderData.address || orderData.shippingAddress || {};
                setOrder({
                    ...orderData,
                    address: {
                        name: addr.shopName || orderData.user?.name || "-",
                        phone: addr.phone || orderData.user?.phone || "-",
                        addressLine1: addr.address || addr.addressLine1 || "-",
                        addressLine2: addr.addressLine2 || "",
                        city: addr.city || "",
                        state: addr.state || "",
                        pincode: addr.pincode || "",
                    },
                });
            }
        } catch (error) {
            toast.error(error?.response?.data?.message || "Failed to retry shipment cancellation");
        } finally {
            setUpdating(false);
        }
    };

    const handleGenerateAwb = async () => {
        if (!selectedOrderId || !generateOrderAwb) return;
        setUpdating(true);
        try {
            const generated = await generateOrderAwb(selectedOrderId, Boolean(order.shiprocketAwb));
            const res = await getOrderById(selectedOrderId);
            const orderData = res?.data;
            if (orderData) {
                const addr = orderData.address || orderData.shippingAddress || {};
                setOrder({
                    ...orderData,
                    address: {
                        name: addr.shopName || orderData.user?.name || "-",
                        phone: addr.phone || orderData.user?.phone || "-",
                        addressLine1: addr.address || addr.addressLine1 || "-",
                        addressLine2: addr.addressLine2 || "",
                        city: addr.city || "",
                        state: addr.state || "",
                        pincode: addr.pincode || "",
                    },
                });
            }
            if (generated?.shiprocket?.awb || res?.data?.shiprocketAwb) {
                toast.success("AWB generated successfully");
            } else if (Array.isArray(generated?.warnings) && generated.warnings.length > 0) {
                toast("AWB generated with warnings. Check label/pickup status.");
            } else {
                toast("AWB request sent. Refresh once more if not visible yet.");
            }
        } catch (error) {
            const message =
                error?.response?.data?.message ||
                error?.response?.data?.shiprocketError?.message ||
                "Failed to generate AWB";
            toast.error(message);
        } finally {
            setUpdating(false);
        }
    };

    const userName =
        order.user?.name ||
        order.user?.phone ||
        "-";

    const address = order.address || {};
    const normalizedPaymentStatus = String(order.paymentStatus || "unpaid").toLowerCase();
    const canProcessRefund =
        String(order.status || "").toUpperCase() === "CANCELLED" &&
        ["refund_pending", "paid"].includes(normalizedPaymentStatus);

    if (loading) {
        return <div className="p-6">Loading order details...</div>;
    }

    return (
        <div className="p-6 bg-gray-50 min-h-screen">

            {/* Header */}
            <div className="flex justify-between items-center mb-6">
                <div>
                    <button
                        onClick={() => setActiveTab("All Orders")}
                        className="flex items-center gap-2 text-sm text-gray-600 hover:text-black mb-2"
                    >
                        <ArrowLeft size={16} /> Back
                    </button>

                    <h1 className="text-2xl font-bold text-gray-900">
                        Order Details
                    </h1>

                    <p className="text-gray-500">
                        Order ID: {String(order._id).slice(-8)}
                    </p>
                </div>

                <select
                    value={(order.status || "PLACED").toUpperCase()}
                    onChange={(e) => handleStatusChange(e.target.value)}
                    disabled={updating}
                    className="border rounded-lg px-3 py-2 text-sm bg-white"
                >
                    {STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>{s}</option>
                    ))}
                </select>
            </div>

            {/* Top Info */}
            <div className="grid md:grid-cols-3 gap-6 mb-6">

                <Card title="Customer Details">
                    <Info label="Name" value={userName} />
                    <Info label="Phone" value={order.user?.phone || "-"} />
                    <Info label="Email" value={order.user?.email || "-"} />
                </Card>

                <Card title="Order Info">
                    <Info label="Order Date" value={formatDate(order.createdAt)} />
                    <Info label="Payment Method" value={order.paymentMethod} />
                    <Info
                        label="Payment Status"
                        value={
                            normalizedPaymentStatus === "refund_pending"
                                ? "Refund Pending"
                                : normalizedPaymentStatus === "refunded"
                                    ? "Refunded"
                                    : normalizedPaymentStatus === "paid"
                                        ? "Paid"
                                        : "Unpaid"
                        }
                    />
                    <Info label="Total Amount" value={`₹${order.totalAmt}`} />
                    <Info label="Status" value={(order.status || "PLACED").toUpperCase()} />
                    {order.refundId ? <Info label="Refund ID" value={order.refundId} /> : null}
                    {order.refundTime ? <Info label="Refund Time" value={formatDateTime(order.refundTime)} /> : null}
                </Card>

                <Card title="Shipping / Shiprocket">
                    <Info label="Shipment ID (internal)" value={order.shiprocketShipmentId || "—"} />
                    <Info label="Tracking Number (AWB)" value={order.shiprocketAwb || "—"} />
                    {order.shiprocketAwb && order.trackingUrl ? (
                        <a
                            href={order.trackingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 text-sm text-blue-600 hover:underline mt-2"
                        >
                            <ExternalLink size={14} /> Track on Shiprocket (AWB)
                        </a>
                    ) : (
                        <p className="text-xs text-amber-700 mt-2">
                            Tracking link appears after AWB is generated. Shipment ID cannot be tracked on AWB search.
                        </p>
                    )}
                    <button
                        type="button"
                        onClick={handleGenerateAwb}
                        disabled={updating}
                        className="mt-2 inline-flex items-center rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                    >
                        {updating ? "Generating..." : order.shiprocketAwb ? "Regenerate AWB" : "Generate AWB"}
                    </button>
                    {order.shiprocketLabelUrl ? (
                        <a
                            href={order.shiprocketLabelUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 text-sm text-green-600 hover:underline mt-2"
                        >
                            <FileText size={14} /> Download label
                        </a>
                    ) : order.shiprocketAwb ? (
                        <p className="text-xs text-gray-500 mt-2">Label generated with AWB; re-dispatch to get link.</p>
                    ) : null}
                    {String(order.status || "").toUpperCase() === "CANCELLED" &&
                        String(order.shiprocketCancelStatus || "").toLowerCase() === "failed" ? (
                        <button
                            type="button"
                            onClick={handleRetryShiprocketCancel}
                            disabled={updating}
                            className="mt-2 inline-flex items-center rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-60"
                        >
                            Retry Shiprocket Cancel
                        </button>
                    ) : null}
                </Card>

                {/* Refund Timeline Card - Show when order is cancelled */}
                {String(order.status || "").toUpperCase() === "CANCELLED" && normalizedPaymentStatus !== "unpaid" ? (
                    <Card title="Refund Timeline">
                        <div className="space-y-3">
                            {order.refundStatus === "completed" ? (
                                <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3">
                                    <div className="flex items-start gap-2">
                                        <div className="text-emerald-600 font-bold text-xl mt-0.5">✓</div>
                                        <div>
                                            <p className="font-semibold text-emerald-900">Refund Processed</p>
                                            <p className="text-sm text-emerald-700 mt-1">
                                                Amount credited to {order.paymentMethod === "ONLINE" ? "customer's bank account" : "wallet"} on {formatDate(order.refundAt)}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            ) : order.refundStatus === "processing" ? (
                                <div className="rounded-lg bg-blue-50 border border-blue-200 p-3">
                                    <div className="flex items-start gap-2">
                                        <div className="text-blue-600 font-bold text-xl animate-pulse mt-0.5">⟳</div>
                                        <div>
                                            <p className="font-semibold text-blue-900">Refund Processing</p>
                                            <p className="text-sm text-blue-700 mt-1">
                                                Refund initiated on {formatDate(order.refundRequestedAt)}
                                            </p>
                                            <p className="text-xs text-blue-600 mt-2">
                                                Estimated completion: {formatDate(order.refundEstimatedCompletionDate)}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            ) : order.refundStatus === "pending" ? (
                                <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
                                    <div className="flex items-start gap-2">
                                        <div className="text-amber-600 font-bold text-lg mt-1">⧗</div>
                                        <div>
                                            <p className="font-semibold text-amber-900">Refund Will Be Processed</p>
                                            <p className="text-sm text-amber-700 font-medium mt-2">
                                                Takes 3–5 working days
                                            </p>
                                            <p className="text-xs text-amber-600 mt-2">
                                                Amount will be credited to customer's {order.paymentMethod === "ONLINE" ? "bank account" : "wallet"} within 5–7 working days after the refund is processed.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            ) : order.refundStatus === "failed" ? (
                                <div className="rounded-lg bg-red-50 border border-red-200 p-3">
                                    <div className="flex items-start gap-2">
                                        <div className="text-red-600 font-bold text-xl mt-0.5">⚠</div>
                                        <div>
                                            <p className="font-semibold text-red-900">Refund Failed</p>
                                            <p className="text-sm text-red-700 mt-1">
                                                {order.refundFailureReason || "Unable to process refund"}
                                            </p>
                                            {order.refundRetryCount > 0 && (
                                                <p className="text-xs text-red-600 mt-2">
                                                    Retry count: {order.refundRetryCount}
                                                </p>
                                            )}
                                            <button
                                                type="button"
                                                onClick={handleProcessRefund}
                                                disabled={updating}
                                                className="mt-2 inline-flex items-center rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
                                            >
                                                Retry Refund
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    </Card>
                ) : null}

                <Card title="Refund Management">
                    <Info
                        label="Payment Status"
                        value={
                            normalizedPaymentStatus === "refund_pending"
                                ? "Refund Pending"
                                : normalizedPaymentStatus === "refunded"
                                    ? "Refunded"
                                    : normalizedPaymentStatus === "paid"
                                        ? "Paid"
                                        : "Unpaid"
                        }
                    />
                    <button
                        type="button"
                        onClick={handleProcessRefund}
                        disabled={updating || !canProcessRefund}
                        className="mt-2 inline-flex items-center rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                    >
                        {normalizedPaymentStatus === "refunded" ? "Refunded" : "Process Refund"}
                    </button>
                    {!canProcessRefund ? (
                        <p className="text-xs text-gray-500 mt-2">
                            Refund is available only for cancelled paid orders.
                        </p>
                    ) : null}
                </Card>

                <Card title="Shipping Address">
                    <p className="text-sm text-gray-700 leading-relaxed">
                        {address.name}<br />
                        {address.phone}<br />
                        {address.addressLine1}
                    </p>
                </Card>

            </div>

            {/* Items Table */}
            <div className="bg-white rounded-xl shadow overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600">
                        <tr>
                            <th className="p-3 text-left">Product</th>
                            <th className="p-3 text-left">Qty</th>
                            <th className="p-3 text-left">Price</th>
                            <th className="p-3 text-left">Total</th>
                        </tr>
                    </thead>

                    <tbody>
                        {order.cartItems?.map((item, i) => (
                            <tr key={i} className="border-t">
                                <td className="p-3">{item.name}</td>
                                <td className="p-3">{item.quantity}</td>
                                <td className="p-3">₹{item.price}</td>
                                <td className="p-3 font-medium">
                                    ₹{item.price * item.quantity}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>

                <div className="flex justify-end p-4 border-t">
                    <div className="text-right">
                        <p className="text-gray-500 text-sm">Grand Total</p>
                        <p className="text-xl font-bold">₹{order.totalAmt}</p>
                    </div>
                </div>
            </div>
        </div>
    );
};

/* ---------------- UI COMPONENTS ---------------- */

const Card = ({ title, children }) => (
    <div className="bg-white rounded-xl shadow p-5">
        <h3 className="font-semibold text-gray-900 mb-3">{title}</h3>
        {children}
    </div>
);

const Info = ({ label, value }) => (
    <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-500">{label}</span>
        <span className="font-medium text-gray-800">{value}</span>
    </div>
);

export default OrderDetail;