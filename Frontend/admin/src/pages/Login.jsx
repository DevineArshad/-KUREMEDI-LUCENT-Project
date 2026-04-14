import React, { useState, useEffect } from "react";
import { useContextApi } from "../hooks/useContextApi";
import { useNavigate } from "react-router-dom";

const AdminLogin = () => {
  const { loginuser, getAdminForgotSecurityQuestions, verifyAdminForgotSecurityAnswers, resetAdminForgotPassword } = useContextApi();
  const navigate = useNavigate();

  // ✅ Check if user is already authenticated on mount and page load
  useEffect(() => {
    const token = localStorage.getItem("adminToken");
    if (token) {
      // User is already logged in, redirect to dashboard
      navigate("/", { replace: true });
    }
  }, [navigate]);

  // 🔥 Form State
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });

  const [loading, setLoading] = useState(false);
  const [loadingForgotQuestions, setLoadingForgotQuestions] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [showForgotSection, setShowForgotSection] = useState(false);
  const [forgotStep, setForgotStep] = useState("questions");
  const [forgotQuestions, setForgotQuestions] = useState([]);
  const [forgotAnswers, setForgotAnswers] = useState(["", "", ""]);
  const [forgotResetToken, setForgotResetToken] = useState("");
  const [forgotPasswordForm, setForgotPasswordForm] = useState({
    newPassword: "",
    confirmPassword: "",
  });

  // Handle input change
  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  // 🔥 Submit Login Form
  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const response = await loginuser(formData);

      console.log("message", response.data.token);

      if (response?.data?.token) {
        // Save tokens
        localStorage.setItem("adminToken", response.data?.token);
        localStorage.setItem("adminRefreshToken", response.data?.token);
        

        navigate("/");
      } else {
        setErrorMsg("Invalid email or password");
      }
    } catch (error) {
      console.log("Login error:", error);
      setErrorMsg("Something went wrong. Try again.");
    }

    setLoading(false);
  };

  const handleOpenForgotPassword = async () => {
    setErrorMsg("");
    setSuccessMsg("");

    const email = String(formData.email || "").trim();
    if (!email) {
      setErrorMsg("Please enter admin email first");
      return;
    }

    try {
      setLoadingForgotQuestions(true);
      const response = await getAdminForgotSecurityQuestions(email);
      const questions = Array.isArray(response?.questions) ? response.questions : [];
      if (questions.length !== 3) {
        setErrorMsg("This admin does not have 3 configured security questions");
        return;
      }
      setForgotQuestions(questions);
      setForgotAnswers(["", "", ""]);
      setForgotStep("questions");
      setForgotResetToken("");
      setForgotPasswordForm({ newPassword: "", confirmPassword: "" });
      setShowForgotSection(true);
    } catch (error) {
      setErrorMsg(error?.response?.data?.message || "Unable to load security questions");
    } finally {
      setLoadingForgotQuestions(false);
    }
  };

  const handleForgotAnswerChange = (index, value) => {
    setForgotAnswers((prev) => prev.map((item, itemIndex) => (itemIndex === index ? value : item)));
  };

  const handleVerifySecurityQuestions = async (e) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");

    const securityQuestions = forgotQuestions.map((question, index) => ({
      question,
      answer: String(forgotAnswers[index] || "").trim(),
    }));

    if (securityQuestions.some((item) => !item.answer)) {
      setErrorMsg("Please answer all 3 security questions");
      return;
    }

    try {
      setResettingPassword(true);
      const response = await verifyAdminForgotSecurityAnswers({
        email: formData.email,
        securityQuestions,
      });
      setForgotResetToken(String(response?.resetToken || ""));
      setForgotStep("password");
      setSuccessMsg("Security questions verified. Set your new password.");
    } catch (error) {
      setErrorMsg(error?.response?.data?.message || "Security answer verification failed");
    } finally {
      setResettingPassword(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");

    if (!forgotResetToken) {
      setErrorMsg("Verification session expired. Please answer security questions again.");
      setForgotStep("questions");
      return;
    }

    try {
      setResettingPassword(true);
      const response = await resetAdminForgotPassword({
        resetToken: forgotResetToken,
        newPassword: forgotPasswordForm.newPassword,
        confirmPassword: forgotPasswordForm.confirmPassword,
      });
      setSuccessMsg(response?.message || "Password reset successful");
      setShowForgotSection(false);
      setForgotStep("questions");
      setForgotQuestions([]);
      setForgotAnswers(["", "", ""]);
      setForgotResetToken("");
      setForgotPasswordForm({ newPassword: "", confirmPassword: "" });
      setFormData((prev) => ({ ...prev, password: "" }));
    } catch (error) {
      setErrorMsg(error?.response?.data?.message || "Failed to reset password");
    } finally {
      setResettingPassword(false);
    }
  };


  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-200 px-4">
      <div className="bg-white w-full max-w-md rounded-xl shadow-xl p-8 border border-gray-100">

        {/* Logo / Title */}
        <h1 className="text-2xl font-bold text-center text-gray-800 mb-2">
          Admin Panel
        </h1>
        <p className="text-center text-gray-600 text-sm mb-6">
          Sign in to continue
        </p>

        {/* Error Message */}
        {errorMsg && (
          <p className="text-red-600 text-center mb-3 text-sm">{errorMsg}</p>
        )}
        {successMsg && (
          <p className="text-emerald-700 text-center mb-3 text-sm">{successMsg}</p>
        )}

        {/* Login Form */}
        <form className="space-y-5" onSubmit={handleLogin}>
          {/* Email */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">
              Admin Email
            </label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="admin@example.com"
              required
              className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:outline-none
              focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Password */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">
              Password
            </label>
            <input
              type="password"
              name="password"
              required
              value={formData.password}
              onChange={handleChange}
              placeholder="********"
              className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:outline-none
              focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Login Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-2 rounded-lg font-semibold
            hover:bg-blue-700 transition disabled:bg-blue-300"
          >
            {loading ? "Logging in..." : "Login"}
          </button>

          <button
            type="button"
            onClick={handleOpenForgotPassword}
            disabled={loadingForgotQuestions}
            className="w-full border border-blue-200 text-blue-700 py-2 rounded-lg font-semibold hover:bg-blue-50 transition disabled:opacity-60"
          >
            {loadingForgotQuestions ? "Loading Security Questions..." : "Forgot Password"}
          </button>
        </form>

        {showForgotSection ? (
          <div className="mt-6 space-y-4 border border-gray-200 rounded-lg p-4">
            {forgotStep === "questions" ? (
              <form className="space-y-4" onSubmit={handleVerifySecurityQuestions}>
                <h2 className="text-base font-semibold text-gray-800">Verify Security Questions</h2>
                {forgotQuestions.map((question, index) => (
                  <div key={question}>
                    <label className="text-sm font-medium text-gray-700 mb-1 block">
                      Security Question {index + 1}
                    </label>
                    <p className="text-sm text-gray-700 mb-2">{question}</p>
                    <input
                      type="text"
                      value={forgotAnswers[index]}
                      onChange={(e) => handleForgotAnswerChange(index, e.target.value)}
                      placeholder="Enter your answer"
                      required
                      className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                ))}

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowForgotSection(false);
                      setForgotStep("questions");
                      setForgotQuestions([]);
                      setForgotAnswers(["", "", ""]);
                      setForgotResetToken("");
                      setForgotPasswordForm({ newPassword: "", confirmPassword: "" });
                    }}
                    className="w-1/2 border border-gray-300 text-gray-700 py-2 rounded-lg font-semibold hover:bg-gray-50 transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={resettingPassword}
                    className="w-1/2 bg-blue-600 text-white py-2 rounded-lg font-semibold hover:bg-blue-700 transition disabled:bg-blue-300"
                  >
                    {resettingPassword ? "Verifying..." : "Submit Answers"}
                  </button>
                </div>
              </form>
            ) : (
              <form className="space-y-4" onSubmit={handleResetPassword}>
                <h2 className="text-base font-semibold text-gray-800">Set New Password</h2>
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1 block">New Password</label>
                  <input
                    type="password"
                    value={forgotPasswordForm.newPassword}
                    onChange={(e) => setForgotPasswordForm((prev) => ({ ...prev, newPassword: e.target.value }))}
                    placeholder="New password"
                    required
                    className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1 block">Confirm Password</label>
                  <input
                    type="password"
                    value={forgotPasswordForm.confirmPassword}
                    onChange={(e) => setForgotPasswordForm((prev) => ({ ...prev, confirmPassword: e.target.value }))}
                    placeholder="Confirm password"
                    required
                    className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setForgotStep("questions")}
                    className="w-1/2 border border-gray-300 text-gray-700 py-2 rounded-lg font-semibold hover:bg-gray-50 transition"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={resettingPassword}
                    className="w-1/2 bg-blue-600 text-white py-2 rounded-lg font-semibold hover:bg-blue-700 transition disabled:bg-blue-300"
                  >
                    {resettingPassword ? "Resetting..." : "Change Password"}
                  </button>
                </div>
              </form>
            )}
          </div>
        ) : null}

        {/* Footer */}
        <p className="mt-6 text-center text-xs text-gray-500">
          © {new Date().getFullYear()} Cafrox Admin. All Rights Reserved.
        </p>
      </div>
    </div>
  );
};

export default AdminLogin;
