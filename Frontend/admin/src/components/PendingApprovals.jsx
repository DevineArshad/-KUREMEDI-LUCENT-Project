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

function PendingApprovals() {
  const { getAllUsers, updateKYCStatus } = useContextApi();

  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState("");
  const [selectedRetailer, setSelectedRetailer] = useState(null);
  const [updatedStatus, setUpdatedStatus] = useState("PENDING");
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

  const pendingRetailers = useMemo(() =>
    users
      .filter((u) => {
        const k = (u.kyc || "").toUpperCase();
        return k === "PENDING" || k === "BLANK" || !k;
      })
      .filter((r) => {
        const email = r?.email || "";
        const phone = r?.phone || "";
        return email.toLowerCase().includes(search.toLowerCase()) || phone.includes(search);
      }),
    [users, search]
  );

  useEffect(() => setCurrentPage(1), [search]);

  const totalPages = Math.ceil(pendingRetailers.length / itemsPerPage) || 1;
  const paginatedRetailers = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return pendingRetailers.slice(start, start + itemsPerPage);
  }, [pendingRetailers, currentPage]);

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

    <div className="p-4 md:p-6 bg-gray-100 min-h-screen">


      {/* Header */}
      <div className="mb-6">

        <h1 className="text-2xl font-bold text-gray-800">
          Pending Retailer Approvals
        </h1>

        <p className="text-gray-500 text-sm mt-1">
          Verify and approve pending retailers
        </p>

      </div>


      {/* Search */}
      <div className="mb-4">

        <input
          type="text"
          placeholder="Search by email or phone"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-4 py-2 border rounded-lg w-full md:w-1/3 focus:ring-2 focus:ring-blue-400 outline-none"
        />

      </div>


      {/* Table */}
      <div className="bg-white rounded-xl shadow-md overflow-x-auto">

        <table className="w-full text-sm min-w-[800px]">

          <thead className="bg-gray-100 text-gray-700">

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

            {pendingRetailers.length === 0 && (
              <tr>
                <td
                  colSpan="6"
                  className="p-5 text-center text-gray-500"
                >
                  ✅ No Pending Approvals
                </td>
              </tr>
            )}


            {paginatedRetailers.map((r) => (

              <tr
                key={r._id}
                className="border-t hover:bg-blue-50 transition"
              >

                <td className="p-3 font-medium">{r.name}</td>
                <td className="p-3">{r.email}</td>
                <td className="p-3">{r.phone}</td>

                <td className="p-3">
                  {r.drugLicenseNumber || r.licenseNumber || "N/A"}
                </td>

                <td className="p-3">
                  <StatusBadge status={r.kyc} />
                </td>

                <td className="p-3 text-center">

                  <button
                    onClick={() => {
                      setSelectedRetailer(r);
                      setUpdatedStatus(r.kyc || "PENDING");
                    }}
                    className="px-4 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded-md text-xs transition"
                  >
                    View
                  </button>

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
            <span className="font-semibold">{Math.min(currentPage * itemsPerPage, pendingRetailers.length)}</span> of{" "}
            <span className="font-semibold">{pendingRetailers.length}</span> retailers
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage === 1}
              className="p-2 border rounded-md bg-white hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={18} />
            </button>
            <div className="flex gap-1">
              {[...Array(totalPages)].map((_, i) => {
                const p = i + 1;
                if (p === 1 || p === totalPages || (p >= currentPage - 1 && p <= currentPage + 1)) {
                  return (
                    <button
                      key={p}
                      onClick={() => goToPage(p)}
                      className={`px-3.5 py-1.5 rounded-md text-sm font-medium ${currentPage === p ? "bg-blue-600 text-white" : "bg-white border hover:bg-gray-100"}`}
                    >
                      {p}
                    </button>
                  );
                }
                if (p === currentPage - 2 || p === currentPage + 2) return <span key={p} className="px-1 text-gray-400">...</span>;
                return null;
              })}
            </div>
            <button
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="p-2 border rounded-md bg-white hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      )}

      {/* ================= MODAL ================= */}

      {selectedRetailer && (

        <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50 px-3">

          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-xl overflow-hidden">


            {/* Header */}
            <div className="flex justify-between items-center px-6 py-4 border-b bg-gray-50">

              <h2 className="font-semibold text-lg">
                Retailer Details
              </h2>

              <button
                onClick={() => setSelectedRetailer(null)}
                className="text-xl hover:text-red-500"
              >
                ✕
              </button>

            </div>


            {/* Body */}
            <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">


              {/* Basic Info */}
              <div className="bg-gray-50 p-4 rounded-lg">

                <h3 className="font-semibold mb-3 text-gray-700">
                  Basic Information
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">

                  <Info label="Name" value={selectedRetailer.name} />
                  <Info label="Email" value={selectedRetailer.email} />
                  <Info label="Phone" value={selectedRetailer.phone} />

                  <DocumentRow
                    label="Aadhaar No"
                    number={selectedRetailer.aadharNumber || selectedRetailer.aadhaarNumber}
                    file={fileUrl(selectedRetailer.aadhaarDoc || selectedRetailer.cancelChequeDoc)}
                  />

                  <DocumentRow
                    label="PAN No"
                    number={selectedRetailer.panNumber}
                    file={fileUrl(selectedRetailer.panDoc)}
                  />

                  <Info
                    label="Drug License No"
                    value={selectedRetailer.drugLicenseNumber || selectedRetailer.licenseNumber || "N/A"}
                    full
                  />

                  <DocumentRow
                    label="Drug License Document"
                    number=""
                    file={fileUrl(selectedRetailer.drugLicenseDoc)}
                  />

                </div>

              </div>


              {/* Status */}
              <div className="bg-gray-50 p-4 rounded-lg">

                <h3 className="font-semibold mb-2 text-gray-700">
                  Approval Status
                </h3>

                <select
                  value={updatedStatus}
                  onChange={(e) => setUpdatedStatus(e.target.value)}
                  className="w-full border px-3 py-2 rounded-lg focus:ring-2 focus:ring-blue-400"
                >
                  <option value="APPROVED">APPROVED</option>
                  <option value="REJECTED">REJECTED</option>
                </select>

              </div>

            </div>


            {/* Footer */}
            <div className="flex justify-end gap-3 px-6 py-4 border-t bg-gray-50">

              <button
                onClick={() => setSelectedRetailer(null)}
                className="px-4 py-2 border rounded-lg hover:bg-gray-100"
              >
                Cancel
              </button>

              <button
                onClick={handleSubmit}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg"
              >
                Update
              </button>

            </div>


          </div>

        </div>

      )}

    </div>
  );
}

export default PendingApprovals;



/* ================= COMPONENTS ================= */


function StatusBadge({ status }) {

  return (

    <span className="px-3 py-1 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-700">
      {status}
    </span>

  );
}


function Info({ label, value, full }) {

  return (

    <div
      className={`border p-2 rounded bg-white ${full ? "col-span-2" : ""
        }`}
    >
      <b>{label}:</b> {value}
    </div>

  );
}


function DocumentRow({ label, number, file }) {

  return (

    <div className="flex justify-between items-center border p-2 rounded col-span-2 bg-white">

      <span>
        <b>{label}:</b> {number || "N/A"}
      </span>

      {file ? (

        <a
          href={file}
          download
          className="text-blue-600 text-sm font-medium hover:underline"
        >
          ⬇️ Download
        </a>

      ) : (

        <span className="text-red-500 text-sm font-medium">
          ❌ Not Uploaded
        </span>

      )}

    </div>

  );
}
