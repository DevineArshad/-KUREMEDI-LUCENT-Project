'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download, Receipt, Check, Package, Truck, MapPin, RefreshCw, X } from 'lucide-react';
import { useAppContext } from '@/context/context';
import * as api from '@/api';
import { downloadOrderInvoicePdf } from '@/utils/invoice';

const STATUS_STEPS = [
  { key: 'PLACED', label: 'Order Placed', icon: Receipt },
  { key: 'CONFIRMED', label: 'Confirmed', icon: Check },
  { key: 'DISPATCHED', label: 'Shipped', icon: Package },
  { key: 'DELIVERED', label: 'Delivered', icon: Truck },
];

const STATUS_ORDER = ['PENDING', 'PLACED', 'CONFIRMED', 'DISPATCHED', 'DELIVERED', 'CANCELLED'];

const formatMoney = (value) =>
  `₹${Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

function formatDateStable(dateLike) {
  if (!dateLike) return '';
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function getStepIndex(status) {
  const s = (status || 'PLACED').toUpperCase();
  if (s === 'CANCELLED' || s === 'REFUNDED') return -1;
  const i = STATUS_ORDER.indexOf(s);
  return i < 0 ? 0 : i;
}

function OrderStatusTimeline({ status }) {
  const currentIndex = getStepIndex(status);
  const statusUpper = (status || 'PLACED').toUpperCase();
  const isCancelled = statusUpper === 'CANCELLED' || statusUpper === 'REFUNDED';

  if (isCancelled) {
    return (
      <div className="flex items-center gap-2 mt-2">
        <div className="w-6 h-6 rounded-full bg-red-100 flex items-center justify-center">
          <X className="w-3.5 h-3.5 text-red-600" />
        </div>
        <span className="text-red-600 font-medium text-sm">{statusUpper === 'REFUNDED' ? 'Refunded' : 'Cancelled'}</span>
      </div>
    );
  }

  return (
    <div className="mt-3 flex justify-between relative">
      {STATUS_STEPS.map((step, index) => {
        const stepOrderIndex = STATUS_ORDER.indexOf(step.key);
        const isDone = currentIndex > stepOrderIndex || (step.key === 'DELIVERED' && statusUpper === 'DELIVERED');
        const isCurrent = statusUpper === step.key;
        const Icon = step.icon;
        return (
          <div key={step.key} className="flex flex-col items-center flex-1 relative z-10">
            <div
              className={`w-9 h-9 rounded-full flex items-center justify-center ${
                isDone ? 'bg-teal-600' : isCurrent ? 'bg-teal-500' : 'bg-gray-200'
              }`}
            >
              <Icon className={`w-4 h-4 ${isDone || isCurrent ? 'text-white' : 'text-gray-400'}`} />
            </div>
            <span
              className={`text-[10px] mt-1 text-center max-w-16 ${
                isCurrent ? 'text-teal-600 font-semibold' : isDone ? 'text-teal-600' : 'text-gray-400'
              }`}
            >
              {step.label}
            </span>
            {index < STATUS_STEPS.length - 1 && (
              <div
                className={`absolute top-4.5 left-1/2 w-full h-0.5 z-0 ${
                  currentIndex > stepOrderIndex ? 'bg-teal-600' : 'bg-gray-200'
                }`}
                style={{ width: '100%', marginLeft: '50%' }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function OrdersPage() {
  const { token, user } = useAppContext();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [trackingOrderId, setTrackingOrderId] = useState(null);
  const [trackingData, setTrackingData] = useState(null);
  const [trackingLoading, setTrackingLoading] = useState(false);

  const fetchOrders = useCallback(() => {
    if (!token) return;
    setLoading(true);
    api
      .getMyOrders()
      .then((data) => setOrders(Array.isArray(data) ? data : []))
      .catch(() => setOrders([]))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    // Ensure scroll is restored if a previous modal/page left it locked.
    if (typeof document !== 'undefined') {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
      document.documentElement.style.overflow = '';
    }
  }, []);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    fetchOrders();
  }, [token, fetchOrders]);

  const openTracking = (orderId) => {
    setTrackingOrderId(orderId);
    setTrackingData(null);
    setTrackingLoading(true);
    api
      .getOrderTracking(orderId)
      .then((data) => setTrackingData(data))
      .catch(() => setTrackingData({ order: undefined, tracking: null }))
      .finally(() => setTrackingLoading(false));
  };

  const closeTrackingModal = () => {
    setTrackingOrderId(null);
    setTrackingData(null);
  };

  const buildTrackUrl = (awb, trackingUrl) => {
    if (!awb) return trackingUrl || 'https://shiprocket.co/tracking';
    const safe = `https://shiprocket.co/tracking/${encodeURIComponent(awb)}`;
    if (!trackingUrl) return safe;
    if (trackingUrl.includes('track.shiprocket.in')) return safe;
    if (trackingUrl.includes('shiprocket.in/shipment-tracking')) return safe;
    return trackingUrl;
  };

  const handleAwbClick = async (e, awb, trackingUrl) => {
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
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-gray-500 mb-4">Please login to view orders</p>
          <Link href="/login" className="inline-block bg-teal-700 text-white px-6 py-3 rounded-xl font-semibold hover:bg-teal-700">
            Login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="sticky top-0 bg-white border-b border-gray-200 z-10">
        <div className="container mx-auto px-4 py-3 flex items-center gap-4">
          <Link href="/profile" className="p-1 -ml-1 text-gray-700 hover:text-gray-900">
            <ArrowLeft className="w-7 h-7" />
          </Link>
          <h1 className="text-lg font-semibold text-gray-900">My Orders</h1>
          <button
            type="button"
            onClick={fetchOrders}
            disabled={loading}
            className="ml-auto p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-50"
            aria-label="Refresh orders"
          >
            <RefreshCw className={`w-5 h-5 text-teal-700 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 px-4">
          <div className="w-10 h-10 border-2 border-teal-700 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-gray-500">Loading orders...</p>
        </div>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 px-4">
          <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center mb-4">
            <Receipt className="w-10 h-10 text-gray-400" />
          </div>
          <p className="text-lg font-semibold text-gray-700">No orders yet</p>
          <p className="text-gray-500 mt-2 text-center">Your orders will appear here once you place them.</p>
          <Link
            href="/"
            className="mt-6 bg-teal-700 text-white px-6 py-3 rounded-xl font-semibold hover:bg-teal-700 transition-colors"
          >
            Continue Shopping
          </Link>
        </div>
      ) : (
        <div className="max-w-xl mx-auto px-4 py-6 space-y-3">
          {orders.map((item) => {
            const status = (item.status || 'PLACED').toUpperCase();
            const hasTracking = !!(item.trackingUrl || item.shiprocketAwb);
            const isDispatched = status === 'DISPATCHED' || status === 'DELIVERED';
            const trackingLink = item.trackingUrl || (item.shiprocketAwb ? `https://shiprocket.co/tracking/${encodeURIComponent(item.shiprocketAwb)}` : null);

            return (
              <div
                key={item._id || `${item.createdAt || 'order'}-${item.payableAmount || item.totalAmount || 0}`}
                className="bg-white rounded-2xl p-4 border border-gray-200 shadow-sm"
              >
                <div className="flex justify-between items-start">
                  <p className="text-sm font-medium text-gray-500">
                    Order #{String(item._id ?? '').slice(-8).toUpperCase()}
                  </p>
                  <p className="text-sm font-semibold text-teal-700">
                    {formatMoney(item.payableAmount ?? item.totalAmount ?? 0)}
                  </p>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  {formatDateStable(item.createdAt)}
                </p>

                <OrderStatusTimeline status={item.status} />

                {item.shiprocketAwb && trackingLink && (
                  <div className="mt-3 rounded-xl border border-teal-200 bg-teal-50 px-3 py-2">
                    <p className="text-[11px] text-teal-700 font-medium">Tracking ID</p>
                    <a
                      href={trackingLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => handleAwbClick(e, item.shiprocketAwb, trackingLink)}
                      className="text-sm font-semibold text-teal-800 hover:text-teal-900 underline underline-offset-2 break-all"
                    >
                      {item.shiprocketAwb}
                    </a>
                  </div>
                )}

                {isDispatched && hasTracking && (
                  <button
                    type="button"
                    onClick={() => openTracking(item._id)}
                    className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-teal-50 border border-teal-200 text-teal-700 font-semibold text-sm hover:bg-teal-100 transition-colors"
                  >
                    <MapPin className="w-4 h-4" />
                    Track order
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => downloadOrderInvoicePdf(item, { buyer: user })}
                  className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white border border-gray-200 text-gray-700 font-semibold text-sm hover:border-teal-300 hover:text-teal-700 transition-colors"
                >
                  <Download className="w-4 h-4" />
                  Download invoice PDF
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Tracking modal */}
      {trackingOrderId && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={closeTrackingModal}
          onKeyDown={(e) => e.key === 'Escape' && closeTrackingModal()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="tracking-title"
        >
          <div
            className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-gray-200 flex justify-between items-center">
              <h2 id="tracking-title" className="text-lg font-semibold text-gray-900">
                Where is my order?
              </h2>
              <button
                type="button"
                onClick={closeTrackingModal}
                className="p-1 rounded-lg hover:bg-gray-100 text-gray-600"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="overflow-y-auto p-4">
              {trackingLoading ? (
                <div className="py-12 flex flex-col items-center">
                  <div className="w-10 h-10 border-2 border-teal-700 border-t-transparent rounded-full animate-spin mb-3" />
                  <p className="text-gray-500">Loading tracking...</p>
                </div>
              ) : trackingData?.tracking?.tracking_data?.shipment_track_activities ? (
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-gray-700">Live status</p>
                  {trackingData.tracking.tracking_data.shipment_track_activities.map((act, i) => (
                    <div key={i} className="flex gap-3 pb-3 border-b border-gray-100 last:border-0">
                      <div className="w-2 h-2 rounded-full bg-teal-500 mt-1.5 shrink-0" />
                      <div>
                        <p className="text-gray-800 font-medium">{act.status ?? act.activity ?? 'Update'}</p>
                        <p className="text-xs text-gray-500">{act.date ?? ''}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : trackingData?.tracking ? (
                <div className="py-2">
                  {trackingData?.order?.trackingNumber && trackingData?.order?.trackingUrl ? (
                    <div className="mb-3 rounded-xl border border-teal-200 bg-teal-50 px-3 py-2">
                      <p className="text-[11px] text-teal-700 font-medium">Tracking ID</p>
                      <a
                        href={trackingData.order.trackingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => handleAwbClick(e, trackingData.order.trackingNumber, trackingData.order.trackingUrl)}
                        className="text-sm font-semibold text-teal-800 hover:text-teal-900 underline underline-offset-2 break-all"
                      >
                        {trackingData.order.trackingNumber}
                      </a>
                    </div>
                  ) : null}
                  <p className="text-gray-500 py-2">No scan updates yet. Status will appear here soon.</p>
                </div>
              ) : (
                <p className="text-gray-500 py-4">Tracking details will appear once available.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
