"use client";

import React, { useEffect, useState } from "react";
import { Trash2 } from "lucide-react"; // nice delete icon
import { useContextApi } from "../hooks/useContextApi";
import axios from "axios";
import { toast } from "react-hot-toast";
import { API_BASE_URL } from "../config";

const Enquiry = () => {
  const { getAllEnquiries } = useContextApi();
  const [enquiryData, setEnquiryData] = useState([]);

  // ✅ Fetch all enquiries
  const fetchEnquiries = async () => {
    try {
      const data = await getAllEnquiries();
      setEnquiryData(data.data || []);
      console.log("Fetched Enquiries:", data.data);
    } catch (error) {
      console.error("Error fetching enquiries:", error.message);
      toast.error("Failed to fetch enquiries");
    }
  };

  useEffect(() => {
    fetchEnquiries();
  }, []);

  // ✅ Delete an enquiry by ID
  const handleDelete = async (id) => {
    if (!confirm("Are you sure you want to delete this enquiry?")) return;
    try {
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
      const res = await axios.delete(`${baseUrl}/enquiry/delete/${id}`);
      if (res.data.success) {
        toast.success("Enquiry deleted successfully!");
        // Remove deleted item from local state
        setEnquiryData((prev) => prev.filter((item) => item._id !== id));
      } else {
        toast.error("Failed to delete enquiry!");
      }
    } catch (error) {
      console.error("Error deleting enquiry:", error.message);
      toast.error("Server error while deleting enquiry");
    }
  };

  return (
    <div className="p-4  w-[125%]">
      <h2 className="text-xl font-semibold mb-4">📋 Enquiries</h2>

      {enquiryData.length === 0 ? (
        <p className="text-gray-500">No enquiries found.</p>
      ) : (
        <table className="min-w-full border border-gray-200 rounded-lg shadow-sm">
          <thead>
            <tr className="bg-gray-100 text-left">
              <th className="p-2 border-b">#</th>
              <th className="p-2 border-b">Name</th>
              <th className="p-2 border-b">Email</th>
              <th className="p-2 border-b">Message</th>
              <th className="p-2 border-b">Date</th>
              <th className="p-2 border-b text-center">Action</th>
            </tr>
          </thead>
          <tbody>
            {enquiryData.map((enq, index) => (
              <tr key={enq._id} className="hover:bg-gray-50">
                <td className="p-2 border-b">{index + 1}</td>
                <td className="p-2 border-b">{enq.name}</td>
                <td className="p-2 border-b">{enq.email}</td>
                <td className="p-2 border-b">{enq.message}</td>
                <td className="p-2 border-b">
                  {new Date(enq.createdAt).toLocaleDateString()}
                </td>
                <td className="p-2 border-b text-center">
                  <button
                    onClick={() => handleDelete(enq._id)}
                    className="text-red-500 hover:text-red-700 transition"
                    title="Delete enquiry"
                  >
                    <Trash2 className="inline w-5 h-5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default Enquiry;
