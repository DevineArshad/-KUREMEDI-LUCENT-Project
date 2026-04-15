import React, { useEffect, useMemo, useState } from "react";
import { ExternalLink, Eye, RefreshCcw, Trash2 } from "lucide-react";
import { useContextApi } from "../hooks/useContextApi";

const STATUS_BADGE_CLASSES = {
  APPROVED: "bg-emerald-100 text-emerald-700 border-emerald-200",
  PENDING: "bg-amber-100 text-amber-700 border-amber-200",
  REJECTED: "bg-rose-100 text-rose-700 border-rose-200",
  BLANK: "bg-slate-100 text-slate-700 border-slate-200",
};

const KYC_DOC_FIELDS = [
  { key: "aadharDoc", label: "Aadhar" },
  { key: "drugLicenseDoc", label: "Drug License" },
  { key: "gstDoc", label: "GST" },
  { key: "panDoc", label: "PAN" },
  { key: "shopImage", label: "Shop Photo" },
  { key: "cancelChequeDoc", label: "Cancel Cheque" },
];

const formatDateTime = (value) => {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "-";
  return dt.toLocaleString();
};

const normalizeDocUrl = (url) => {
  const raw = String(url || "").trim();
  if (!raw) return "";
  if (/^(https?:|blob:|data:)/i.test(raw)) return raw;
  const normalized = raw.replace(/\\/g, "/").replace(/^\/+/, "");
  const base = "https://backend.kuremedi.com";
  return normalized.startsWith("uploads/") ? `${base}/${normalized}` : `${base}/uploads/${normalized}`;
};

