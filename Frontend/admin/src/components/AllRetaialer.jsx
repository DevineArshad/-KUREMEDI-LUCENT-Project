import React, { useEffect, useState, useMemo } from "react";
import axios from "axios";
import { ChevronLeft, ChevronRight, ShieldBan, ShieldCheck, Trash2 } from "lucide-react";
import { useContextApi } from "../hooks/useContextApi";
import { ADMIN_API_BASE_URL, resolveUploadUrl } from "../lib/baseUrl";


/* ================= BACKEND CONFIG ================= */

const API_BASE = ADMIN_API_BASE_URL;
const fileUrl = (file) => {
  if (!file) return null;
  const normalized = String(file).trim().replace(/^\/+/, "").replace(/\\/g, "/");
  if (/^(https?:|data:|blob:)/i.test(normalized)) {
    return normalized;
  }
  return normalized.startsWith("uploads/")
    ? resolveUploadUrl(normalized)
    : resolveUploadUrl(`uploads/${normalized}`);
};

const updateKYCStatus = async (userId, status, rejectionReason = "") => {
  try {
    const response = await axios.put(`${API_BASE}/auth/kyc-status/${userId}`, {
      status,
      rejectionReason,
    }, { headers: { Authorization: `Bearer ${localStorage.getItem("adminToken")}` } });
    console.log("✅ KYC status updated:", response.data);
    return response.data;
  } catch (error) {
    console.error("❌ Error updating KYC status:", error.response?.data || error);
    throw error;
  }
};

/* ================= MAIN COMPONENT ================= */

