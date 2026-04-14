'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download, PackageSearch, RefreshCw, ShoppingBag, CheckCircle2, Truck } from 'lucide-react';
import { useAppContext } from '@/context/context';
import * as api from '@/api';
import { downloadOrderInvoicePdf } from '@/utils/invoice';
import {
    flattenOrderedProducts,
    formatOrderNumber,
    getOrderStatusClasses,
    getOrderStatusMeta,
} from '@/utils/orders';

const formatMoney = (value) =>
    `₹${Number(value || 0).toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;

export default function OrderedProductsPage() {
    const { token, user } = useAppContext();
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const loadOrders = useCallback(() => {
        if (!token) {
            setOrders([]);
            setLoading(false);
            return;
        }

        setLoading(true);
        setError('');

        api
            .getMyOrders()
            .then((data) => setOrders(Array.isArray(data) ? data : []))
            .catch(() => setError('Unable to load ordered products right now.'))
            .finally(() => setLoading(false));
    }, [token]);

    useEffect(() => {
        loadOrders();
    }, [loadOrders]);

    const orderedProducts = useMemo(() => flattenOrderedProducts(orders), [orders]);
    const deliveredCount = orderedProducts.filter((item) => item.isDelivered).length;
    const pendingCount = orderedProducts.length - deliveredCount;

    const handleDownloadInvoice = useCallback((orderId) => {
        const order = orders.find((entry) => String(entry?._id) === String(orderId));
        downloadOrderInvoicePdf(order, { buyer: user });
    }, [orders, user]);

    const buildTrackUrl = useCallback((awb, trackingUrl) => {
        if (!awb) return trackingUrl || 'https://shiprocket.co/tracking';
        const safe = `https://shiprocket.co/tracking/${encodeURIComponent(awb)}`;
        if (!trackingUrl) return safe;
        if (trackingUrl.includes('track.shiprocket.in')) return safe;
        if (trackingUrl.includes('shiprocket.in/shipment-tracking')) return safe;
        return trackingUrl;
    }, []);

    const handleAwbClick = useCallback(async (e, awb, trackingUrl) => {
        e.preventDefault();
        const finalUrl = buildTrackUrl(awb, trackingUrl);
        try {
            if (navigator?.clipboard?.writeText && awb) {
                await navigator.clipboard.writeText(String(awb));
            }
        } catch {
            // Continue with redirect even if clipboard permission is blocked.
        }
        window.open(finalUrl, '_blank', 'noopener,noreferrer');
    }, [buildTrackUrl]);

    return (
        <div className="min-h-screen bg-linear-to-b from-teal-50 via-white to-gray-50">
            <div className="container mx-auto px-4 py-8 max-w-6xl">
                <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-8">
                    <div className="space-y-4">
                        <Link
                            href="/profile"
                            className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:border-teal-300 hover:text-teal-700 shadow-sm transition-colors"
                        >
                            <ArrowLeft className="w-4 h-4" />
                            Back
                        </Link>
                        <div className="inline-flex items-center gap-2 rounded-full bg-teal-100 text-teal-800 px-3 py-1 text-sm font-semibold mb-3">
                            <PackageSearch className="w-4 h-4" />
                            Ordered products
                        </div>
                        <h1 className="text-3xl md:text-4xl font-bold text-gray-900">Delivery status at a glance</h1>
                        <p className="text-gray-600 mt-2 max-w-2xl">
                            View every product you ordered and quickly see whether it has been delivered or is still on the way.
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={loadOrders}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700 hover:border-teal-300 hover:text-teal-700 shadow-sm transition-colors"
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
                    <div className="rounded-3xl bg-white border border-gray-200 shadow-sm p-5">
                        <div className="flex items-center gap-3 text-gray-500 mb-2">
                            <ShoppingBag className="w-5 h-5 text-teal-600" />
                            Total ordered products
                        </div>
                        <p className="text-3xl font-bold text-gray-900">{orderedProducts.length}</p>
                    </div>
                    <div className="rounded-3xl bg-white border border-gray-200 shadow-sm p-5">
                        <div className="flex items-center gap-3 text-gray-500 mb-2">
                            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                            Delivered vs pending
                        </div>
                        <p className="text-3xl font-bold text-gray-900">
                            {deliveredCount} / {pendingCount}
                        </p>
                    </div>
                </div>

                {!token ? (
                    <div className="bg-white rounded-3xl border border-gray-200 shadow-sm p-8 text-center max-w-xl mx-auto">
                        <div className="w-16 h-16 mx-auto rounded-full bg-teal-100 flex items-center justify-center mb-4">
                            <ShoppingBag className="w-8 h-8 text-teal-700" />
                        </div>
                        <h2 className="text-xl font-bold text-gray-900 mb-2">Login required</h2>
                        <p className="text-gray-600 mb-6">Sign in to see your ordered product list and delivery status.</p>
                        <Link
                            href="/login"
                            className="inline-flex items-center gap-2 rounded-2xl bg-teal-700 px-5 py-3 text-white font-semibold hover:bg-teal-800 transition-colors"
                        >
                            Login
                        </Link>
                    </div>
                ) : loading ? (
                    <div className="bg-white rounded-3xl border border-gray-200 shadow-sm p-10 text-center">
                        <div className="w-11 h-11 mx-auto border-2 border-teal-700 border-t-transparent rounded-full animate-spin" />
                        <p className="text-gray-500 mt-4">Loading ordered products...</p>
                    </div>
                ) : error ? (
                    <div className="bg-white rounded-3xl border border-rose-100 shadow-sm p-6 text-rose-700">
                        {error}
                    </div>
                ) : orderedProducts.length === 0 ? (
                    <div className="bg-white rounded-3xl border border-gray-200 shadow-sm p-8 text-center max-w-xl mx-auto">
                        <div className="w-16 h-16 mx-auto rounded-full bg-gray-100 flex items-center justify-center mb-4">
                            <Truck className="w-8 h-8 text-gray-400" />
                        </div>
                        <h2 className="text-xl font-bold text-gray-900 mb-2">No ordered products yet</h2>
                        <p className="text-gray-600">Once you place an order, the product list and delivery status will appear here.</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {orderedProducts.map((item) => {
                            const meta = getOrderStatusMeta(item.status);
                            const isDelivered = item.isDelivered;

                            return (
                                <div key={item.id} className="bg-white rounded-3xl border border-gray-200 shadow-sm p-5 md:p-6">
                                    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-3 flex-wrap">
                                                <h2 className="text-lg font-bold text-gray-900 truncate">{item.productName}</h2>
                                                <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${isDelivered ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-amber-100 text-amber-800 border-amber-200'}`}>
                                                    {item.deliveryLabel}
                                                </span>
                                            </div>
                                            <p className="text-sm text-gray-500 mt-1">
                                                Order #{formatOrderNumber(item.orderId)} • {item.orderDate ? new Date(item.orderDate).toLocaleDateString() : 'Recent order'}
                                            </p>
                                            <p className="text-sm text-gray-600 mt-3">
                                                Quantity: <span className="font-semibold text-gray-900">{item.quantity}</span> • Current stage: <span className="font-semibold text-gray-900">{item.progressLabel}</span>
                                            </p>
                                            <div className="mt-2 text-sm">
                                                {item.shiprocketAwb ? (
                                                    <p className="text-gray-700">
                                                        AWB ID:{' '}
                                                        <a
                                                            href={item.trackingUrl || `https://shiprocket.co/tracking/${encodeURIComponent(item.shiprocketAwb)}`}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            onClick={(e) => handleAwbClick(e, item.shiprocketAwb, item.trackingUrl)}
                                                            className="font-semibold text-teal-700 hover:text-teal-800 underline underline-offset-2"
                                                        >
                                                            {item.shiprocketAwb}
                                                        </a>
                                                    </p>
                                                ) : item.shiprocketShipmentId ? (
                                                    <p className="text-gray-700">
                                                        Shipment ID: <span className="font-semibold text-gray-900">{item.shiprocketShipmentId}</span>{' '}
                                                        <span className="text-xs text-amber-700">(AWB pending)</span>
                                                    </p>
                                                ) : (
                                                    <p className="text-gray-500">Tracking ID will appear after dispatch.</p>
                                                )}
                                            </div>
                                        </div>

                                        <div className="flex flex-col items-start md:items-end gap-3 shrink-0">
                                            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${getOrderStatusClasses(item.status)}`}>
                                                {meta.label}
                                            </span>
                                            <p className="text-lg font-bold text-gray-900">{formatMoney(item.lineTotal || 0)}</p>
                                            <div className="flex flex-wrap gap-2 justify-start md:justify-end">
                                                {item.productId ? (
                                                    <Link
                                                        href={`/products/${item.productId}`}
                                                        className="inline-flex items-center gap-2 rounded-2xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 transition-colors"
                                                    >
                                                        View product
                                                    </Link>
                                                ) : null}
                                                <button
                                                    type="button"
                                                    onClick={() => handleDownloadInvoice(item.orderId)}
                                                    className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:border-teal-300 hover:text-teal-700 transition-colors"
                                                >
                                                    <Download className="w-4 h-4" />
                                                    Download invoice
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}