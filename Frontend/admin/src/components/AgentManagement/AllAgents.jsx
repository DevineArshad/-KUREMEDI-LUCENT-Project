import React, { useState, useEffect } from "react";
import { CheckCircle, XCircle, Eye, ShieldBan, ShieldCheck, Trash2 } from "lucide-react";
import { useContextApi } from "../../hooks/useContextApi";

const DOC_LABELS = {
  aadharDoc: "Aadhar",
  panDoc: "PAN",
  cancelChequeDoc: "Bank (Cancel Cheque)",
};

export default function AllAgents() {
  const { getAgents, updateAgentKycStatus, updateAgent, deleteAgent, getUploadBaseUrl } = useContextApi();
  const [activeTab, setActiveTab] = useState("All");
  const [agents, setAgents] = useState([]);
  const [stats, setStats] = useState({ total: 0, active: 0, pending: 0, inactive: 0, retailers: 0, payout: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [verifyingId, setVerifyingId] = useState(null);
  const [statusUpdatingId, setStatusUpdatingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [kycStatusEdit, setKycStatusEdit] = useState("");

  const tabs = [
    { key: "All", label: "All", count: stats.total, statusFilter: undefined },
    { key: "Active", label: "Active", count: stats.active, statusFilter: "Active" },
    { key: "Pending", label: "Pending", count: stats.pending, statusFilter: "Pending" },
    { key: "Blocked", label: "Blocked", count: stats.inactive, statusFilter: "Inactive" },
  ];

  const selectedTab = tabs.find((tab) => tab.key === activeTab) || tabs[0];

  const fetchAgents = async () => {
    setLoading(true);
    setError("");
    try {
      const filter = selectedTab.statusFilter;
      const data = await getAgents(filter);
      setAgents(data.agents || []);
      setStats({
        total: data.total ?? 0,
        active: data.active ?? 0,
        pending: data.pending ?? 0,
        inactive: data.inactive ?? 0,
        retailers: data.retailers ?? 0,
        payout: data.payout ?? 0,
      });
    } catch (err) {
      setAgents([]);
      const status = err.response?.status;
      const msg = err.response?.data?.message || err.message;
      setError(
        status === 401
          ? "Please log in again."
          : status === 403
            ? "Access denied. Log in with an admin account."
            : msg || "Failed to load agents"
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAgents();
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleUpdateStatus = async (agentId, newStatus) => {
    try {
      setStatusUpdatingId(agentId);
      await updateAgent(agentId, { status: newStatus });
      await fetchAgents();
    } catch (err) {
      const msg = err.response?.data?.message || err.message || "Failed to update agent status";
      setError(msg);
    } finally {
      setStatusUpdatingId(null);
    }
  };

  const handleDeleteAgent = async (agentId) => {
    if (!window.confirm("Delete this agent permanently? This will also remove the linked login if present.")) return;
    try {
      setDeletingId(agentId);
      await deleteAgent(agentId);
      if (selectedAgent?._id === agentId) setSelectedAgent(null);
      await fetchAgents();
    } catch (err) {
      const msg = err.response?.data?.message || err.message || "Failed to delete agent";
      setError(msg);
    } finally {
      setDeletingId(null);
    }
  };

  const uploadBase = getUploadBaseUrl();
  const docUrl = (path) => {
    if (!path) return null;
    const normalized = String(path).trim().replace(/\\/g, "/").replace(/^\/+/, "");
    if (/^(https?:|data:|blob:)/i.test(normalized)) {
      return normalized;
    }
    return normalized.startsWith("uploads/")
      ? `${uploadBase}/${normalized}`
      : `${uploadBase}/uploads/${normalized}`;
  };

  return (
    <div className="w-full p-4 md:p-6 bg-gray-100 min-h-screen">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Agent Management</h1>
        <p className="text-gray-500 text-sm mt-1">Manage MR (Medical Representatives) and their performance</p>
      </div>

      <div className="flex flex-wrap gap-2 mb-5">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium ${
              activeTab === tab.key ? "bg-blue-600 text-white" : "bg-white border border-gray-200 hover:bg-gray-50"
            }`}
          >
            {tab.label} ({tab.count})
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-5">
        <StatCard title="Total Agents" value={stats.total} />
        <StatCard title="Active Agents" value={stats.active} />
        <StatCard title="Blocked Agents" value={stats.inactive} />
        <StatCard title="Retailers Onboarded" value={stats.retailers} />
        <StatCard title="Pending Payouts" value={`₹${stats.payout}`} />
      </div>

      <div className="bg-white rounded-xl shadow-md overflow-x-auto">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-800">Agents List</h2>
          <p className="text-gray-500 text-sm mt-0.5">{agents.length} agents found</p>
        </div>

        {error && (
          <div className="mx-4 mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-700 font-medium">{error}</p>
            {error.includes("Access denied") && (
              <p className="text-red-600 text-sm mt-2">
                Log in with a user that has admin role. From the backend folder run:{" "}
                <code className="bg-red-100 px-1 rounded">npm run set-admin -- your@email.com</code> to make a user an admin, then log in again.
              </p>
            )}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse min-w-[1180px]">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-3 text-left w-14">S.No</th>
                <th className="p-3 text-left">Name</th>
                <th className="p-3 text-left">Contact</th>
                <th className="p-3 text-left">Territory</th>
                <th className="p-3 text-left">Address</th>
                <th className="p-3 text-left">Referral Code</th>
                <th className="p-3 text-left">Retailers</th>
                <th className="p-3 text-left">Commission</th>
                <th className="p-3 text-left">Payout</th>
                <th className="p-3 text-left">KYC</th>
                <th className="p-3 text-left">Status</th>
                <th className="p-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan="12" className="p-5 text-center text-gray-500">Loading...</td>
                </tr>
              )}
              {!loading && agents.length === 0 && (
                <tr>
                  <td colSpan="12" className="p-5 text-center text-gray-500">No agents found</td>
                </tr>
              )}
              {!loading && agents.map((agent, idx) => (
                <tr key={agent._id} className="border-t border-gray-200 hover:bg-blue-50">
                  <td className="p-3 text-gray-500 font-medium">{idx + 1}</td>
                  <td className="p-3 font-medium">{agent.name || "—"}</td>
                  <td className="p-3">
                    <div>{agent.phone || "—"}</div>
                    {agent.email && <div className="text-gray-500 text-xs">{agent.email}</div>}
                  </td>
                  <td className="p-3">{agent.territory || "—"}</td>
                  <td className="p-3 max-w-[220px] truncate" title={agent.address || ""}>{agent.address || "—"}</td>
                  <td className="p-3 font-mono text-xs">{agent.referralCode || "—"}</td>
                  <td className="p-3">{agent.retailersOnboarded ?? 0}</td>
                  <td className="p-3">₹{(agent.totalEarned ?? 0).toFixed(2)}</td>
                  <td className="p-3">₹{(agent.totalPending ?? 0).toFixed(2)}</td>
                  <td className="p-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      agent.kycStatus === "APPROVED" ? "bg-green-100 text-green-700" :
                      agent.kycStatus === "REJECTED" ? "bg-red-100 text-red-700" :
                      agent.kycStatus === "PENDING" ? "bg-amber-100 text-amber-700" :
                      "bg-gray-100 text-gray-600"
                    }`}>
                      {agent.kycStatus || "BLANK"}
                    </span>
                  </td>
                  <td className="p-3">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                      agent.status === "Active"
                        ? "bg-green-100 text-green-700"
                        : agent.status === "Inactive"
                          ? "bg-red-100 text-red-700"
                          : "bg-amber-100 text-amber-700"
                    }`}>
                      {agent.status || "Pending"}
                    </span>
                  </td>
                  <td className="p-3 whitespace-nowrap">
                    <div className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 p-1">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedAgent(agent);
                          setKycStatusEdit(agent.kycStatus || "BLANK");
                        }}
                        className="inline-flex items-center gap-1.5 shrink-0 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                      >
                        <Eye size={14} />
                        View
                      </button>
                      <button
                        type="button"
                        onClick={() => handleUpdateStatus(agent._id, agent.status === "Inactive" ? "Active" : "Inactive")}
                        disabled={statusUpdatingId === agent._id}
                        className={`inline-flex items-center gap-1.5 shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium border disabled:opacity-50 ${
                          agent.status === "Inactive"
                            ? "bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
                            : "bg-red-50 text-red-700 border-red-200 hover:bg-red-100"
                        }`}
                      >
                        {agent.status === "Inactive" ? <ShieldCheck size={14} /> : <ShieldBan size={14} />}
                        {agent.status === "Inactive" ? "Unblock" : "Block"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteAgent(agent._id)}
                        disabled={deletingId === agent._id}
                        className="shrink-0 px-3 py-1.5 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-black disabled:opacity-50 inline-flex items-center gap-1.5"
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
      </div>

      {/* Agent detail modal */}
      {selectedAgent && (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50 px-3">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="flex justify-between px-6 py-4 border-b bg-gray-50">
              <h2 className="font-semibold text-lg">Agent Details</h2>
              <button type="button" onClick={() => setSelectedAgent(null)} className="text-xl leading-none">✕</button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              <AgentInfo label="Name" value={selectedAgent.name} />
              <AgentInfo label="Email" value={selectedAgent.email} />
              <AgentInfo label="Phone" value={selectedAgent.phone} />
              <AgentInfo label="Territory" value={selectedAgent.territory} />
              <AgentInfo label="Address" value={selectedAgent.address} />
              <AgentInfo label="Referral Code" value={selectedAgent.referralCode} />

              <h3 className="font-semibold text-gray-800 pt-2">Identity</h3>
              <AgentDocRow label="Aadhar No" number={selectedAgent.aadharNumber} file={docUrl(selectedAgent.aadharDoc)} />
              <AgentDocRow label="PAN No" number={selectedAgent.panNumber} file={docUrl(selectedAgent.panDoc)} />

              <h3 className="font-semibold text-gray-800 pt-2">Bank details</h3>
              <AgentInfo label="Bank Name" value={selectedAgent.bankName} />
              <AgentInfo label="Account Holder" value={selectedAgent.accountHolderName} />
              <AgentInfo label="Account Number" value={selectedAgent.accountNumber} />
              <AgentInfo label="IFSC Code" value={selectedAgent.ifscCode} />
              <AgentDocRow label="Cancel Cheque / Passbook" number="" file={docUrl(selectedAgent.cancelChequeDoc)} />

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">KYC Status</label>
                <select
                  value={kycStatusEdit}
                  onChange={(e) => setKycStatusEdit(e.target.value)}
                  className="border w-full px-3 py-2 rounded"
                >
                  <option value="APPROVED">APPROVED</option>
                  <option value="PENDING">PENDING</option>
                  <option value="REJECTED">REJECTED</option>
                  <option value="BLANK">BLANK</option>
                </select>
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-3 px-6 py-4 border-t bg-gray-50">
              <button type="button" onClick={() => setSelectedAgent(null)} className="px-4 py-2 border rounded">Cancel</button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await updateAgentKycStatus(selectedAgent._id, kycStatusEdit);
                    await fetchAgents();
                    setSelectedAgent(null);
                  } catch (err) {
                    setError(err.response?.data?.message || err.message || "Failed to update KYC");
                  }
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded"
              >
                Save KYC
              </button>
              {selectedAgent.kycStatus !== "APPROVED" && (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      setVerifyingId(selectedAgent._id);
                      await updateAgentKycStatus(selectedAgent._id, "APPROVED");
                      await fetchAgents();
                      setSelectedAgent(null);
                    } catch (err) {
                      setError(err.response?.data?.message || err.message);
                    } finally {
                      setVerifyingId(null);
                    }
                  }}
                  disabled={verifyingId === selectedAgent._id}
                  className="px-4 py-2 bg-green-600 text-white rounded disabled:opacity-50"
                >
                  Approve
                </button>
              )}
              {selectedAgent.kycStatus !== "REJECTED" && (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      setVerifyingId(selectedAgent._id);
                      await updateAgentKycStatus(selectedAgent._id, "REJECTED");
                      await fetchAgents();
                      setSelectedAgent(null);
                    } catch (err) {
                      setError(err.response?.data?.message || err.message);
                    } finally {
                      setVerifyingId(null);
                    }
                  }}
                  disabled={verifyingId === selectedAgent._id}
                  className="px-4 py-2 bg-red-600 text-white rounded disabled:opacity-50"
                >
                  Reject
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AgentInfo({ label, value }) {
  return (
    <div className="border p-2 rounded bg-white">
      <b>{label}:</b> {value || "—"}
    </div>
  );
}

function AgentDocRow({ label, number, file }) {
  return (
    <div className="border p-3 rounded bg-white flex flex-wrap justify-between items-center gap-2">
      <span><b>{label}:</b> {number || "—"}</span>
      {file ? (
        <span className="flex items-center gap-3">
          <a href={file} target="_blank" rel="noopener noreferrer" className="text-blue-600 text-sm font-medium">View</a>
          <a href={file} download target="_blank" rel="noopener noreferrer" className="text-blue-600 text-sm font-medium">Download</a>
        </span>
      ) : (
        <span className="text-gray-400 text-sm">Not uploaded</span>
      )}
    </div>
  );
}

function StatCard({ title, value }) {
  return (
    <div className="bg-white rounded-xl shadow p-5">
      <p className="text-gray-500 text-sm mb-1">{title}</p>
      <h3 className="text-2xl font-bold text-gray-900">{value}</h3>
    </div>
  );
}