export default function AllRetailer() {
  const { getAllUsers, reprocessReferralReward, deleteUser, blockUser, getDeletedUsersHistory } = useContextApi();
  const [reprocessing, setReprocessing] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState(null);
  const [deleteHistory, setDeleteHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const [accountFilter, setAccountFilter] = useState("All");

  const [selectedRetailer, setSelectedRetailer] = useState(null);
  const [updatedStatus, setUpdatedStatus] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const refreshRetailers = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await getAllUsers();
      const allUsers = res?.users || res || [];
      const retailersOnly = allUsers.filter((u) => {
        const role = String(u?.role || "").toLowerCase();
        return !role || role === "user" || role === "vendor" || role === "retailer";
      });
      setUsers(retailersOnly);
      const historyRes = await getDeletedUsersHistory(20);
      setDeleteHistory(historyRes?.history || []);
    } catch (err) {
      console.log("Error:", err);
      setLoadError(err?.response?.data?.message || err?.message || "Failed to load retailers");
    } finally {
      setLoading(false);
    }
  };

  /* ================= FETCH USERS ================= */

  useEffect(() => {
    refreshRetailers();
  }, [getAllUsers, getDeletedUsersHistory]);

  useEffect(() => {
    const handleFocus = () => {
      refreshRetailers();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshRetailers();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [getAllUsers, getDeletedUsersHistory]);

  useEffect(() => () => { }, []);

  /* ================= FILTER & PAGINATION ================= */

  const filtered = useMemo(() =>
    users.filter((r) => {
      const email = r?.email || "";
      const phone = r?.phone || "";
      const matchSearch = email.toLowerCase().includes(search.toLowerCase()) || phone.includes(search);
      const matchKyc = filter === "All" ? true : r.kyc === filter;
      const matchAccount =
        accountFilter === "All"
          ? true
          : accountFilter === "Blocked"
            ? !!r.isBlocked
            : !r.isBlocked;
      return matchSearch && matchKyc && matchAccount;
    }),
    [users, search, filter, accountFilter]
  );

  useEffect(() => setCurrentPage(1), [search, filter, accountFilter]);

  const totalPages = Math.ceil(filtered.length / itemsPerPage) || 1;
  const paginatedRetailers = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filtered.slice(start, start + itemsPerPage);
  }, [filtered, currentPage]);

  const goToPage = (n) => {
    setCurrentPage(Math.max(1, Math.min(n, totalPages)));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  /* ================= UPDATE STATUS ================= */
  const handleSubmit = async () => {
    try {
      if (updatedStatus === "REJECTED" && !String(rejectionReason || "").trim()) {
        alert("Please add a reason before rejecting KYC.");
        return;
      }
      // 🔥 Call backend API
      await updateKYCStatus(selectedRetailer._id, updatedStatus, rejectionReason);

      // 🔄 Update UI after success
      const updatedUsers = users.map((u) =>
        u._id === selectedRetailer._id
          ? { ...u, kyc: updatedStatus, kycRejectionReason: updatedStatus === "REJECTED" ? String(rejectionReason || "").trim() : "" }
          : u
      );

      setUsers(updatedUsers);
      setSelectedRetailer(null);
      alert("✅ KYC Status Updated Successfully!");
    } catch (error) {
      alert("❌ Failed to update KYC status", error);
    }
  };

  const handleToggleBlock = async (userId, isBlocked) => {
    try {
      let reason = "";
      if (isBlocked) {
        reason = window.prompt("Enter reason for blocking this user:", "") || "";
        if (!String(reason).trim()) {
          alert("Blocking reason is required.");
          return;
        }
      }
      setActionLoadingId(userId);
      await blockUser(userId, isBlocked, reason);
      setUsers((prev) => prev.map((u) => (u._id === userId ? { ...u, isBlocked, blockReason: isBlocked ? String(reason).trim() : "" } : u)));
      setSelectedRetailer((prev) => (prev && prev._id === userId ? { ...prev, isBlocked, blockReason: isBlocked ? String(reason).trim() : "" } : prev));
    } catch (error) {
      alert(error?.response?.data?.message || "Failed to update account status");
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleDeleteRetailer = async (userId) => {
    if (!window.confirm("Delete this retailer permanently?")) return;
    try {
      setActionLoadingId(userId);
      await deleteUser(userId);
      setUsers((prev) => prev.filter((u) => u._id !== userId));
      if (selectedRetailer?._id === userId) setSelectedRetailer(null);
      const historyRes = await getDeletedUsersHistory(20);
      setDeleteHistory(historyRes?.history || []);
    } catch (error) {
      alert(error?.response?.data?.message || "Failed to delete retailer");
    } finally {
      setActionLoadingId(null);
    }
  };

  /* ================= UI ================= */

  return (
    <div className="w-full p-4 md:p-6 bg-gray-100 min-h-screen">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">
          Retailer Management
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          Verify and manage retailers
        </p>
        <button
          type="button"
          onClick={refreshRetailers}
          className="mt-3 inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
        >
          Refresh list
        </button>
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search by email or phone"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="px-4 py-2 border rounded-lg w-full md:w-1/3 mb-4"
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-5">
        {["All", "APPROVED", "PENDING", "REJECTED", "BLANK"].map((item) => (
          <button
            key={item}
            onClick={() => setFilter(item)}
            className={`px-4 py-1.5 rounded-full text-sm ${filter === item
              ? "bg-blue-600 text-white"
              : "bg-white border"
              }`}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 mb-5">
        {["All", "Active", "Blocked"].map((item) => (
          <button
            key={item}
            onClick={() => setAccountFilter(item)}
            className={`px-4 py-1.5 rounded-full text-sm ${accountFilter === item
              ? "bg-slate-900 text-white"
              : "bg-white border"
              }`}
          >
            {item}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-md overflow-x-auto">
        {loadError && (
          <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {loadError}
          </div>
        )}

        {loading && (
          <div className="px-4 py-6 text-center text-sm text-gray-500">
            Loading retailers...
          </div>
        )}

        <table className="w-full text-sm min-w-[800px] border-collapse">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-3 text-left w-14">S.No</th>
              <th className="p-3 text-left">Name</th>
              <th className="p-3 text-left">Email</th>
              <th className="p-3 text-left">Phone</th>
              <th className="p-3 text-left">KYC</th>
              <th className="p-3 text-left">Account</th>
              <th className="p-3 text-left">Referral</th>
              <th className="p-3 text-center">Action</th>
            </tr>
          </thead>

          <tbody>
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan="8" className="p-5 text-center text-gray-500">No retailers found</td>
              </tr>
            )}
            {!loading && paginatedRetailers.map((r, idx) => (
              <tr key={r._id} className="border-t border-gray-200 hover:bg-blue-50">
                <td className="p-3 text-gray-500 font-medium">
                  {(currentPage - 1) * itemsPerPage + idx + 1}
                </td>
                <td className="p-3">{r.name || "—"}</td>
                <td className="p-3">{r.email || "—"}</td>
                <td className="p-3">{r.phone || "—"}</td>
                <td className="p-3">
                  <StatusBadge status={r.kyc} />
                </td>
                <td className="p-3">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${r.isBlocked ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
                    {r.isBlocked ? "Blocked" : "Active"}
                  </span>
                </td>
                <td className="p-3">
                  {r.referredBy ? (
                    r.referralBonusCredited ? (
                      <span className="text-green-600 text-xs font-medium">Credited</span>
                    ) : (
                      <span className="text-amber-600 text-xs font-medium">Not credited</span>
                    )
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="p-3 text-center">
                  <div className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 p-1">
                    <button
                      onClick={() => {
                        setSelectedRetailer(r);
                        setUpdatedStatus(r.kyc);
                        setRejectionReason(r.kycRejectionReason || "");
                      }}
                      className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                    >
                      View
                    </button>
                    <button
                      onClick={() => handleToggleBlock(r._id, !r.isBlocked)}
                      disabled={actionLoadingId === r._id}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border disabled:opacity-50 ${
                        r.isBlocked
                          ? "bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
                          : "bg-red-50 text-red-700 border-red-200 hover:bg-red-100"
                      }`}
                    >
                      {r.isBlocked ? <ShieldCheck size={14} /> : <ShieldBan size={14} />}
                      {r.isBlocked ? "Unblock" : "Block"}
                    </button>
                    <button
                      onClick={() => handleDeleteRetailer(r._id)}
                      disabled={actionLoadingId === r._id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-black disabled:opacity-50"
                    >
                      <Trash2 size={14} />
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 px-4 py-3 border-t flex flex-col md:flex-row justify-between items-center gap-4 bg-gray-50 rounded-lg">
          <p className="text-sm text-gray-600">
            Showing <span className="font-semibold">{(currentPage - 1) * itemsPerPage + 1}</span> to{" "}
            <span className="font-semibold">{Math.min(currentPage * itemsPerPage, filtered.length)}</span> of{" "}
            <span className="font-semibold">{filtered.length}</span> retailers
          </p>
          <div className="flex items-center gap-2">
            <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 1} className="p-2 border rounded-md bg-white hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed">
              <ChevronLeft size={18} />
            </button>
            <div className="flex gap-1">
              {[...Array(totalPages)].map((_, i) => {
                const p = i + 1;
                if (p === 1 || p === totalPages || (p >= currentPage - 1 && p <= currentPage + 1)) {
                  return <button key={p} onClick={() => goToPage(p)} className={`px-3.5 py-1.5 rounded-md text-sm font-medium ${currentPage === p ? "bg-blue-600 text-white" : "bg-white border hover:bg-gray-100"}`}>{p}</button>;
                }
                if (p === currentPage - 2 || p === currentPage + 2) return <span key={p} className="px-1 text-gray-400">...</span>;
                return null;
              })}
            </div>
            <button onClick={() => goToPage(currentPage + 1)} disabled={currentPage === totalPages} className="p-2 border rounded-md bg-white hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed">
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      )}

      {/* Deleted users history */}
      <div className="mt-8 bg-white rounded-xl shadow-md overflow-x-auto">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-800">Deleted User History</h2>
          <p className="text-gray-500 text-sm mt-0.5">Latest {deleteHistory.length} deleted users</p>
        </div>
        <table className="w-full text-sm min-w-[760px] border-collapse">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-3 text-left">Name</th>
              <th className="p-3 text-left">Email</th>
              <th className="p-3 text-left">Phone</th>
              <th className="p-3 text-left">Role</th>
              <th className="p-3 text-left">Deleted By</th>
              <th className="p-3 text-left">Deleted At</th>
            </tr>
          </thead>
          <tbody>
            {deleteHistory.length === 0 && (
              <tr>
                <td colSpan="6" className="p-5 text-center text-gray-500">No delete history found</td>
              </tr>
            )}
            {deleteHistory.map((item) => (
              <tr key={item._id} className="border-t border-gray-200">
                <td className="p-3">{item.name || "—"}</td>
                <td className="p-3">{item.email || "—"}</td>
                <td className="p-3">{item.phone || "—"}</td>
                <td className="p-3">{item.role || "—"}</td>
                <td className="p-3">{item.deletedByEmail || "—"}</td>
                <td className="p-3">{item.deletedAt ? new Date(item.deletedAt).toLocaleString("en-IN") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ================= MODAL ================= */}

      {selectedRetailer && (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50 px-3">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-xl overflow-hidden">

            {/* Header */}
            <div className="flex justify-between px-6 py-4 border-b bg-gray-50">
              <h2 className="font-semibold text-lg">Retailer Details</h2>
              <button
                onClick={() => setSelectedRetailer(null)}
                className="text-xl"
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">

              <Info label="Name" value={selectedRetailer.name} />
              <Info label="Email" value={selectedRetailer.email} />
              <Info label="Phone" value={selectedRetailer.phone} />

              {/* Referral: show referrer and whether wallet was credited */}
              <div className="border p-3 rounded bg-white">
                <b>Referral:</b>{" "}
                {selectedRetailer.referredBy
                  ? `${selectedRetailer.referredBy.name || "—"} (${selectedRetailer.referredBy.referralCode || "—"})`
                  : "Not referred"}
                {selectedRetailer.referredBy && (
                  <span className="ml-2 text-sm">
                    {selectedRetailer.referralBonusCredited ? (
                      <span className="text-green-600">• Credited to referrer wallet</span>
                    ) : (
                      <span className="text-amber-600">• Not yet credited</span>
                    )}
                  </span>
                )}
              </div>

              <h3 className="font-semibold text-gray-800 pt-2">Retailer documents</h3>
              <Info label="Drug License No" value={selectedRetailer.drugLicenseNumber} />
              <DocumentRow label="Drug License Doc" number="" file={fileUrl(selectedRetailer.drugLicenseDoc)} />

              <Info label="GST No" value={selectedRetailer.gstNumber} />
              <DocumentRow label="GST Doc" number="" file={fileUrl(selectedRetailer.gstDoc)} />

              <DocumentRow label="Shop Photo" number="" file={fileUrl(selectedRetailer.shopImage)} />

              <h3 className="font-semibold text-gray-800 pt-2">Bank details</h3>
              <Info label="Bank Name" value={selectedRetailer.bankName} />
              <Info label="Account Holder" value={selectedRetailer.accountHolderName} />
              <Info label="Account Number" value={selectedRetailer.accountNumber} />
              <Info label="IFSC Code" value={selectedRetailer.ifscCode} />
              <DocumentRow label="Cancel Cheque / Passbook" number="" file={fileUrl(selectedRetailer.cancelChequeDoc)} />

              {(selectedRetailer.aadharNumber || selectedRetailer.aadharDoc || selectedRetailer.panNumber || selectedRetailer.panDoc) && (
                <>
                  <h3 className="font-semibold text-gray-800 pt-2">Identity (if submitted)</h3>
                  <DocumentRow label="Aadhar No" number={selectedRetailer.aadharNumber} file={fileUrl(selectedRetailer.aadharDoc)} />
                  <DocumentRow label="PAN No" number={selectedRetailer.panNumber} file={fileUrl(selectedRetailer.panDoc)} />
                </>
              )}

              {/* Status */}
              <select
                value={updatedStatus}
                onChange={(e) => setUpdatedStatus(e.target.value)}
                className="border w-full px-3 py-2 rounded"
              >
                <option value="APPROVED">APPROVED</option>
                <option value="PENDING">PENDING</option>
                <option value="REJECTED">REJECTED</option>
                <option value="BLANK">BLANK</option>
              </select>

              {updatedStatus === "REJECTED" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Rejection Reason *</label>
                  <textarea
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    rows={3}
                    placeholder="Type why KYC was rejected"
                    className="w-full border rounded px-3 py-2"
                  />
                </div>
              )}

              {selectedRetailer.isBlocked && (
                <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  <b>Block Reason:</b> {selectedRetailer.blockReason || "No reason provided"}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex flex-wrap justify-end gap-3 px-6 py-4 border-t bg-gray-50">
              {selectedRetailer.kyc === "APPROVED" &&
                selectedRetailer.referredBy &&
                !selectedRetailer.referralBonusCredited && (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        setReprocessing(true);
                        await reprocessReferralReward(selectedRetailer._id);
                        const updatedUsers = users.map((u) =>
                          u._id === selectedRetailer._id
                            ? { ...u, referralBonusCredited: true }
                            : u
                        );
                        setUsers(updatedUsers);
                        setSelectedRetailer((prev) => (prev ? { ...prev, referralBonusCredited: true } : null));
                        alert("Referral reward credited. MR wallet updated.");
                      } catch {
                        alert("Failed to credit referrer. Check console.");
                      } finally {
                        setReprocessing(false);
                      }
                    }}
                    disabled={reprocessing}
                    className="px-4 py-2 bg-emerald-600 text-white rounded disabled:opacity-50"
                  >
                    {reprocessing ? "..." : "Credit referrer (MR)"}
                  </button>
                )}
              <button
                onClick={() => setSelectedRetailer(null)}
                className="px-4 py-2 border rounded"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                className="px-4 py-2 bg-blue-600 text-white rounded"
              >
                Save
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}

/* ================= SUB COMPONENTS ================= */

function StatusBadge({ status }) {
  const map = {
    APPROVED: "bg-green-100 text-green-700",
    PENDING: "bg-amber-100 text-amber-700",
    REJECTED: "bg-red-100 text-red-700",
    BLANK: "bg-gray-100 text-gray-600",
  };
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${map[status] ?? "bg-gray-100 text-gray-600"}`}>
      {status || "—"}
    </span>
  );
}

function Info({ label, value }) {
  return (
    <div className="border p-2 rounded bg-white">
      <b>{label}:</b> {value || "N/A"}
    </div>
  );
}

function DocumentRow({ label, number, file }) {
  return (
    <div className="border p-3 rounded bg-white flex flex-wrap justify-between items-center gap-2">
      <span>
        <b>{label}:</b> {number || "—"}
      </span>
      {file ? (
        <span className="flex items-center gap-3">
          <a href={file} target="_blank" rel="noopener noreferrer" className="text-blue-600 text-sm font-medium">
            View
          </a>
          <a href={file} download target="_blank" rel="noopener noreferrer" className="text-blue-600 text-sm font-medium">
            Download
          </a>
        </span>
      ) : (
        <span className="text-gray-400 text-sm">Not uploaded</span>
      )}
    </div>
  );
}  