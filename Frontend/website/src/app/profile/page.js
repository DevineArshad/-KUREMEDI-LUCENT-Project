'use client';

import React, { useCallback, useEffect } from 'react';
import Link from 'next/link';
import {
  BadgeHelp,
  Contact,
  FileText,
  Gift,
  HelpCircle,
  LogOut,
  Receipt,
  ShieldCheck,
  ShoppingBag,
  Wallet,
} from 'lucide-react';
import { useAppContext } from '@/context/context';
import { KycBanner } from '@/components/KycBanner';
import * as api from '@/api';
import UserDashboardHero from '@/components/dashboard/UserDashboardHero';
import UserDashboardStatCard from '@/components/dashboard/UserDashboardStatCard';
import UserDashboardMenuSection from '@/components/dashboard/UserDashboardMenuSection';

const formatCurrency = (value) =>
  `INR ${Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const getPendingCount = (orders = []) =>
  orders.filter((order) => {
    const status = String(order?.status || '').toUpperCase();
    return status !== 'DELIVERED' && status !== 'CANCELLED' && status !== 'REFUNDED';
  }).length;

export default function ProfilePage() {
  const { user, token, logout, refreshUser } = useAppContext();
  const [stats, setStats] = React.useState({
    orderCount: 0,
    pendingCount: 0,
    walletBalance: 0,
  });

  const loadProfile = useCallback(() => {
    if (token) refreshUser();
  }, [token, refreshUser]);

  const loadStats = useCallback(async () => {
    if (!token) return;

    const [ordersResult, walletResult] = await Promise.allSettled([
      api.getMyOrders(),
      api.getWallet(),
    ]);

    const orders =
      ordersResult.status === 'fulfilled' && Array.isArray(ordersResult.value)
        ? ordersResult.value
        : [];

    const walletBalance =
      walletResult.status === 'fulfilled'
        ? Number(walletResult.value?.balance || 0)
        : 0;

    setStats({
      orderCount: orders.length,
      pendingCount: getPendingCount(orders),
      walletBalance,
    });
  }, [token]);

  useEffect(() => {
    loadProfile();
    loadStats();
  }, [loadProfile, loadStats]);

  if (!token || !user) {
    return (
      <div className="min-h-screen bg-linear-to-b from-teal-50 via-white to-cyan-50 px-4 py-8">
        <div className="mx-auto max-w-5xl">
          <section className="relative overflow-hidden rounded-3xl border border-teal-100 bg-white p-8 text-center shadow-sm sm:p-12">
            <div className="absolute -right-12 -top-12 h-48 w-48 rounded-full bg-teal-100/70 blur-3xl" />
            <div className="absolute -bottom-16 -left-12 h-48 w-48 rounded-full bg-cyan-100/70 blur-3xl" />

            <div className="relative z-10">
              <span className="mx-auto inline-flex h-20 w-20 items-center justify-center rounded-2xl bg-teal-700 text-white">
                <ShoppingBag className="h-9 w-9" />
              </span>
              <h1 className="mt-5 text-3xl font-black text-gray-900">Your Dashboard Awaits</h1>
              <p className="mx-auto mt-3 max-w-xl text-sm text-gray-600">
                Login to access orders, wallet, KYC progress, support, and account actions in one place.
              </p>

              <Link
                href="/login"
                className="mt-6 inline-flex items-center justify-center rounded-xl bg-teal-700 px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-teal-800"
              >
                Login with OTP
              </Link>
            </div>
          </section>
        </div>
      </div>
    );
  }

  const primaryItems = [
    {
      href: '/orders',
      label: 'My Orders',
      description: 'Track orders and download invoices',
      icon: Receipt,
    },
    {
      href: '/wallet',
      label: 'Wallet',
      description: 'Recharge and use balance at checkout',
      icon: Wallet,
    },
    {
      href: '/kyc',
      label: 'KYC Verification',
      description: 'Submit documents and check approval status',
      icon: ShieldCheck,
    },
    {
      href: '/profile-edit',
      label: 'Profile Update',
      description: 'Edit shop and account details',
      icon: BadgeHelp,
    },
    {
      href: '/refer-earn',
      label: 'Refer and Earn',
      description: 'Share code and earn wallet rewards',
      icon: Gift,
    },
  ];

  const helpItems = [
    {
      href: '/support',
      label: 'Support',
      description: 'Raise tickets and chat with support',
      icon: Contact,
    },
    {
      href: '/faq',
      label: 'FAQ',
      description: 'Common order and account questions',
      icon: HelpCircle,
    },
    {
      href: '/privacy-policy',
      label: 'Privacy Policy',
      description: 'How your data is handled',
      icon: ShieldCheck,
    },
    {
      href: '/terms-and-conditions',
      label: 'Terms and Conditions',
      description: 'Platform terms and usage rules',
      icon: FileText,
    },
  ];

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_right,#c7f9f1_0%,#ffffff_40%,#f1fbff_100%)] px-4 py-8">
      <div className="mx-auto grid max-w-6xl gap-6">
        <UserDashboardHero user={user} />

        <KycBanner kyc={user.kyc} />

        <section className="rounded-2xl border-2 border-teal-200 bg-linear-to-b from-teal-50/50 to-cyan-50/50 p-6 backdrop-blur-sm">
          <div className="mb-6">
            <p className="text-xs font-bold uppercase tracking-widest text-teal-700">Quick Stats</p>
            <h2 className="mt-2 text-2xl font-black text-gray-900">Your Dashboard</h2>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <UserDashboardStatCard
              icon={Receipt}
              label="Total Orders"
              value={stats.orderCount}
              hint="All orders placed from this account"
              tone="teal"
            />
            <UserDashboardStatCard
              icon={ShoppingBag}
              label="Open Orders"
              value={stats.pendingCount}
              hint="Pending, confirmed, and dispatched"
              tone="amber"
            />
            <UserDashboardStatCard
              icon={Wallet}
              label="Wallet Balance"
              value={formatCurrency(stats.walletBalance)}
              hint="Available for checkout"
              tone="violet"
            />
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <UserDashboardMenuSection title="Account" items={primaryItems} />
          <UserDashboardMenuSection title="Help and Legal" items={helpItems} />
        </section>

        <button
          onClick={logout}
          className="w-full rounded-2xl border border-rose-200 bg-rose-50 px-5 py-3.5 text-sm font-bold text-rose-700 transition-colors hover:bg-rose-100"
        >
          <span className="inline-flex items-center gap-2">
            <LogOut className="h-4.5 w-4.5" />
            Logout
          </span>
        </button>
      </div>
    </div>
  );
}
