import React, { useEffect, useState, useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
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

function LicenseExpire() {
  const { getAllUsers, updateKYCStatus } = useContextApi();

  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("expired");
  const [sortBy, setSortBy] = useState("date");
  const [selectedRetailer, setSelectedRetailer] = useState(null);
  const [updatedStatus, setUpdatedStatus] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await getAllUsers();
        setUsers(res?.users || res || []);
      } catch (err) {
        console.log("Error:", err);
      }
    };
    fetchData();
  }, [getAllUsers]);

  const getExpiryDate = (u) => u.drugLicenseExpiry || u.licenseExpiryDate;

  const expiredLicenses = useMemo(() => {
    const today = new Date();
    const warningDate = new Date();
    warningDate.setDate(today.getDate() + 30);
    return users
      .filter((u) => getExpiryDate(u))
      .filter((u) => {
        const expiry = new Date(getExpiryDate(u));
        if (filter === "expired") return expiry < today;
        if (filter === "soon") return expiry >= today && expiry <= warningDate;
        return true;
      })
      .filter((r) => {
        const email = r?.email || "";
        const phone = r?.phone || "";
        return email.toLowerCase().includes(search.toLowerCase()) || phone.includes(search);
      })
      .sort((a, b) => {
        if (sortBy === "date") return new Date(getExpiryDate(a)) - new Date(getExpiryDate(b));
        if (sortBy === "name") return (a.name || "").localeCompare(b.name || "");
        return 0;
      });
  }, [users, filter, search, sortBy]);

  useEffect(() => setCurrentPage(1), [search, filter, sortBy]);

  const totalPages = Math.ceil(expiredLicenses.length / itemsPerPage) || 1;
  const paginatedLicenses = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return expiredLicenses.slice(start, start + itemsPerPage);
  }, [expiredLicenses, currentPage]);

  const goToPage = (n) => {
    setCurrentPage(Math.max(1, Math.min(n, totalPages)));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

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

        <h1 className="text-2xl font-bold text-orange-600">
          License Expiry Management
        </h1>

        <p className="text-gray-600">
          Monitor expired and expiring licenses
        </p>

      </div>


      {/* Controls */}
      <div className="flex flex-col md:flex-row gap-4 mb-5">


        {/* Search */}
        <input
          type="text"
          placeholder="Search by email or phone"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-4 py-2 border rounded-lg w-full md:w-1/3"
        />


        {/* Filter */}
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="border px-4 py-2 rounded-lg w-full md:w-1/4"
        >
          <option value="expired">Expired</option>
          <option value="soon">Expiring in 30 Days</option>
        </select>


        {/* Sort */}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="border px-4 py-2 rounded-lg w-full md:w-1/4"
        >
          <option value="date">Expiry Date</option>
          <option value="name">Name A → Z</option>
        </select>

      </div>


      {/* Table */}
      <div className="bg-white rounded-xl shadow overflow-x-auto">


        <table className="w-full text-sm min-w-[900px]">

          <thead className="bg-orange-100 text-orange-700">

            <tr>
              <th className="p-3 text-left">Name</th>
              <th className="p-3 text-left">Email</th>
              <th className="p-3 text-left">Phone</th>
              <th className="p-3 text-left">License No</th>
              <th className="p-3 text-left">Expiry Date</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-center">Action</th>
            </tr>

          </thead>


          <tbody>


            {expiredLicenses.length === 0 && (

              <tr>
                <td
                  colSpan="7"
                  className="text-center py-6 text-gray-500"
                >
                  No Records Found
                </td>
              </tr>

            )}


            {paginatedLicenses.map((r) => {
              const expiryDate = getExpiryDate(r);
              const expiry = new Date(expiryDate);
              const isExpired = expiry < new Date();

              return (
                <tr key={r._id} className="border-b hover:bg-orange-50">
                  <td className="p-3">{r.name}</td>
                  <td className="p-3">{r.email}</td>
                  <td className="p-3">{r.phone}</td>
                  <td className="p-3">{r.drugLicenseNumber || r.licenseNumber || "N/A"}</td>

                  <td className="p-3">
                    {expiry.toLocaleDateString()}
                  </td>

                  <td className="p-3">

                    {isExpired ? (

                      <span className="px-2 py-1 text-xs rounded-full bg-red-100 text-red-700">
                        Expired
                      </span>

                    ) : (

                      <span className="px-2 py-1 text-xs rounded-full bg-yellow-100 text-yellow-700">
                        Expiring Soon
                      </span>

                    )}

                  </td>
                  <td className="p-3 text-center">
                    <button
                      onClick={() => {
                        setSelectedRetailer(r);
                        setUpdatedStatus(r.kyc || "PENDING");
                      }}
                      className="px-4 py-1 bg-blue-600 text-white rounded"
                    >
                      View
                    </button>
                  </td>
                </tr>
              );
            })}

          </tbody>

        </table>

      </div>

      {totalPages > 1 && (
        <div className="mt-4 px-4 py-3 border-t flex flex-col md:flex-row justify-between items-center gap-4 bg-gray-50 rounded-lg">
          <p className="text-sm text-gray-600">
            Showing <span className="font-semibold">{(currentPage - 1) * itemsPerPage + 1}</span> to{" "}
            <span className="font-semibold">{Math.min(currentPage * itemsPerPage, expiredLicenses.length)}</span> of{" "}
            <span className="font-semibold">{expiredLicenses.length}</span> retailers
          </p>
          <div className="flex items-center gap-2">
            <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 1} className="p-2 border rounded-md bg-white hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed">
              <ChevronLeft size={18} />
            </button>
            <div className="flex gap-1">
              {[...Array(totalPages)].map((_, i) => {
                const p = i + 1;
                if (p === 1 || p === totalPages || (p >= currentPage - 1 && p <= currentPage + 1)) {
                  return <button key={p} onClick={() => goToPage(p)} className={`px-3.5 py-1.5 rounded-md text-sm font-medium ${currentPage === p ? "bg-orange-600 text-white" : "bg-white border hover:bg-gray-100"}`}>{p}</button>;
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
              <Info label="Drug License No" value={selectedRetailer.drugLicenseNumber || selectedRetailer.licenseNumber} />
              <Info label="Expiry Date" value={getExpiryDate(selectedRetailer) ? new Date(getExpiryDate(selectedRetailer)).toLocaleDateString() : "N/A"} />
              <DocumentRow label="Aadhaar No" number={selectedRetailer.aadharNumber} file={fileUrl(selectedRetailer.cancelChequeDoc)} />
              <DocumentRow label="PAN No" number={selectedRetailer.panNumber} file={fileUrl(selectedRetailer.panDoc)} />
              <DocumentRow label="Drug License Document" number="" file={fileUrl(selectedRetailer.drugLicenseDoc)} />
              {selectedRetailer.shopImage && (
                <div className="bg-gray-50 p-4 rounded-lg">
                  <h3 className="font-semibold mb-2">Shop Document</h3>
                  {selectedRetailer.shopImage.endsWith(".pdf") ? (
                    <iframe src={fileUrl(selectedRetailer.shopImage)} className="w-full h-56 border rounded" />
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

export default LicenseExpire;

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
