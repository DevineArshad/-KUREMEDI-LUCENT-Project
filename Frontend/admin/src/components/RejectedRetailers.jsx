import React, { useEffect, useState } from "react";
import { useContextApi } from "../hooks/useContextApi";
import { resolveUploadUrl } from "../lib/baseUrl";

const fileUrl = (file) => {
  if (!file) return null;
  const normalized = String(file).trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (/^(https?:|data:|blob:)/i.test(normalized)) {
    return normalized;
  }
  return normalized.startsWith("uploads/")
    ? resolveUploadUrl(normalized)
    : resolveUploadUrl(`uploads/${normalized}`);
};

function RejectedRetailers() {
  const { getAllUsers, updateKYCStatus } = useContextApi();

  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("newest");
  const [selectedRetailer, setSelectedRetailer] = useState(null);
  const [updatedStatus, setUpdatedStatus] = useState("");

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await getAllUsers();
        setUsers(res?.users || res || []);
      } catch (error) {
        console.log("Error:", error);
      }
    };
    fetchData();
  }, [getAllUsers]);

  const rejectedRetailers = users
    .filter((u) => (u.kyc || "").toUpperCase() === "REJECTED")
    .filter((r) => {
      const email = r?.email || "";
      const phone = r?.phone || "";
      return email.toLowerCase().includes(search.toLowerCase()) || phone.includes(search);
    })
    .sort((a, b) => {
      if (sortBy === "newest") return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      if (sortBy === "oldest") return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
      if (sortBy === "name") return (a.name || "").localeCompare(b.name || "");
      return 0;
    });

  const handleSubmit = async () => {
    try {
      await updateKYCStatus(selectedRetailer._id, updatedStatus);
      const updatedUsers = users.map((u) =>
        u._id === selectedRetailer._id ? { ...u, kyc: updatedStatus } : u
      );
      setUsers(updatedUsers);
      setSelectedRetailer(null);
      alert("✅ KYC Status Updated Successfully!");
    } catch {
      alert("❌ Failed to update KYC status");
    }
  };


  /* ================= UI ================= */

  return (

    <div className="p-6 bg-gray-100 min-h-screen">


      {/* Header */}
      <div className="mb-6">

        <h1 className="text-2xl font-bold text-red-600">
          Rejected Retailers
        </h1>

        <p className="text-gray-600">
          List of rejected applications
        </p>

      </div>


      {/* Search + Sort */}
      <div className="flex flex-col md:flex-row gap-4 mb-5">


        {/* Search */}
        <input
          type="text"
          placeholder="Search by email or phone"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-4 py-2 border rounded-lg w-full md:w-1/3"
        />


        {/* Sort */}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="border px-4 py-2 rounded-lg w-full md:w-1/4"
        >
          <option value="newest">Newest First</option>
          <option value="oldest">Oldest First</option>
          <option value="name">Name A → Z</option>
        </select>

      </div>


      {/* Table */}
      <div className="bg-white rounded-xl shadow overflow-x-auto">


        <table className="w-full text-sm min-w-[800px]">

          <thead className="bg-red-100 text-red-700">

            <tr>
              <th className="p-3 text-left">Name</th>
              <th className="p-3 text-left">Email</th>
              <th className="p-3 text-left">Phone</th>
              <th className="p-3 text-left">License No</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-center">Action</th>
            </tr>

          </thead>


          <tbody>


            {rejectedRetailers.length === 0 && (
              <tr>
                <td colSpan="6" className="text-center py-6 text-gray-500">
                  No Rejected Retailers Found
                </td>
              </tr>
            )}

            {rejectedRetailers.map((r) => (
              <tr key={r._id} className="border-b hover:bg-red-50">
                <td className="p-3">{r.name}</td>
                <td className="p-3">{r.email}</td>
                <td className="p-3">{r.phone}</td>
                <td className="p-3">{r.drugLicenseNumber || r.licenseNumber || "N/A"}</td>
                <td className="p-3"><StatusBadge status={r.kyc} /></td>
                <td className="p-3 text-center">
                  <button
                    onClick={() => {
                      setSelectedRetailer(r);
                      setUpdatedStatus(r.kyc || "REJECTED");
                    }}
                    className="px-4 py-1 bg-blue-600 text-white rounded"
                  >
                    View
                  </button>
                </td>
              </tr>
            ))}

          </tbody>

        </table>

      </div>

      {selectedRetailer && (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50 px-3">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-xl overflow-hidden">
            <div className="flex justify-between px-6 py-4 border-b bg-gray-50">
              <h2 className="font-semibold text-lg">Retailer Details</h2>
              <button onClick={() => setSelectedRetailer(null)} className="text-xl">✕</button>
            </div>
            <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
              <Info label="Name" value={selectedRetailer.name} />
              <Info label="Email" value={selectedRetailer.email} />
              <Info label="Phone" value={selectedRetailer.phone} />
              <DocumentRow label="Aadhaar No" number={selectedRetailer.aadharNumber} file={fileUrl(selectedRetailer.cancelChequeDoc)} />
              <DocumentRow label="PAN No" number={selectedRetailer.panNumber} file={fileUrl(selectedRetailer.panDoc)} />
              <Info label="Drug License No" value={selectedRetailer.drugLicenseNumber} />
              <DocumentRow label="Drug License Document" number="" file={fileUrl(selectedRetailer.drugLicenseDoc)} />
              {selectedRetailer.shopImage && (
                <div className="bg-gray-50 p-4 rounded-lg">
                  <h3 className="font-semibold mb-2">Shop Document</h3>
                  {selectedRetailer.shopImage.endsWith(".pdf") ? (
                    <iframe src={fileUrl(selectedRetailer.shopImage)} className="w-full h-56 border rounded" title="Shop doc" />
                  ) : (
                    <img src={fileUrl(selectedRetailer.shopImage)} className="w-full h-56 object-cover border rounded" alt="Shop" />
                  )}
                  <a href={fileUrl(selectedRetailer.shopImage)} download className="text-blue-600 text-sm mt-2 inline-block">⬇️ Download</a>
                </div>
              )}
              <select value={updatedStatus} onChange={(e) => setUpdatedStatus(e.target.value)} className="border w-full px-3 py-2 rounded">
                <option value="APPROVED">APPROVED</option>
                <option value="PENDING">PENDING</option>
                <option value="REJECTED">REJECTED</option>
                <option value="BLANK">BLANK</option>
              </select>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t bg-gray-50">
              <button onClick={() => setSelectedRetailer(null)} className="px-4 py-2 border rounded">Cancel</button>
              <button onClick={handleSubmit} className="px-4 py-2 bg-blue-600 text-white rounded">Save</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default RejectedRetailers;

function StatusBadge({ status }) {
  const map = { APPROVED: "bg-green-100 text-green-700", PENDING: "bg-yellow-100 text-yellow-700", REJECTED: "bg-red-100 text-red-700", BLANK: "bg-gray-100 text-gray-600" };
  return <span className={`px-3 py-1 rounded-full text-xs font-semibold ${map[status] || "bg-gray-100"}`}>{status || "—"}</span>;
}

function Info({ label, value }) {
  return <div className="border p-2 rounded bg-white"><b>{label}:</b> {value || "N/A"}</div>;
}

function DocumentRow({ label, number, file }) {
  return (
    <div className="border p-3 rounded bg-white flex justify-between items-center">
      <span><b>{label}:</b> {number || "N/A"}</span>
      {file ? <a href={file} download target="_blank" rel="noopener noreferrer" className="text-blue-600 text-sm font-medium">⬇️ Download</a> : <span className="text-red-500 text-sm">Not Uploaded</span>}
    </div>
  );
}
