'use client';

import React, { useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ShieldCheck, ShieldAlert } from 'lucide-react';
import { useAppContext } from '@/context/context';
import * as api from '@/api';
import { showToast } from '@/utils/toast';

const GST_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_NUMBER_REGEX = /^[0-9]{9,18}$/;
const IMAGE_COMPRESS_THRESHOLD_BYTES = 700 * 1024;
const IMAGE_MAX_DIMENSION = 1600;
const IMAGE_COMPRESS_QUALITY = 0.8;

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

async function maybeCompressImageFile(file) {
  if (!file || !String(file.type || '').startsWith('image/')) return file;
  if (file.size <= IMAGE_COMPRESS_THRESHOLD_BYTES) return file;

  try {
    const dataUrl = await readFileAsDataURL(file);
    const image = await loadImage(dataUrl);

    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!width || !height) return file;

    const scale = Math.min(1, IMAGE_MAX_DIMENSION / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

    const blob = await canvasToBlob(canvas, 'image/jpeg', IMAGE_COMPRESS_QUALITY);
    if (!blob || blob.size >= file.size) return file;

    const baseName = String(file.name || 'upload').replace(/\.[^.]+$/, '');
    return new File([blob], `${baseName}.jpg`, {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
}

// Wrap useSearchParams usage in Suspense so Next.js prerender/export is happy
export default function KycPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-gray-500">Loading KYC...</div>}>
      <KycPageInner />
    </Suspense>
  );
}

function KycPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect');
  const { user, token, refreshUser } = useAppContext();

  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});

  // Text Fields State
  const [drugLicenseNumber, setDrugLicenseNumber] = useState('');
  const [gstNumber, setGstNumber] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountHolderName, setAccountHolderName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [ifscCode, setIfscCode] = useState('');

  // File Fields State
  const [drugLicenseFile, setDrugLicenseFile] = useState(null);
  const [gstFile, setGstFile] = useState(null);
  const [shopPhotoFile, setShopPhotoFile] = useState(null);
  const [cancelChequeFile, setCancelChequeFile] = useState(null);
  const isKycPending = user?.kyc === 'PENDING';

  // Authentication Check
  if (!token || !user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-gray-500 mb-4">Please login to access KYC</p>
          <Link href="/login" className="inline-block bg-teal-700 text-white px-6 py-3 rounded-xl font-semibold hover:bg-teal-800">
            Login
          </Link>
        </div>
      </div>
    );
  }

  // Already Approved Check
  if (user.kyc === 'APPROVED') {
    return (
      <div className="min-h-screen bg-gray-50 px-4 pt-8 pb-12">
        <Link href="/profile" className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6">
          <ArrowLeft className="w-5 h-5" />
          Back
        </Link>
        <div className="flex flex-col items-center justify-center min-h-[60vh]">
          <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mb-4">
            <ShieldCheck className="w-10 h-10 text-emerald-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900">KYC Approved</h2>
          <p className="text-gray-500 mt-2 text-center">Your KYC verification is complete.</p>
        </div>
      </div>
    );
  }

  // Pending Check - block page with fixed popup until admin decision
  if (user.kyc === 'PENDING') {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="sticky top-0 bg-white border-b border-gray-200 z-10">
          <div className="container mx-auto px-4 py-3 flex items-center gap-4">
            <Link href="/profile" className="p-1 -ml-1 text-gray-700 hover:text-gray-900">
              <ArrowLeft className="w-7 h-7" />
            </Link>
            <h1 className="text-lg font-semibold text-gray-900">KYC Verification</h1>
          </div>
        </div>

        <div className="mx-auto max-w-xl px-4 pt-5">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 shadow-sm">
            <p className="text-sm font-semibold text-amber-900">Documents submitted successfully</p>
            <p className="mt-1 text-sm text-amber-800">Please wait for admin approval. Your KYC form is locked until the review is completed.</p>
          </div>
        </div>

        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center px-4">
          <div className="w-full max-w-lg rounded-2xl border border-amber-200 bg-white p-6 shadow-2xl">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100">
              <ShieldAlert className="h-7 w-7 text-amber-700" />
            </div>
            <h2 className="text-center text-2xl font-bold text-gray-900">KYC Submitted</h2>
            <p className="mt-3 text-center text-sm text-gray-600 leading-relaxed">
              Your documents are under admin review. KYC form is locked right now.
              You can submit again only if admin rejects your request.
            </p>

            <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-center text-sm font-medium text-amber-800">
                Please wait for admin approval.
              </p>
            </div>

            <div className="mt-6 flex gap-3">
              <Link
                href="/"
                className="flex-1 rounded-xl border border-gray-300 px-4 py-3 text-center text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Go to Home
              </Link>
              <Link
                href="/profile"
                className="flex-1 rounded-xl bg-teal-700 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-teal-800"
              >
                Go to Profile
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isKycPending) {
      showToast('KYC already submitted. Please wait for admin approval.', 'info');
      return;
    }
    const err = {};
    if (!drugLicenseNumber.trim()) err.drugLicenseNumber = 'Drug license number is required';
    if (!drugLicenseFile) err.drugLicenseFile = 'Upload drug license document (required)';
    if (!bankName.trim()) err.bankName = 'Bank name is required';
    if (!accountHolderName.trim()) err.accountHolderName = 'Account holder name is required';
    if (!accountNumber.trim()) err.accountNumber = 'Account number is required';
    if (!ifscCode.trim()) err.ifscCode = 'IFSC code is required';
    if (accountNumber.trim() && !ACCOUNT_NUMBER_REGEX.test(accountNumber.trim())) {
      err.accountNumber = 'Account number must be 9-18 digits';
    }
    if (ifscCode.trim() && !IFSC_REGEX.test(ifscCode.trim().toUpperCase())) {
      err.ifscCode = 'Enter a valid IFSC code (example: SBIN0001234)';
    }
    if (gstNumber.trim() && !GST_REGEX.test(gstNumber.trim().toUpperCase())) {
      err.gstNumber = 'Enter a valid GST number (15 characters)';
    }
    if (gstFile && !gstNumber.trim()) {
      err.gstNumber = 'GST number is required when GST certificate is uploaded';
    }
    if (!cancelChequeFile) err.cancelChequeFile = 'Cancel cheque / passbook document is required';
    if (Object.keys(err).length) {
      setErrors(err);
      return;
    }
    setErrors({});
    try {
      setLoading(true);
      const formData = new FormData();

      const [optimizedDrugLicenseFile, optimizedGstFile, optimizedShopPhotoFile, optimizedCancelChequeFile] = await Promise.all([
        maybeCompressImageFile(drugLicenseFile),
        maybeCompressImageFile(gstFile),
        maybeCompressImageFile(shopPhotoFile),
        maybeCompressImageFile(cancelChequeFile),
      ]);

      // Append Text Data
      formData.append('drugLicenseNumber', drugLicenseNumber.trim());
      formData.append('gstNumber', gstNumber.trim().toUpperCase());
      formData.append('bankName', bankName.trim());
      formData.append('accountHolderName', accountHolderName.trim());
      formData.append('accountNumber', accountNumber.trim());
      formData.append('ifscCode', ifscCode.trim());

      // Append Files – field names must match backend
      if (optimizedDrugLicenseFile) formData.append('drugLicenseDoc', optimizedDrugLicenseFile);
      if (optimizedGstFile) formData.append('gstDoc', optimizedGstFile);
      if (optimizedShopPhotoFile) formData.append('shopImage', optimizedShopPhotoFile);
      if (optimizedCancelChequeFile) formData.append('cancelChequeDoc', optimizedCancelChequeFile);

      await api.submitKyc(formData);
      await refreshUser();

      showToast('KYC submitted successfully. Status: Pending.', "success");

      if (redirect === 'checkout') {
        router.push('/checkout');
      } else {
        router.push('/');
      }
    } catch (err) {
      const rawMsg = String(
        err?.data?.message
        || err?.response?.data?.message
        || err?.message
        || ''
      ).trim();
      const isNetworkError = /failed to fetch|network ?error|network request failed|load failed/i.test(rawMsg);
      const isTimeoutError = /abort|timed out|timeout/i.test(rawMsg);

      const msg = (err?.status === 413
        ? 'KYC files are too large. Please upload smaller/compressed files and try again.'
        : null)
        || (isTimeoutError
          ? 'Upload timed out. Please use smaller files and try again.'
          : null)
        || (isNetworkError
          ? 'Unable to connect to the server. Please check your internet connection and try again.'
          : null)
        || rawMsg
        || 'Failed to submit KYC';
      showToast(msg, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="sticky top-0 bg-white border-b border-gray-200 z-10">
        <div className="container mx-auto px-4 py-3 flex items-center gap-4">
          <Link href="/profile" className="p-1 -ml-1 text-gray-700 hover:text-gray-900">
            <ArrowLeft className="w-7 h-7" />
          </Link>
          <h1 className="text-lg font-semibold text-gray-900">KYC Verification</h1>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="max-w-xl mx-auto px-4 py-6">
        <p className="text-gray-600 text-sm mb-6">
          Retailer KYC: drug license, GST, shop photo and bank details with cancel cheque. Ensure documents are clear.
        </p>

        <div className="space-y-6 mb-6">

          {/* Drug License Section */}
          <div className="bg-white rounded-2xl p-4 border border-gray-200 shadow-sm">
            <label className="block text-sm font-medium text-gray-700 mb-2">Drug License Number <span className="text-red-500">*</span></label>
            <input
              type="text"
              placeholder="Enter drug license number"
              value={drugLicenseNumber}
              onChange={(e) => { setDrugLicenseNumber(e.target.value); setErrors((p) => ({ ...p, drugLicenseNumber: '' })); }}
              className={`w-full bg-gray-50 border rounded-xl px-4 py-3 text-base outline-none focus:ring-2 focus:ring-teal-700 focus:border-transparent transition-all ${errors.drugLicenseNumber ? 'border-red-500' : 'border-gray-200'}`}
            />
            {errors.drugLicenseNumber && <p className="text-red-500 text-sm mt-1">{errors.drugLicenseNumber}</p>}

            <div className="mt-4 pt-4 border-t border-gray-100">
              <label className="block text-sm font-medium text-gray-700 mb-2">Upload Drug License <span className="text-red-500">*</span></label>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={(e) => { setDrugLicenseFile(e.target.files[0]); setErrors((p) => ({ ...p, drugLicenseFile: '' })); }}
                className={"w-full text-sm text-gray-500 file:mr-4 file:py-2.5 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-teal-50 file:text-teal-700 hover:file:bg-teal-100 cursor-pointer " + (errors.drugLicenseFile ? "ring-2 ring-red-500 rounded-lg border-red-500" : "")}
              />
              {errors.drugLicenseFile && <p className="text-red-500 text-sm mt-1">{errors.drugLicenseFile}</p>}
            </div>
          </div>

          {/* GST Section */}
          <div className="bg-white rounded-2xl p-4 border border-gray-200 shadow-sm">
            <label className="block text-sm font-medium text-gray-700 mb-2">GST Number</label>
            <input
              type="text"
              placeholder="Enter GST number"
              value={gstNumber}
              onChange={(e) => { setGstNumber(e.target.value.toUpperCase()); setErrors((p) => ({ ...p, gstNumber: '' })); }}
              className={`w-full bg-gray-50 border rounded-xl px-4 py-3 text-base outline-none focus:ring-2 focus:ring-teal-700 focus:border-transparent transition-all uppercase ${errors.gstNumber ? 'border-red-500' : 'border-gray-200'}`}
            />
            {errors.gstNumber && <p className="text-red-500 text-sm mt-1">{errors.gstNumber}</p>}

            <div className="mt-4 pt-4 border-t border-gray-100">
              <label className="block text-sm font-medium text-gray-700 mb-2">Upload GST Certificate</label>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={(e) => setGstFile(e.target.files[0])}
                className="w-full text-sm text-gray-500
                  file:mr-4 file:py-2.5 file:px-4
                  file:rounded-full file:border-0
                  file:text-sm file:font-semibold
                  file:bg-teal-50 file:text-teal-700
                  hover:file:bg-teal-100 cursor-pointer"
              />
            </div>
          </div>

          {/* Shop Photo Section */}
          <div className="bg-white rounded-2xl p-4 border border-gray-200 shadow-sm">
            <label className="block text-sm font-medium text-gray-700 mb-2">Upload Shop Photo</label>
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={(e) => setShopPhotoFile(e.target.files[0])}
              className="w-full text-sm text-gray-500
                  file:mr-4 file:py-2.5 file:px-4
                  file:rounded-full file:border-0
                  file:text-sm file:font-semibold
                  file:bg-teal-50 file:text-teal-700
                  hover:file:bg-teal-100 cursor-pointer"
            />
          </div>

          {/* Bank Details */}
          <div className="bg-white rounded-2xl p-4 border border-gray-200 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">Bank Details</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Bank Name <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  placeholder="e.g. SBI, HDFC"
                  value={bankName}
                  onChange={(e) => { setBankName(e.target.value); setErrors((p) => ({ ...p, bankName: '' })); }}
                  className={`w-full bg-gray-50 border rounded-xl px-4 py-3 text-base outline-none focus:ring-2 focus:ring-teal-700 focus:border-transparent ${errors.bankName ? 'border-red-500' : 'border-gray-200'}`}
                />
                {errors.bankName && <p className="text-red-500 text-sm mt-1">{errors.bankName}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Account Holder Name <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  placeholder="As per bank account"
                  value={accountHolderName}
                  onChange={(e) => { setAccountHolderName(e.target.value); setErrors((p) => ({ ...p, accountHolderName: '' })); }}
                  className={`w-full bg-gray-50 border rounded-xl px-4 py-3 text-base outline-none focus:ring-2 focus:ring-teal-700 focus:border-transparent ${errors.accountHolderName ? 'border-red-500' : 'border-gray-200'}`}
                />
                {errors.accountHolderName && <p className="text-red-500 text-sm mt-1">{errors.accountHolderName}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Account Number <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  placeholder="Bank account number"
                  value={accountNumber}
                  onChange={(e) => { setAccountNumber(e.target.value); setErrors((p) => ({ ...p, accountNumber: '' })); }}
                  className={`w-full bg-gray-50 border rounded-xl px-4 py-3 text-base outline-none focus:ring-2 focus:ring-teal-700 focus:border-transparent ${errors.accountNumber ? 'border-red-500' : 'border-gray-200'}`}
                />
                {errors.accountNumber && <p className="text-red-500 text-sm mt-1">{errors.accountNumber}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">IFSC Code <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  placeholder="e.g. SBIN0001234"
                  value={ifscCode}
                  onChange={(e) => { setIfscCode(e.target.value.toUpperCase()); setErrors((p) => ({ ...p, ifscCode: '' })); }}
                  className={`w-full bg-gray-50 border rounded-xl px-4 py-3 text-base outline-none focus:ring-2 focus:ring-teal-700 focus:border-transparent uppercase ${errors.ifscCode ? 'border-red-500' : 'border-gray-200'}`}
                />
                {errors.ifscCode && <p className="text-red-500 text-sm mt-1">{errors.ifscCode}</p>}
              </div>
              <div className="pt-3 border-t border-gray-100">
                <label className="block text-sm font-medium text-gray-700 mb-2">Cancel Cheque / Passbook <span className="text-red-500">*</span></label>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={(e) => { setCancelChequeFile(e.target.files[0]); setErrors((p) => ({ ...p, cancelChequeFile: '' })); }}
                  className="w-full text-sm text-gray-500
                    file:mr-4 file:py-2.5 file:px-4
                    file:rounded-full file:border-0
                    file:text-sm file:font-semibold
                    file:bg-teal-50 file:text-teal-700
                    hover:file:bg-teal-100 cursor-pointer"
                />
                {errors.cancelChequeFile && <p className="text-red-500 text-sm mt-1">{errors.cancelChequeFile}</p>}
              </div>
            </div>
          </div>

        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-teal-700 hover:bg-teal-800 text-white font-bold py-4 rounded-xl transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
        >
          {loading ? 'Submitting...' : 'Submit KYC'}
        </button>
      </form>
    </div>
  );
}
