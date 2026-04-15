'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ShieldAlert, X } from 'lucide-react';
import { useAppContext } from '@/context/context';

const DISMISS_KEY = 'kyc-prompt-dismissed-at';
const REMIND_AFTER_MS = 60 * 1000;

export default function GlobalKycPendingBanner() {
  const { token, user, refreshUser } = useAppContext();
  const pathname = usePathname();
  const [dismissedAt, setDismissedAt] = useState(null);
  const [isOpen, setIsOpen] = useState(false);
  const isOnKycPage = pathname === '/kyc';

  useEffect(() => {
    if (!token) return;
    refreshUser();
  }, [token, refreshUser]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(DISMISS_KEY);
    setDismissedAt(stored ? Number(stored) : null);
  }, []);

  useEffect(() => {
    if (!token || user?.kyc !== 'BLANK' || isOnKycPage) {
      setIsOpen(false);
      return;
    }

    if (!dismissedAt) {
      setIsOpen(true);
      return;
    }

    const elapsed = Date.now() - dismissedAt;
    if (elapsed >= REMIND_AFTER_MS) {
      setIsOpen(true);
      return;
    }

    const timer = setTimeout(() => {
      setIsOpen(true);
    }, REMIND_AFTER_MS - elapsed);

    return () => clearTimeout(timer);
  }, [token, user?.kyc, dismissedAt, isOnKycPage]);

  useEffect(() => {
    if (!token || user?.kyc !== 'BLANK') return;

    const interval = setInterval(() => {
      refreshUser();
    }, 30000);

    return () => clearInterval(interval);
  }, [token, user?.kyc, refreshUser]);

  const closePrompt = () => {
    const now = Date.now();
    setDismissedAt(now);
    setIsOpen(false);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(DISMISS_KEY, String(now));
    }
  };

  const isBlank = user?.kyc === 'BLANK';
  const isPending = user?.kyc === 'PENDING';
  const isRejected = user?.kyc === 'REJECTED';
  const isBlocked = !!user?.isBlocked;
  const rejectionReason = String(user?.kycRejectionReason || '').trim();
  const blockReason = String(user?.blockReason || '').trim();
  const promptTitle = 'Please complete KYC first';
  const promptMessage = 'Your account needs KYC completion before you can continue smoothly.';

  if (!token || (!isBlank && !isPending && !isRejected && !isBlocked)) return null;

  return (
    <>
      {(isBlocked || isRejected) && (
        <div className="bg-red-50 border-b border-red-200">
          <div className="container mx-auto px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-red-800 min-w-0">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <p className="text-sm font-medium">
                {isBlocked
                  ? (blockReason
                    ? `Account blocked: ${blockReason}`
                    : 'Your account is blocked. Please contact support.')
                  : (rejectionReason
                    ? `KYC rejected: ${rejectionReason}`
                    : 'Your KYC was rejected by admin.')}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {isRejected && (
                <Link href="/kyc" className="text-xs font-semibold text-red-900 underline underline-offset-2 whitespace-nowrap">
                  Re-submit KYC
                </Link>
              )}
              <Link href="/support" className="text-xs font-semibold text-red-900 underline underline-offset-2 whitespace-nowrap">
                Customer Support
              </Link>
            </div>
          </div>
        </div>
      )}

      {isPending && (
        <div className="bg-amber-50 border-b border-amber-200">
          <div className="container mx-auto px-4 py-2.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-amber-800 min-w-0">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <p className="text-sm font-medium truncate">
                Please wait for admin approval. Your KYC documents are under review.
              </p>
            </div>
            <Link
              href="/kyc"
              className="text-xs font-semibold text-amber-900 underline underline-offset-2 whitespace-nowrap"
            >
              View status
            </Link>
          </div>
        </div>
      )}

      {isOpen && !isOnKycPage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-amber-200 bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
                  <ShieldAlert className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.24em] text-amber-700">KYC Required</p>
                  <h2 className="mt-1 text-2xl font-black text-slate-950">{promptTitle}</h2>
                </div>
              </div>
              <button
                type="button"
                onClick={closePrompt}
                aria-label="Close popup"
                className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="mt-4 text-sm leading-6 text-slate-600">
              {promptMessage}
            </p>

            <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Please complete KYC before continuing. This reminder will appear again after 1 minute if you close it.
            </div>

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={closePrompt}
                className="flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Close
              </button>
              <Link
                href="/kyc"
                onClick={closePrompt}
                className="flex-1 rounded-2xl bg-slate-950 px-4 py-3 text-center text-sm font-semibold text-white transition hover:bg-slate-900"
              >
                Complete KYC
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
