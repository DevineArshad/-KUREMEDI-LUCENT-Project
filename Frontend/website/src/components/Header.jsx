 'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAppContext } from '@/context/context';
import { ClipboardList, Heart, ShoppingCart, User, Settings, ChevronDown, X } from 'lucide-react';
import Image from 'next/image';
import * as api from '@/api';
import { formatOrderNumber, getOrderProgressLabel, getOrderStatusClasses, normalizeOrderStatus } from '@/utils/orders';

export default function Header() {
    const historyRef = useRef(null);
    const [isOrderHistoryOpen, setIsOrderHistoryOpen] = useState(false);
    const [orderHistory, setOrderHistory] = useState([]);
    const [orderHistoryLoading, setOrderHistoryLoading] = useState(false);
    const [orderHistoryError, setOrderHistoryError] = useState('');
    const { cartItems, wishlistItems, user, token } = useAppContext();
    const cartCount = cartItems?.reduce((s, i) => s + (i.qty || 0), 0) ?? 0;
    const wishlistCount = wishlistItems?.length ?? 0;

    const navItems = [
        { label: 'Medicine', href: '/products' },
        { label: 'Healthcare', href: '/categories', hasDropdown: true },
        { label: 'Doctor Consult', href: '/support' },
        { label: 'Lab Tests', href: '/search?q=lab', hasDropdown: true },
        { label: 'PLUS', href: '/refer-earn' },
        { label: 'Health Insights', href: '/faq', hasDropdown: true },
        { label: 'Offers', href: '/products?sort=discount' },
    ];

    const formatDateStable = (dateLike) => {
        if (!dateLike) return 'Recent order';
        const d = new Date(dateLike);
        if (Number.isNaN(d.getTime())) return 'Recent order';
        return d.toISOString().slice(0, 10);
    };

    const loadOrderHistory = useCallback(async () => {
        if (!token) return;
        setOrderHistoryLoading(true);
        setOrderHistoryError('');
        try {
            const data = await api.getMyOrders();
            setOrderHistory(Array.isArray(data) ? data : []);
        } catch (error) {
            setOrderHistory([]);
            setOrderHistoryError('Unable to load order history');
        } finally {
            setOrderHistoryLoading(false);
        }
    }, [token]);

    useEffect(() => {
        if (!isOrderHistoryOpen) return;
        loadOrderHistory();
    }, [isOrderHistoryOpen, loadOrderHistory]);

    useEffect(() => {
        const onPointerDown = (event) => {
            if (!historyRef.current) return;
            if (!historyRef.current.contains(event.target)) {
                setIsOrderHistoryOpen(false);
            }
        };

        const onKeyDown = (event) => {
            if (event.key === 'Escape') {
                setIsOrderHistoryOpen(false);
            }
        };

        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('touchstart', onPointerDown);
        document.addEventListener('keydown', onKeyDown);

        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('touchstart', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, []);

    const recentOrders = orderHistory.slice(0, 3);

    return (
        <header className="bg-white shadow-sm sticky top-0 z-50">
            <div className="border-b border-gray-200">
                <div className="mx-auto max-w-7xl px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-6">
                            <Link href="/" className="shrink-0">
                                <Image src="/Kure.png" width={200} height={20} alt="Scaleten" className="h-auto" />
                            </Link>
  
                            <button className="hidden md:flex items-center gap-2 border-l border-gray-300 pl-6 text-left">
                                <span className="text-base">⚡</span>
                                <span>
                                    <span className="block text-xs text-black font-semibold">By Shiprocket Delivery2</span>
                                    {/* <span className="inline-flex items-center gap-1 text-sm font-semibold text-gray-900">
                                        Select Pincode <ChevronDown className="h-4 w-4" />
                                    </span> */}
                                </span>
                            </button>
                        </div> 

                        <div className="flex items-center gap-3 md:gap-5">

                        <div className="relative" ref={historyRef}>
                            <button
                                type="button"
                                onClick={() => setIsOrderHistoryOpen((prev) => !prev)}
                                className="relative p-2 text-gray-600 hover:text-teal-700 transition-colors"
                                aria-label="Open order history"
                                aria-expanded={isOrderHistoryOpen}
                            >
                                <ClipboardList className="w-6 h-6" />
                            </button>

                            {isOrderHistoryOpen && (
                                <div className="absolute right-0 top-full mt-3 w-[min(22rem,calc(100vw-2rem))] rounded-3xl border border-gray-100 bg-white shadow-2xl overflow-hidden z-50">
                                    <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
                                        <div>
                                            <p className="text-sm font-semibold text-gray-900">Order history</p>
                                            <p className="text-xs text-gray-500">Recent delivery updates</p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setIsOrderHistoryOpen(false)}
                                            className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                                            aria-label="Close order history"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                    </div>

                                    <div className="max-h-88 overflow-y-auto p-3 space-y-3">
                                        {!token ? (
                                            <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-4 text-center">
                                                <p className="text-sm font-medium text-gray-700">Login to view your order history.</p>
                                                <Link
                                                    href="/login"
                                                    className="mt-3 inline-flex items-center justify-center rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 transition-colors"
                                                >
                                                    Login
                                                </Link>
                                            </div>
                                        ) : orderHistoryLoading ? (
                                            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 text-center text-sm text-gray-500">
                                                Loading order history...
                                            </div>
                                        ) : orderHistoryError ? (
                                            <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm text-rose-700">
                                                {orderHistoryError}
                                            </div>
                                        ) : recentOrders.length === 0 ? (
                                            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 text-center text-sm text-gray-500">
                                                No orders yet.
                                            </div>
                                        ) : (
                                            recentOrders.map((order) => {
                                                const status = normalizeOrderStatus(order.status);
                                                const items = Array.isArray(order.items) ? order.items : [];
                                                const firstItemNames = items.slice(0, 2).map((item) => item?.productName || 'Ordered product').join(', ');
                                                const extraCount = Math.max(0, items.length - 2);

                                                return (
                                                    <div key={order._id} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                                                        <div className="flex items-start justify-between gap-3">
                                                            <div className="min-w-0">
                                                                <p className="text-sm font-semibold text-gray-900">Order #{formatOrderNumber(order._id)}</p>
                                                                <p className="mt-1 text-xs text-gray-500">{firstItemNames || 'Ordered product'}</p>
                                                            </div>
                                                            <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getOrderStatusClasses(status)}`}>
                                                                {getOrderProgressLabel(status)}
                                                            </span>
                                                        </div>
                                                        <p className="mt-2 text-xs text-gray-500">
                                                            {formatDateStable(order.createdAt)}
                                                            {extraCount > 0 ? ` • +${extraCount} more` : ''}
                                                        </p>
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>

                                    <div className="border-t border-gray-100 bg-gray-50 p-3">
                                        <Link
                                            href="/ordered-products"
                                            onClick={() => setIsOrderHistoryOpen(false)}
                                            className="flex items-center justify-between rounded-2xl bg-teal-700 px-4 py-3 text-sm font-semibold text-white hover:bg-teal-800 transition-colors"
                                        >
                                            <span>View ordered products</span>
                                            <span aria-hidden="true">→</span>
                                        </Link>
                                    </div>
                                </div>
                            )}
                        </div>

                        <Link href="/wishlist" className="relative p-2 text-gray-700 hover:text-teal-700 transition-colors" aria-label="Wishlist">
                            <Heart className="w-5 h-5" />
                            {wishlistCount > 0 && (
                                <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] leading-4 text-center font-semibold">{wishlistCount}</span>
                            )}
                        </Link>

                        <button className="hidden md:inline-flex p-2 text-gray-700 hover:text-teal-700 transition-colors" aria-label="Settings">
                            <Settings className="w-5 h-5" />
                        </button>

                        <Link href="/products?sort=discount" className="hidden md:inline-flex items-center text-sm font-medium text-gray-800 hover:text-teal-700 transition-colors">
                            Offers
                        </Link>

                        <Link
                            href={token ? "/profile" : "/login"}
                            className="inline-flex items-center gap-2 text-sm font-medium text-gray-800 hover:text-teal-700 transition-colors relative"
                        >
                            <User className="h-5 w-5" />
                            <span>{token ? (user?.name || 'My Account') : 'Hello, Log in'}</span>
                            {!token && <span className="absolute -top-1 -right-2 h-2.5 w-2.5 rounded-full bg-rose-500" />}
                        </Link>

                        <Link href="/cart" className="relative inline-flex items-center gap-2 text-sm font-medium text-gray-800 hover:text-teal-700 transition-colors">
                            <ShoppingCart className="w-5 h-5" />
                            <span className="hidden md:inline">Cart</span>
                            {cartCount > 0 && (
                                <span className="absolute -top-1 -right-2 min-w-4 h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] leading-4 text-center font-semibold">{cartCount}</span>
                            )}
                        </Link>
                    </div>
                </div>
            </div>
            </div>

            <div className="border-b border-gray-200 bg-gray-50/40">
                <nav className="mx-auto max-w-7xl px-4 py-3">
                    <ul className="flex items-center justify-center gap-7 md:gap-10 overflow-x-auto whitespace-nowrap">
                        {navItems.map((item) => (
                            <li key={item.label}>
                                <Link href={item.href} className="inline-flex items-center gap-1 text-sm font-medium text-gray-800 hover:text-teal-700 transition-colors">
                                    <span>{item.label}</span>
                                    {item.hasDropdown ? <ChevronDown className="h-4 w-4" /> : null}
                                </Link>
                            </li>
                        ))}
                    </ul>
                </nav>
            </div>
        </header>
    );
}