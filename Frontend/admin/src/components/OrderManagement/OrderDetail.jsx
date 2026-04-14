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
    const { setActiveTab, selectedOrderId, getOrderById, updateOrderStatus, generateOrderAwb } = useContextApi();

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
        setUpdating(true);
        try {
            const result = await updateOrderStatus(selectedOrderId, "status", status);
            setOrder((prev) => ({ ...prev, status }));
            if (result?.refundMessage) {
                toast.success(result.refundMessage);
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
                    <Info label="Total Amount" value={`₹${order.totalAmt}`} />
                    <Info label="Status" value={(order.status || "PLACED").toUpperCase()} />
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