function KycHistory() {
  const { getKycHistory, deleteAllKycDocuments } = useContextApi();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [deletingUserId, setDeletingUserId] = useState("");
  const [selectedDoc, setSelectedDoc] = useState(null);

  const loadHistory = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await getKycHistory();
      setUsers(Array.isArray(response?.users) ? response.users : []);
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || "Failed to load KYC history");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const filteredUsers = useMemo(() => {
    const query = String(search || "").trim().toLowerCase();
    return users.filter((user) => {
      const matchesStatus = statusFilter === "ALL" || String(user?.currentStatus || "").toUpperCase() === statusFilter;
      if (!matchesStatus) return false;
      if (!query) return true;
      const bucket = [user?.name, user?.email, user?.phone].map((v) => String(v || "").toLowerCase()).join(" ");
      return bucket.includes(query);
    });
  }, [users, search, statusFilter]);

  const handleDeleteAllDocs = async (userId, displayName) => {
    const ok = window.confirm(`Delete all KYC documents for ${displayName || "this user"}? This cannot be undone.`);
    if (!ok) return;

    setDeletingUserId(userId);
    try {
      await deleteAllKycDocuments(userId);
      await loadHistory();
    } catch (err) {
      window.alert(err?.response?.data?.message || err?.message || "Failed to delete KYC documents");
    } finally {
      setDeletingUserId("");
    }
  };

  return (
    <div className="w-full p-4 md:p-6 bg-gray-100 min-h-screen">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">KYC History</h1>
          <p className="text-sm text-gray-500 mt-1">
            Track past KYC status updates and access retailer Cloudinary documents.
          </p>
        </div>

        <button
          type="button"
          onClick={loadHistory}
          className="inline-flex items-center gap-2 bg-white border border-gray-200 text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-50"
        >
          <RefreshCcw size={16} />
          Refresh
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <input
          type="text"
          placeholder="Search by name, email, phone"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="ALL">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="REJECTED">Rejected</option>
          <option value="APPROVED">Approved</option>
          <option value="BLANK">Blank</option>
        </select>

        <div className="text-sm text-gray-600 flex items-center">Users: {filteredUsers.length}</div>
      </div>

      {loading ? (
        <div className="bg-white border border-gray-200 rounded-xl p-6 text-gray-600">Loading KYC history...</div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-red-700">{error}</div>
      ) : filteredUsers.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-6 text-gray-600">No KYC history found.</div>
      ) : (
        <div className="space-y-4">
          {filteredUsers.map((user) => {
            const status = String(user?.currentStatus || "BLANK").toUpperCase();
            const badgeClass = STATUS_BADGE_CLASSES[status] || STATUS_BADGE_CLASSES.BLANK;
            const docs = user?.documents || {};
            const history = Array.isArray(user?.history) ? user.history : [];

            return (
              <div key={user._id} className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
                  <div>
                    <div className="font-semibold text-gray-800">{user?.name || "Unnamed User"}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {user?.email || "No email"} | {user?.phone || "No phone"}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`px-2.5 py-1 rounded-full border text-xs font-semibold ${badgeClass}`}>
                      {status}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDeleteAllDocs(user._id, user?.name)}
                      disabled={deletingUserId === user._id}
                      className="inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-md border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      <Trash2 size={14} />
                      {deletingUserId === user._id ? "Deleting..." : "Delete All Documents"}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="border border-gray-200 rounded-lg p-3">
                    <h3 className="text-sm font-semibold text-gray-800 mb-3">Current Documents</h3>
                    <div className="space-y-2">
                      {KYC_DOC_FIELDS.map((doc) => {
                        const url = normalizeDocUrl(docs?.[doc.key]);
                        return (
                          <div key={doc.key} className="flex items-center justify-between gap-3 border border-gray-100 rounded-md p-2">
                            <span className="text-sm text-gray-700">{doc.label}</span>
                            {url ? (
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setSelectedDoc({ label: doc.label, url })}
                                  className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 text-xs"
                                >
                                  <Eye size={13} />
                                  View
                                </button>
                                <a
                                  href={url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-800 text-xs"
                                >
                                  <ExternalLink size={13} />
                                  Cloudinary
                                </a>
                              </div>
                            ) : (
                              <span className="text-xs text-gray-400">No document</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="border border-gray-200 rounded-lg p-3">
                    <h3 className="text-sm font-semibold text-gray-800 mb-3">Status Timeline</h3>
                    {history.length === 0 ? (
                      <div className="text-sm text-gray-500">No history entries yet.</div>
                    ) : (
                      <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                        {history.map((entry, index) => {
                          const entryStatus = String(entry?.status || "BLANK").toUpperCase();
                          const entryBadgeClass = STATUS_BADGE_CLASSES[entryStatus] || STATUS_BADGE_CLASSES.BLANK;
                          return (
                            <div key={`${entry?.changedAt || index}-${index}`} className="border border-gray-100 rounded-md p-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold ${entryBadgeClass}`}>
                                  {entryStatus}
                                </span>
                                <span className="text-[11px] text-gray-500">{formatDateTime(entry?.changedAt)}</span>
                              </div>
                              <div className="text-xs text-gray-600 mt-1">
                                Event: {entry?.event || "STATUS_CHANGE"}
                              </div>
                              {entry?.rejectionReason ? (
                                <div className="text-xs text-rose-600 mt-1">Reason: {entry.rejectionReason}</div>
                              ) : null}
                              {entry?.changedBy ? (
                                <div className="text-[11px] text-gray-500 mt-1">
                                  By: {entry.changedBy?.name || entry.changedBy?.email || entry.changedBy?.phone || "Unknown"}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedDoc ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <div className="text-sm font-semibold text-gray-800">{selectedDoc.label}</div>
              <div className="flex items-center gap-3">
                <a
                  href={selectedDoc.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-blue-600 hover:text-blue-700 inline-flex items-center gap-1"
                >
                  <ExternalLink size={14} />
                  Open Cloudinary
                </a>
                <button
                  type="button"
                  onClick={() => setSelectedDoc(null)}
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="h-[72vh] bg-slate-50">
              <iframe
                title="KYC document preview"
                src={selectedDoc.url}
                className="w-full h-full"
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default KycHistory;
