import express from "express";
import multer from "multer";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import User from "../model/User.js";
import Agent from "../model/Agent.js";
import Otp from "../model/Otp.js";
import AdminOtp from "../model/AdminOtp.js";
import DeletedUserHistory from "../model/DeletedUserHistory.js";
import { protect } from "../middleware/protect.js";
import { authorizeRoles } from "../middleware/authorize.js";
import { requireAgent } from "../middleware/requireAgent.js";
import { sendOtpSms } from "../utils/smsService.js";
import { sendEmail } from "../utils/mailer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();

// Multer config for KYC uploads
const kycDir = "uploads/kyc";
if (!fs.existsSync("uploads")) fs.mkdirSync("uploads", { recursive: true });
if (!fs.existsSync(kycDir)) fs.mkdirSync(kycDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, kycDir),
  filename: (req, file, cb) => {
    const raw = file.originalname || "";
    const ext = path.extname(raw) || ".pdf";
    const name = `${Date.now()}-${crypto.randomInt(1000, 9999)}${ext}`;
    cb(null, name);
  },
});
const KYC_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const KYC_ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);
const upload = multer({
  storage,
  limits: {
    fileSize: KYC_MAX_FILE_SIZE_BYTES,
    files: 6,
  },
  fileFilter: (req, file, cb) => {
    if (KYC_ALLOWED_MIME_TYPES.has(String(file.mimetype || "").toLowerCase())) {
      return cb(null, true);
    }
    return cb(new Error("Only PDF, JPG, and PNG files are allowed for KYC uploads"));
  },
});

const generateToken = (payload, expiresIn = "7d") =>
  jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
const normalizePhone = (value) => String(value || "").trim();
const PRIMARY_ADMIN_EMAIL = normalizeEmail(
  process.env.PRIMARY_ADMIN_EMAIL || "ankurkushwaha237@gmail.com"
);
const ADMIN_SECURITY_QUESTION_OPTIONS = [
  "What was the name of your first school?",
  "What is your mother's maiden name?",
  "What was your childhood nickname?",
  "What is the name of your best friend from childhood?",
  "What was the make/model of your first vehicle?",
  "In which city were you born?",
  "What is your favorite teacher's name?",
  "What was your first job?",
  "What is your favorite movie?",
  "What is the name of your first pet?",
];
const GST_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_NUMBER_REGEX = /^[0-9]{9,18}$/;
const stripPassword = (user) => {
  const userObj = user.toObject();
  delete userObj.password;
  return userObj;
};

const isPrimaryAdminEmail = (email) => normalizeEmail(email) === PRIMARY_ADMIN_EMAIL;
const hashValue = (value) =>
  crypto.createHash("sha256").update(String(value || "")).digest("hex");

const sendAdminEmailOtp = async ({ to, otp, subject, messagePrefix }) => {
  const text = `${messagePrefix} ${otp}. It expires in 10 minutes.`;
  const html = `<p>${messagePrefix} <strong>${otp}</strong>.</p><p>This code expires in 10 minutes.</p>`;
  return sendEmail({ to, subject, text, html });
};

const createAdminOtp = async ({ email, destination, purpose, meta = {} }) => {
  const otp = crypto.randomInt(100000, 999999).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await AdminOtp.findOneAndUpdate(
    { email, destination, purpose },
    {
      email,
      destination,
      purpose,
      otpHash: hashValue(otp),
      expiresAt,
      meta,
      verifiedAt: null,
    },
    { upsert: true, new: true }
  );
  return otp;
};

const verifyAdminOtp = async ({ email, destination, purpose, otp }) => {
  const otpDoc = await AdminOtp.findOne({ email, destination, purpose });
  if (!otpDoc) return { ok: false, message: "Invalid or expired code" };
  if (new Date() > otpDoc.expiresAt) {
    await AdminOtp.deleteOne({ _id: otpDoc._id });
    return { ok: false, message: "Code has expired" };
  }
  if (otpDoc.otpHash !== hashValue(otp)) {
    return { ok: false, message: "Invalid or expired code" };
  }
  otpDoc.verifiedAt = new Date();
  await otpDoc.save();
  return { ok: true, otpDoc };
};

// ----------------------
// 1. SEND OTP (phone only - no user check)
// ----------------------
router.post("/send-otp", async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone || !String(phone).trim())
      return res.status(400).json({ message: "Phone number is required" });

    const normalizedPhone = String(phone).trim();
    const otp = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await Otp.findOneAndUpdate(
      { phone: normalizedPhone },
      { otp, expiresAt },
      { upsert: true, new: true }
    );

    // Send SMS via Twilio
    const smsResult = await sendOtpSms(normalizedPhone, otp);
    if (!smsResult.success) {
      if (process.env.NODE_ENV !== "production") {
        return res.json({
          message: "OTP generated (Twilio not configured - use devOtp for testing)",
          devOtp: otp,
        });
      }
      return res.status(503).json({ message: "Failed to send OTP" });
    }

    res.json({
      message: "OTP sent successfully",
      ...(process.env.NODE_ENV !== "production" && { devOtp: otp }),
    });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

// ----------------------
// 2. VERIFY OTP (phone + otp) -> login if exists, else needsRegistration
// ----------------------
router.post("/verify-otp", async (req, res) => {
  try {
    const { phone, otp } = req.body;
    if (!phone || !otp)
      return res
        .status(400)
        .json({ message: "Phone number and OTP are required" });

    const normalizedPhone = String(phone).trim();
    const otpDoc = await Otp.findOne({
      phone: normalizedPhone,
      otp: String(otp).trim(),
    });

    if (!otpDoc)
      return res.status(401).json({ message: "Invalid or expired OTP" });
    if (new Date() > otpDoc.expiresAt)
      return res.status(401).json({ message: "OTP has expired" });

    await Otp.deleteOne({ _id: otpDoc._id });

    const user = await User.findOne({ phone: normalizedPhone });
    if (user) {
      if (user.isBlocked) {
        const reason = String(user.blockReason || "").trim();
        return res.status(403).json({
          message: reason
            ? `Your account is blocked. Reason: ${reason}. Please contact support.`
            : "Your account is blocked. Please contact support.",
        });
      }
      const isMrApp = String(req.headers["x-app"] || "").toLowerCase() === "mr";
      if (isMrApp && user.role !== "agent") {
        return res.status(403).json({
          message: "This app is for agents only. Your number is registered as a customer.",
          code: "NOT_AGENT",
        });
      }
      const userObj = user.toObject();
      delete userObj.password;
      return res.json({
        message: "Login successful",
        user: userObj,
        token: generateToken({ id: user._id }),
      });
    }

    // First-time user: return tempToken for complete-registration
    const tempToken = generateToken(
      { phone: normalizedPhone, verified: true },
      "10m"
    );
    res.json({
      message: "Complete registration",
      needsRegistration: true,
      phone: normalizedPhone,
      tempToken,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

// ----------------------
// 3. COMPLETE REGISTRATION (first-time user: name, email, referralCode)
// Retailer app (no x-app): role "user", referredBy from agent's referralCode.
// MR app (x-app: mr): role "agent", create Agent, referralCode from Agent.
// ----------------------
router.post("/complete-registration", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer "))
      return res.status(401).json({ message: "Temp token required" });

    let decoded;
    try {
      decoded = jwt.verify(
        authHeader.split(" ")[1],
        process.env.JWT_SECRET
      );
    } catch {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
    if (!decoded.verified || !decoded.phone)
      return res.status(401).json({ message: "Invalid token" });

    const { name, email, password, referralCode } = req.body;
    if (!name || !email)
      return res.status(400).json({ message: "Name and email are required" });

    const normalizedEmail = normalizeEmail(email);
    const existingEmail = await User.findOne({ email: normalizedEmail });
    if (existingEmail)
      return res.status(400).json({ message: "Email already registered" });

    const existingPhone = await User.findOne({ phone: decoded.phone });
    if (existingPhone)
      return res.status(400).json({ message: "Phone already registered" });

    // Resolve referrer by referral code: check User first, then Agent (so both agent MRxxx and retailer REFxxx codes work)
    let referredBy = null;
    const code = referralCode != null ? String(referralCode).trim() : "";
    if (code) {
      const codeUpper = code.toUpperCase();
      let referrerUser = await User.findOne({ referralCode: codeUpper });
      if (referrerUser) {
        referredBy = referrerUser._id;
      } else {
        const referrerAgent = await Agent.findOne({ referralCode: codeUpper });
        if (referrerAgent && referrerAgent.user) {
          referredBy = referrerAgent.user;
          // Sync Agent's code to User so future lookups work
          await User.findByIdAndUpdate(referrerAgent.user, { referralCode: codeUpper });
        }
      }
    }

    const isMrApp = String(req.headers["x-app"] || "").toLowerCase() === "mr";
    const trimmedPassword = password != null ? String(password).trim() : "";
    if (trimmedPassword && trimmedPassword.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }
    const passwordToStore = trimmedPassword || crypto.randomBytes(32).toString("hex");
    const hashedPassword = await bcrypt.hash(passwordToStore, 10);

    if (isMrApp) {
      // MR app: create agent + Agent
      const newUser = await User.create({
        name: String(name).trim(),
        email: normalizedEmail,
        phone: decoded.phone,
        password: hashedPassword,
        referredBy,
        role: "agent",
      });

      let referredByAgent = null;
      if (referredBy) {
        const refAgent = await Agent.findOne({ user: referredBy });
        if (refAgent) referredByAgent = refAgent._id;
      }

      const agent = await Agent.create({
        user: newUser._id,
        name: String(name).trim(),
        email: normalizedEmail,
        phone: decoded.phone,
        referredBy: referredByAgent,
      });
      newUser.referralCode = agent.referralCode;
      await newUser.save();

      return res.status(201).json({
        message: "Registration complete",
        user: stripPassword(newUser),
        token: generateToken({ id: newUser._id }),
      });
    }

    // Retailer app: create user only, set referredBy from referral code
    const newUser = await User.create({
      name: String(name).trim(),
      email: normalizedEmail,
      phone: decoded.phone,
      password: hashedPassword,
      referredBy,
      role: "user",
    });

    res.status(201).json({
      message: "Registration complete",
      user: stripPassword(newUser),
      token: generateToken({ id: newUser._id }),
    });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

// ----------------------
// PASSWORD RESET FLOW (phone OTP -> new password)
// ----------------------
router.post("/password-reset/send-otp", async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    if (!phone) return res.status(400).json({ message: "Phone number is required" });

    const user = await User.findOne({ phone });
    if (!user) return res.status(404).json({ message: "No account found for this phone number" });

    const otp = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await Otp.findOneAndUpdate(
      { phone },
      { otp, expiresAt },
      { upsert: true, new: true }
    );

    const smsResult = await sendOtpSms(phone, otp);
    if (!smsResult.success) {
      if (process.env.NODE_ENV !== "production") {
        return res.json({
          message: "OTP generated (Twilio not configured - use devOtp for testing)",
          devOtp: otp,
        });
      }
      return res.status(503).json({ message: "Failed to send OTP" });
    }

    res.json({
      message: "OTP sent successfully",
      ...(process.env.NODE_ENV !== "production" && { devOtp: otp }),
    });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/password-reset/verify-otp", async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    const otp = String(req.body?.otp || "").trim();
    if (!phone || !otp) {
      return res.status(400).json({ message: "Phone number and OTP are required" });
    }

    const otpDoc = await Otp.findOne({ phone, otp });
    if (!otpDoc) return res.status(401).json({ message: "Invalid or expired OTP" });
    if (new Date() > otpDoc.expiresAt) return res.status(401).json({ message: "OTP has expired" });

    const user = await User.findOne({ phone });
    if (!user) return res.status(404).json({ message: "No account found for this phone number" });

    await Otp.deleteOne({ _id: otpDoc._id });

    const tempToken = generateToken({ phone, userId: user._id, passwordReset: true }, "10m");
    res.json({
      message: "OTP verified",
      tempToken,
      user: {
        name: user.name || "",
        email: user.email || "",
        phone: user.phone || phone,
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/password-reset/complete", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Temp token required" });
    }

    let decoded;
    try {
      decoded = jwt.verify(authHeader.split(" ")[1], process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ message: "Invalid or expired token" });
    }

    if (!decoded.passwordReset || !decoded.phone || !decoded.userId) {
      return res.status(401).json({ message: "Invalid token" });
    }

    const { password, email } = req.body;
    const trimmedPassword = String(password || "").trim();
    if (trimmedPassword.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const normalizedEmail = email != null && String(email).trim() !== ""
      ? normalizeEmail(email)
      : "";

    const user = await User.findById(decoded.userId);
    if (!user || normalizePhone(user.phone) !== normalizePhone(decoded.phone)) {
      return res.status(404).json({ message: "User not found" });
    }

    if (normalizedEmail) {
      const existingEmail = await User.findOne({ email: normalizedEmail, _id: { $ne: user._id } });
      if (existingEmail) {
        return res.status(400).json({ message: "Email already registered" });
      }
      user.email = normalizedEmail;
    }

    user.password = await bcrypt.hash(trimmedPassword, 10);
    await user.save();

    res.json({
      message: "Password updated successfully",
      user: stripPassword(user),
      token: generateToken({ id: user._id }),
    });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

// ----------------------
// SIGNUP (email + password, optional referralCode)
// ----------------------
router.post("/signup", async (req, res) => {
  try {
    const { name, email, password, phone, referralCode } = req.body;

    if (!name || !email || !password || !phone)
      return res.status(400).json({ message: "All fields are required" });

    const normalizedEmail = normalizeEmail(email);
    const normalizedPhone = normalizePhone(phone);

    const existingUser = await User.findOne({
      $or: [{ email: normalizedEmail }, { phone: normalizedPhone }],
    });
    if (existingUser) {
      if (existingUser.email === normalizedEmail)
        return res.status(400).json({ message: "Email already exists" });
      return res.status(400).json({ message: "Phone already exists" });
    }

    let referredBy = null;
    if (referralCode && String(referralCode).trim()) {
      const referrer = await User.findOne({
        referralCode: String(referralCode).trim().toUpperCase(),
      });
      if (referrer) referredBy = referrer._id;
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = await User.create({
      name,
      email: normalizedEmail,
      password: hashedPassword,
      phone: normalizedPhone,
      referredBy,
    });

    const userObj = newUser.toObject();
    delete userObj.password;

    res.status(201).json({
      message: "Signup successful",
      user: userObj,
      token: generateToken({ id: newUser._id }),
    });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

// ----------------------
// LOGIN (email + password)
// ----------------------
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = normalizeEmail(email);
    const user = await User.findOne({ email: normalizedEmail });
    if (!user)
      return res.status(401).json({ message: "Invalid email or password" });
    if (!user.password)
      return res.status(401).json({
        message: "This account uses OTP login. Use phone + OTP.",
      });
    if (user.isBlocked)
      return res.status(403).json({
        message: user.blockReason
          ? `Your account is blocked. Reason: ${user.blockReason}. Please contact support.`
          : "Your account is blocked. Please contact support.",
      });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.status(401).json({ message: "Invalid email or password" });

    res.json({
      message: "Login successful",
      user: stripPassword(user),
      token: generateToken({ id: user._id }),
    });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/admin/forgot-password/questions", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!email) return res.status(400).json({ message: "Admin email is required" });

    const user = await User.findOne({ email, role: "admin" }).select("adminSecurityQuestions");
    if (!user) {
      return res.status(404).json({ message: "Admin account not found" });
    }

    const questions = Array.isArray(user.adminSecurityQuestions)
      ? user.adminSecurityQuestions
          .map((item) => String(item?.question || "").trim())
          .filter(Boolean)
      : [];

    if (questions.length !== 3) {
      return res.status(400).json({ message: "Security questions are not configured for this admin" });
    }

    res.json({ questions });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/admin/forgot-password/verify-security-answers", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const securityQuestions = Array.isArray(req.body?.securityQuestions)
      ? req.body.securityQuestions
      : [];

    if (!email) return res.status(400).json({ message: "Admin email is required" });
    if (securityQuestions.length !== 3) {
      return res.status(400).json({ message: "Please answer all 3 security questions" });
    }

    const user = await User.findOne({ email, role: "admin" }).select(
      "adminSecurityQuestions.question adminSecurityQuestions.updatedAt +adminSecurityQuestions.answerHash"
    );
    if (!user) {
      return res.status(404).json({ message: "Admin account not found" });
    }

    const savedQuestions = Array.isArray(user.adminSecurityQuestions) ? user.adminSecurityQuestions : [];
    if (savedQuestions.length !== 3) {
      return res.status(400).json({ message: "Security questions are not configured for this admin" });
    }

    const hasInvalidConfiguredQuestion = savedQuestions.some((item) => {
      const question = String(item?.question || "").trim();
      const answerHash = String(item?.answerHash || "").trim();
      return !question || !answerHash;
    });
    if (hasInvalidConfiguredQuestion) {
      return res.status(400).json({ message: "Security questions are not configured correctly. Please update them from Admin Security." });
    }

    const savedQuestionMap = new Map(
      savedQuestions.map((item) => [String(item?.question || "").trim().toLowerCase(), item])
    );

    const seenQuestions = new Set();
    for (const item of securityQuestions) {
      const question = String(item?.question || "").trim();
      const answer = String(item?.answer || "").trim();

      if (!question || !answer) {
        return res.status(400).json({ message: "Each security question must have an answer" });
      }

      const key = question.toLowerCase();
      if (seenQuestions.has(key)) {
        return res.status(400).json({ message: "Security questions must be unique" });
      }
      seenQuestions.add(key);

      const matchedQuestion = savedQuestionMap.get(key);
      if (!matchedQuestion) {
        return res.status(401).json({ message: "Security question verification failed" });
      }

      const storedHash = String(matchedQuestion?.answerHash || "").trim();
      if (!storedHash) {
        return res.status(400).json({ message: "Security questions are not configured correctly. Please update them from Admin Security." });
      }

      let isAnswerValid = false;
      try {
        isAnswerValid = await bcrypt.compare(answer, storedHash);
      } catch {
        return res.status(400).json({ message: "Security questions are not configured correctly. Please update them from Admin Security." });
      }
      if (!isAnswerValid) {
        return res.status(401).json({ message: "Security question verification failed" });
      }
    }

    const resetToken = generateToken({ id: user._id, purpose: "admin-forgot-password-reset" }, "10m");
    res.json({
      message: "Security questions verified",
      resetToken,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/admin/forgot-password/reset", async (req, res) => {
  try {
    const resetToken = String(req.body?.resetToken || "").trim();
    const newPassword = String(req.body?.newPassword || "").trim();
    const confirmPassword = String(req.body?.confirmPassword || "").trim();

    if (!resetToken) return res.status(400).json({ message: "Reset token is required" });
    if (!newPassword || !confirmPassword) {
      return res.status(400).json({ message: "New password and confirm password are required" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: "New password must be at least 6 characters" });
    }
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ message: "New password and confirm password do not match" });
    }

    let decoded;
    try {
      decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ message: "Reset session expired. Verify security questions again." });
    }

    if (!decoded?.id || decoded?.purpose !== "admin-forgot-password-reset") {
      return res.status(401).json({ message: "Invalid reset token" });
    }

    const user = await User.findOne({ _id: decoded.id, role: "admin" });
    if (!user) {
      return res.status(404).json({ message: "Admin account not found" });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.json({ message: "Password reset successful. Please login with your new password." });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

// ----------------------
// Admin: change own password
// ----------------------
router.put("/admin/password", protect, authorizeRoles("admin"), async (req, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword || "").trim();
    const newPassword = String(req.body?.newPassword || "").trim();
    const confirmPassword = String(req.body?.confirmPassword || "").trim();

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ message: "Current password, new password, and confirm password are required" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: "New password must be at least 6 characters" });
    }
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ message: "New password and confirm password do not match" });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (!user.password) {
      return res.status(400).json({ message: "This account uses OTP login and has no password set" });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Current password is incorrect" });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.json({ message: "Password updated successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/admin/security/verify-password", protect, authorizeRoles("admin"), async (req, res) => {
  try {
    const password = String(req.body?.password || "").trim();
    if (!password) return res.status(400).json({ message: "Password is required" });

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (!user.password) {
      return res.status(400).json({ message: "This account does not have a password set" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ message: "Invalid password" });

    res.json({
      message: "Access verified",
      isPrimaryAdmin: isPrimaryAdminEmail(user.email),
      primaryAdminEmail: PRIMARY_ADMIN_EMAIL,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/admin/security-questions", protect, authorizeRoles("admin"), async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("adminSecurityQuestions");
    if (!user) return res.status(404).json({ message: "User not found" });

    const questions = Array.isArray(user.adminSecurityQuestions)
      ? user.adminSecurityQuestions
          .map((item) => String(item?.question || "").trim())
          .filter(Boolean)
      : [];

    res.json({
      questions,
      total: questions.length,
      configured: questions.length === 3,
      options: ADMIN_SECURITY_QUESTION_OPTIONS,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

router.put("/admin/security-questions", protect, authorizeRoles("admin"), async (req, res) => {
  try {
    const securityQuestions = Array.isArray(req.body?.securityQuestions)
      ? req.body.securityQuestions
      : [];

    if (securityQuestions.length !== 3) {
      return res.status(400).json({ message: "Exactly 3 security questions are required" });
    }

    const seenQuestions = new Set();
    const normalizedItems = [];

    for (const item of securityQuestions) {
      const question = String(item?.question || "").trim();
      const answer = String(item?.answer || "").trim();

      if (!question || !answer) {
        return res.status(400).json({ message: "Each security question must have a question and answer" });
      }
      if (!ADMIN_SECURITY_QUESTION_OPTIONS.includes(question)) {
        return res.status(400).json({ message: "Invalid security question selected" });
      }
      const questionKey = question.toLowerCase();
      if (seenQuestions.has(questionKey)) {
        return res.status(400).json({ message: "Security questions must be unique" });
      }
      if (answer.length < 2 || answer.length > 200) {
        return res.status(400).json({ message: "Each answer must be between 2 and 200 characters" });
      }

      seenQuestions.add(questionKey);
      normalizedItems.push({
        question,
        answerHash: await bcrypt.hash(answer, 10),
        updatedAt: new Date(),
      });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.adminSecurityQuestions = normalizedItems;
    await user.save();

    res.json({
      message: "Security questions updated successfully",
      questions: normalizedItems.map((item) => item.question),
    });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/admin/email-change/request-old", protect, authorizeRoles("admin"), async (req, res) => {
  try {
    if (!isPrimaryAdminEmail(req.user?.email)) {
      return res.status(403).json({ message: "Only primary admin can change the primary email" });
    }

    const currentEmail = normalizeEmail(req.body?.currentEmail || req.user?.email);
    const newEmail = normalizeEmail(req.body?.newEmail);
    if (!currentEmail || !newEmail) {
      return res.status(400).json({ message: "Current email and new email are required" });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (normalizeEmail(user.email) !== currentEmail) {
      return res.status(400).json({ message: "Current email does not match your account" });
    }

    const existing = await User.findOne({ email: newEmail, _id: { $ne: user._id } });
    if (existing) return res.status(400).json({ message: "New email already exists" });

    const otp = await createAdminOtp({
      email: currentEmail,
      destination: currentEmail,
      purpose: "admin-email-change-old",
      meta: { newEmail },
    });

    const sendResult = await sendAdminEmailOtp({
      to: currentEmail,
      otp,
      subject: "Verify your admin email change",
      messagePrefix: "Your verification code for admin email change is",
    });

    if (sendResult?.success === false) {
      return res.json({
        message: `OTP generated locally because email delivery failed: ${sendResult.error || "Mail provider rejected the request"}`,
        mailStatusCode: sendResult.statusCode || null,
        devOtp: otp,
      });
    }

    res.json({ message: "OTP sent to current email", ...(process.env.NODE_ENV !== "production" && { devOtp: otp }) });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/admin/email-change/verify-old", protect, authorizeRoles("admin"), async (req, res) => {
  try {
    if (!isPrimaryAdminEmail(req.user?.email)) {
      return res.status(403).json({ message: "Only primary admin can change the primary email" });
    }

    const currentEmail = normalizeEmail(req.body?.currentEmail || req.user?.email);
    const newEmail = normalizeEmail(req.body?.newEmail);
    const otp = String(req.body?.otp || "").trim();
    if (!currentEmail || !newEmail || !otp) {
      return res.status(400).json({ message: "Current email, new email, and OTP are required" });
    }

    const verification = await verifyAdminOtp({
      email: currentEmail,
      destination: currentEmail,
      purpose: "admin-email-change-old",
      otp,
    });
    if (!verification.ok) return res.status(401).json({ message: verification.message });

    const pendingNewEmail = normalizeEmail(verification.otpDoc.meta?.newEmail);
    if (pendingNewEmail !== newEmail) {
      return res.status(400).json({ message: "New email does not match the pending request" });
    }

    const newOtp = await createAdminOtp({
      email: currentEmail,
      destination: newEmail,
      purpose: "admin-email-change-new",
      meta: { currentEmail },
    });

    const sendResult = await sendAdminEmailOtp({
      to: newEmail,
      otp: newOtp,
      subject: "Verify your new admin email",
      messagePrefix: "Your verification code for the new admin email is",
    });

    if (sendResult?.success === false) {
      return res.json({
        message: `Old email verified. New email OTP generated locally because email delivery failed: ${sendResult.error || "Mail provider rejected the request"}`,
        mailStatusCode: sendResult.statusCode || null,
        devOtp: newOtp,
      });
    }

    res.json({ message: "Old email verified. OTP sent to new email.", ...(process.env.NODE_ENV !== "production" && { devOtp: newOtp }) });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/admin/email-change/verify-new", protect, authorizeRoles("admin"), async (req, res) => {
  try {
    if (!isPrimaryAdminEmail(req.user?.email)) {
      return res.status(403).json({ message: "Only primary admin can change the primary email" });
    }

    const currentEmail = normalizeEmail(req.body?.currentEmail || req.user?.email);
    const newEmail = normalizeEmail(req.body?.newEmail);
    const otp = String(req.body?.otp || "").trim();
    if (!currentEmail || !newEmail || !otp) {
      return res.status(400).json({ message: "Current email, new email, and OTP are required" });
    }

    const verification = await verifyAdminOtp({
      email: currentEmail,
      destination: newEmail,
      purpose: "admin-email-change-new",
      otp,
    });
    if (!verification.ok) return res.status(401).json({ message: verification.message });

    if (normalizeEmail(verification.otpDoc.meta?.currentEmail) !== currentEmail) {
      return res.status(400).json({ message: "Email change request expired or mismatched" });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const existing = await User.findOne({ email: newEmail, _id: { $ne: user._id } });
    if (existing) return res.status(400).json({ message: "New email already exists" });

    user.email = newEmail;
    await user.save();

    await AdminOtp.deleteMany({
      $or: [
        { email: currentEmail, purpose: "admin-email-change-old" },
        { email: currentEmail, purpose: "admin-email-change-new" },
      ],
    });

    res.json({ message: "Email changed successfully", email: user.email });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

// ----------------------
// Admin: add/list/remove admins
// ----------------------
router.get("/admin/users", protect, authorizeRoles("admin"), async (req, res) => {
  try {
    const admins = await User.find({ role: "admin", email: { $ne: PRIMARY_ADMIN_EMAIL } })
      .select("-password")
      .sort({ createdAt: -1 });
    res.json({ total: admins.length, admins, primaryAdminEmail: PRIMARY_ADMIN_EMAIL });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/admin/users", protect, authorizeRoles("admin"), async (req, res) => {
  try {
    if (!isPrimaryAdminEmail(req.user?.email)) {
      return res.status(403).json({ message: "Only primary admin can add new admin users" });
    }

    const name = String(req.body?.name || "").trim();
    const email = normalizeEmail(req.body?.email);
    const phone = normalizePhone(req.body?.phone);
    const password = String(req.body?.password || "").trim();

    if (!name || !email || !phone || !password) {
      return res.status(400).json({ message: "Name, email, phone, and password are required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const existingEmail = await User.findOne({ email });
    if (existingEmail) return res.status(400).json({ message: "Email already exists" });

    const existingPhone = await User.findOne({ phone });
    if (existingPhone) return res.status(400).json({ message: "Phone already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const admin = await User.create({
      name,
      email,
      phone,
      password: hashedPassword,
      role: "admin",
      isVerified: true,
    });

    res.status(201).json({
      message: "Admin created successfully",
      admin: stripPassword(admin),
    });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

router.delete("/admin/users/:userId", protect, authorizeRoles("admin"), async (req, res) => {
  try {
    if (!isPrimaryAdminEmail(req.user?.email)) {
      return res.status(403).json({ message: "Only primary admin can remove admin users" });
    }

    const { userId } = req.params;
    if (String(req.user?._id) === String(userId)) {
      return res.status(400).json({ message: "You cannot remove your own admin account" });
    }

    const admin = await User.findById(userId);
    if (!admin) return res.status(404).json({ message: "Admin not found" });
    if (admin.role !== "admin") {
      return res.status(400).json({ message: "Selected user is not an admin" });
    }
    if (isPrimaryAdminEmail(admin.email)) {
      return res.status(400).json({ message: "Primary admin account cannot be removed" });
    }

    await User.deleteOne({ _id: admin._id });
    res.json({ message: "Admin removed successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

// ----------------------
// KYC Submission (protected, upload docs)
// ----------------------
router.put(
  "/kyc",
  protect,
  upload.fields([
    { name: "aadharDoc", maxCount: 1 },
    { name: "drugLicenseDoc", maxCount: 1 },
    { name: "gstDoc", maxCount: 1 },
    { name: "panDoc", maxCount: 1 },
    { name: "shopImage", maxCount: 1 },
    { name: "cancelChequeDoc", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const user = await User.findById(req.user._id);
      if (!user) return res.status(404).json({ message: "User not found" });

      const {
        aadharNumber,
        drugLicenseNumber,
        gstNumber,
        panNumber,
        bankName,
        accountHolderName,
        accountNumber,
        ifscCode,
      } = req.body;

      const normalizedDrugLicenseNumber = String(drugLicenseNumber || "").trim();
      const normalizedGstNumber = String(gstNumber || "").trim().toUpperCase();
      const normalizedBankName = String(bankName || "").trim();
      const normalizedAccountHolderName = String(accountHolderName || "").trim();
      const normalizedAccountNumber = String(accountNumber || "").trim();
      const normalizedIfscCode = String(ifscCode || "").trim().toUpperCase();
      const files = req.files;

      const effectiveDrugLicenseDoc = files?.drugLicenseDoc?.[0] || user.drugLicenseDoc;
      const effectiveCancelChequeDoc = files?.cancelChequeDoc?.[0] || user.cancelChequeDoc;
      const effectiveGstDoc = files?.gstDoc?.[0] || user.gstDoc;
      const effectiveGstNumber = normalizedGstNumber || String(user.gstNumber || "").trim().toUpperCase();

      if (!normalizedDrugLicenseNumber && !String(user.drugLicenseNumber || "").trim()) {
        return res.status(400).json({ message: "Drug license number is required" });
      }
      if (!effectiveDrugLicenseDoc) {
        return res.status(400).json({ message: "Upload drug license document" });
      }
      if (!normalizedBankName && !String(user.bankName || "").trim()) {
        return res.status(400).json({ message: "Bank name is required" });
      }
      if (!normalizedAccountHolderName && !String(user.accountHolderName || "").trim()) {
        return res.status(400).json({ message: "Account holder name is required" });
      }
      if (!normalizedAccountNumber && !String(user.accountNumber || "").trim()) {
        return res.status(400).json({ message: "Account number is required" });
      }
      if (normalizedAccountNumber && !ACCOUNT_NUMBER_REGEX.test(normalizedAccountNumber)) {
        return res.status(400).json({ message: "Account number must be 9-18 digits" });
      }
      if (!normalizedIfscCode && !String(user.ifscCode || "").trim()) {
        return res.status(400).json({ message: "IFSC code is required" });
      }
      if (normalizedIfscCode && !IFSC_REGEX.test(normalizedIfscCode)) {
        return res.status(400).json({ message: "Invalid IFSC code. Example: SBIN0001234" });
      }
      if (!effectiveCancelChequeDoc) {
        return res.status(400).json({ message: "Upload cancel cheque or passbook document" });
      }
      if (effectiveGstNumber && !GST_REGEX.test(effectiveGstNumber)) {
        return res.status(400).json({ message: "Invalid GST number. Enter a valid 15-character GSTIN" });
      }
      if (effectiveGstDoc && !effectiveGstNumber) {
        return res.status(400).json({ message: "GST number is required when GST certificate is uploaded" });
      }

      if (aadharNumber) user.aadharNumber = aadharNumber;
      if (normalizedDrugLicenseNumber) user.drugLicenseNumber = normalizedDrugLicenseNumber;
      if (normalizedGstNumber) user.gstNumber = normalizedGstNumber;
      if (panNumber) user.panNumber = panNumber;
      if (normalizedBankName) user.bankName = normalizedBankName;
      if (normalizedAccountHolderName) user.accountHolderName = normalizedAccountHolderName;
      if (normalizedAccountNumber) user.accountNumber = normalizedAccountNumber;
      if (normalizedIfscCode) user.ifscCode = normalizedIfscCode;
      if (files?.aadharDoc)
        user.aadharDoc = `kyc/${files.aadharDoc[0].filename}`;
      if (files?.drugLicenseDoc)
        user.drugLicenseDoc = `kyc/${files.drugLicenseDoc[0].filename}`;
      if (files?.gstDoc)
        user.gstDoc = `kyc/${files.gstDoc[0].filename}`;
      if (files?.panDoc)
        user.panDoc = `kyc/${files.panDoc[0].filename}`;
      if (files?.shopImage)
        user.shopImage = `kyc/${files.shopImage[0].filename}`;
      if (files?.cancelChequeDoc)
        user.cancelChequeDoc = `kyc/${files.cancelChequeDoc[0].filename}`;

      user.kyc = "PENDING";
      await user.save();

      const agent = await Agent.findOne({ user: user._id });
      if (agent) {
        agent.aadharNumber = user.aadharNumber;
        agent.panNumber = user.panNumber;
        agent.drugLicenseNumber = user.drugLicenseNumber;
        agent.gstNumber = user.gstNumber;
        agent.bankName = user.bankName;
        agent.accountHolderName = user.accountHolderName;
        agent.accountNumber = user.accountNumber;
        agent.ifscCode = user.ifscCode;
        agent.kycStatus = "PENDING";
        if (files?.aadharDoc) agent.aadharDoc = `kyc/${files.aadharDoc[0].filename}`;
        if (files?.panDoc) agent.panDoc = `kyc/${files.panDoc[0].filename}`;
        if (files?.cancelChequeDoc) agent.cancelChequeDoc = `kyc/${files.cancelChequeDoc[0].filename}`;
        if (files?.drugLicenseDoc) agent.drugLicenseDoc = `kyc/${files.drugLicenseDoc[0].filename}`;
        if (files?.gstDoc) agent.gstDoc = `kyc/${files.gstDoc[0].filename}`;
        await agent.save();
      }

      const userObj = user.toObject();
      delete userObj.password;

      res.json({ message: "KYC submitted successfully", user: userObj });
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  }
);

// ----------------------
// Get commission summary + history (MR app; uses Agent + Commission)
// ----------------------
router.get("/commission", protect, requireAgent, async (req, res) => {
  try {
    const agent = await Agent.findOne({ user: req.user._id });
    if (!agent) {
      return res.json({ totalEarned: 0, pending: 0, entries: [] });
    }
    const Commission = (await import("../model/Commission.js")).default;
    const entries = await Commission.find({ agent: agent._id })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    res.json({
      totalEarned: agent.totalEarned ?? 0,
      pending: agent.totalPending ?? 0,
      entries: entries.map((e) => ({
        _id: e._id,
        amount: e.amount,
        type: e.type,
        description: e.description,
        status: e.status,
        createdAt: e.createdAt,
      })),
    });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// ----------------------
// Get my profile (includes referralCode, referredBy)
// For agents: ensure referralCode is set from Agent if missing on User
// ----------------------
router.get("/me", protect, async (req, res) => {
  try {
    let user = await User.findById(req.user._id)
      .select("-password")
      .populate("referredBy", "name referralCode");
    if (!user) return res.status(404).json({ message: "User not found" });

    if (user.role === "agent" && !user.referralCode) {
      const agent = await Agent.findOne({ user: user._id });
      if (agent && agent.referralCode) {
        user.referralCode = agent.referralCode;
        await user.save();
      }
    }

    const userObj = user.toObject();
    if (userObj.role === "admin") {
      userObj.isPrimaryAdmin = isPrimaryAdminEmail(userObj.email);
      userObj.primaryAdminEmail = PRIMARY_ADMIN_EMAIL;
    }

    res.json(userObj);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

// ----------------------
// Update my profile (name, email)
// ----------------------
router.put("/me", protect, async (req, res) => {
  try {
    const { name, email } = req.body;
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (name) user.name = String(name).trim();
    if (email) {
      const normalizedEmail = String(email).trim().toLowerCase();
      const existing = await User.findOne({ email: normalizedEmail, _id: { $ne: user._id } });
      if (existing) return res.status(400).json({ message: "Email already in use" });
      user.email = normalizedEmail;
    }

    await user.save();
    const userObj = user.toObject();
    delete userObj.password;
    res.json(userObj);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

// ----------------------
// Get all users (admin only)
// ----------------------
router.get("/users", protect, authorizeRoles("admin"), async (req, res) => {
  try {
    const users = await User.find()
      .select("-password")
      .populate("referredBy", "name referralCode")
      .sort({ createdAt: -1 });
    res.json({ total: users.length, users });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

// ----------------------
// Get deleted users history (admin only)
// ----------------------
router.get("/users/deleted-history", protect, authorizeRoles("admin"), async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const history = await DeletedUserHistory.find()
      .sort({ deletedAt: -1 })
      .limit(limit)
      .lean();
    res.json({ total: history.length, history });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

// ----------------------
// Delete user (admin only)
// ----------------------
router.delete("/users/:userId", protect, authorizeRoles("admin"), async (req, res) => {
  try {
    const { userId } = req.params;
    if (String(req.user?._id) === String(userId)) {
      return res.status(400).json({ message: "You cannot delete your own admin account" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.role === "agent") {
      const Agent = (await import("../model/Agent.js")).default;
      await Agent.deleteOne({ user: user._id });
    }

    await DeletedUserHistory.create({
      deletedUserId: String(user._id),
      name: user.name || "",
      email: user.email || "",
      phone: user.phone || "",
      role: user.role || "",
      kyc: user.kyc || "",
      isBlocked: !!user.isBlocked,
      deletedBy: req.user?._id || null,
      deletedByEmail: req.user?.email || "",
      deletedAt: new Date(),
    });

    await User.deleteOne({ _id: user._id });
    res.json({ message: "User deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

// ----------------------
// Block or unblock user (admin only)
// ----------------------
router.patch("/users/:userId/block", protect, authorizeRoles("admin"), async (req, res) => {
  try {
    const { userId } = req.params;
    const { isBlocked, reason } = req.body;

    if (typeof isBlocked !== "boolean") {
      return res.status(400).json({ message: "isBlocked must be boolean" });
    }
    if (isBlocked && !String(reason || "").trim()) {
      return res.status(400).json({ message: "Block reason is required" });
    }
    if (String(req.user?._id) === String(userId) && isBlocked) {
      return res.status(400).json({ message: "You cannot block your own account" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.isBlocked = isBlocked;
    user.blockReason = isBlocked ? String(reason || "").trim() : "";
    await user.save();

    res.json({
      message: isBlocked ? "User blocked successfully" : "User unblocked successfully",
      user: stripPassword(user),
    });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

// ----------------------
// Update KYC status (admin only)
// ----------------------
router.put("/kyc-status/:userId", protect, authorizeRoles("admin"), async (req, res) => {
  try {
    let status = req.body?.status ?? req.body?.kycStatus;
    const rejectionReason = String(req.body?.rejectionReason || "").trim();
    if (status === undefined && typeof req.body?.isVerified === "boolean")
      status = req.body.isVerified ? "APPROVED" : "REJECTED";
    const valid = ["APPROVED", "REJECTED", "PENDING", "BLANK"];
    if (!status || !valid.includes(status))
      return res
        .status(400)
        .json({ message: `Status must be one of: ${valid.join(", ")}` });
    if (status === "REJECTED" && !rejectionReason) {
      return res.status(400).json({ message: "Rejection reason is required for REJECTED status" });
    }

    const user = await User.findById(req.params.userId);
    if (!user)
      return res.status(404).json({ message: "User not found" });

    const wasApproved = user.kyc === "APPROVED";
    user.kyc = status;
    user.isVerified = status === "APPROVED";
    user.kycRejectionReason = status === "REJECTED" ? rejectionReason : "";
    await user.save();

    // Referral rewards when KYC approved first time (referee = user whose KYC was just approved)
    // R→R: both get ₹50; MR→R: MR ₹500, retailer ₹50; MR→MR: both MRs get ₹700
    if (status === "APPROVED" && !wasApproved && user.referredBy && !user.referralBonusCredited) {
      const Wallet = (await import("../model/Wallet.js")).default;
      const Config = (await import("../model/Config.js")).default;
      const Commission = (await import("../model/Commission.js")).default;
      const Agent = (await import("../model/Agent.js")).default;
      const configDoc = await Config.findOne({ key: "referralRewards" });
      const rewards = configDoc?.value && typeof configDoc.value === "object"
        ? {
            retailerReferrer: 50,
            retailerReferee: 50,
            mrToRetailerMr: 500,
            mrToRetailerRetailer: 50,
            mrToMr: 700,
            mrToMrReferrer: 700,
            mrToMrReferee: 500,
            ...configDoc.value,
          }
        : {
            retailerReferrer: 50,
            retailerReferee: 50,
            mrToRetailerMr: 500,
            mrToRetailerRetailer: 50,
            mrToMr: 700,
            mrToMrReferrer: 700,
            mrToMrReferee: 500,
          };
      const referrerId = user.referredBy?._id ?? user.referredBy;
      const refereeId = user._id;
      const refereeName = user.name || user.phone || "User";

      const creditWallet = async (userId, amount, desc) => {
        if (!amount || amount <= 0) return;
        let w = await Wallet.findOne({ user: userId });
        if (!w) w = await Wallet.create({ user: userId, balance: 0 });
        const newBal = (w.balance ?? 0) + amount;
        w.balance = newBal;
        w.transactions.push({
          amount,
          type: "CREDIT",
          description: desc,
          reference: `REF-${refereeId}`,
          balanceAfter: newBal,
        });
        await w.save();
      };

      const referrer = await User.findById(referrerId);
      const referrerAgent = referrer ? await Agent.findOne({ user: referrerId }) : null;
      const refereeAgent = await Agent.findOne({ user: refereeId });

      if (referrerAgent && refereeAgent) {
        // MR → MR: separate amounts for referrer and new MR
        const refAmt = Number(
          rewards.mrToMrReferrer ?? rewards.mrToMr
        ) || 0;
        const newAmt = Number(
          rewards.mrToMrReferee ?? rewards.mrToMr
        ) || 0;

        if (refAmt > 0) {
          const referrerName = (referrer && (referrer.name || referrer.phone)) || "MR";

          // Referrer MR
          referrerAgent.totalEarned = (referrerAgent.totalEarned || 0) + refAmt;
          await referrerAgent.save();
          await Commission.create({
            agent: referrerAgent._id,
            amount: refAmt,
            type: "REFERRAL",
            description: `Referred MR: ${refereeName}`,
            status: "CREDITED",
            reference: String(refereeId),
          });
          await creditWallet(referrerId, refAmt, "Referral bonus (MR referred)");
        }

        if (newAmt > 0) {
          const referrerName = (referrer && (referrer.name || referrer.phone)) || "MR";

          // New MR (referee)
          refereeAgent.totalEarned = (refereeAgent.totalEarned || 0) + newAmt;
          await refereeAgent.save();
          await Commission.create({
            agent: refereeAgent._id,
            amount: newAmt,
            type: "BONUS",
            description: `Signup bonus via MR referral: ${referrerName}`,
            status: "CREDITED",
            reference: String(referrerId),
          });
          await creditWallet(
            refereeId,
            newAmt,
            "Referral bonus (Joined with MR referral)"
          );
        }
      } else if (referrerAgent && !refereeAgent) {
        // MR → Retailer: MR gets ₹500, retailer gets ₹50 (Commission + Wallet for both)
        const mrAmt = Number(rewards.mrToRetailerMr) || 0;
        const retailAmt = Number(rewards.mrToRetailerRetailer) || 0;
        if (mrAmt > 0) {
          referrerAgent.retailersOnboarded = (referrerAgent.retailersOnboarded || 0) + 1;
          referrerAgent.totalEarned = (referrerAgent.totalEarned || 0) + mrAmt;
          await referrerAgent.save();
          await Commission.create({
            agent: referrerAgent._id,
            amount: mrAmt,
            type: "REFERRAL",
            description: `Retailer KYC approved: ${refereeName}`,
            status: "CREDITED",
            reference: String(refereeId),
          });
          await creditWallet(referrerId, mrAmt, "Referral bonus (Retailer KYC approved)");
        }
        if (retailAmt > 0) {
          await creditWallet(refereeId, retailAmt, "Referral bonus (KYC completed)");
        }
      } else {
        // Retailer → Retailer: both get ₹50
        const referrerAmt = Number(rewards.retailerReferrer) || 0;
        const refereeAmt = Number(rewards.retailerReferee) || 0;
        if (referrerAmt > 0) {
          await creditWallet(referrerId, referrerAmt, "Referral bonus (KYC completed)");
        }
        if (refereeAmt > 0) {
          await creditWallet(refereeId, refereeAmt, "Referral bonus (KYC completed)");
        }
      }

      user.referralBonusCredited = true;
      await user.save();
    }

    const obj = user.toObject();
    delete obj.password;

    res.json({ message: "KYC status updated", user: obj });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

// ----------------------
// Admin: reprocess referral reward for a user (e.g. KYC was approved but reward was not credited)
// ----------------------

router.post(
  "/reprocess-referral-reward/:userId",
  protect,
  authorizeRoles("admin"),
  async (req, res) => {
    try {
      const user = await User.findById(req.params.userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      if (user.kyc !== "APPROVED")
        return res.status(400).json({ message: "User KYC is not APPROVED" });
      if (!user.referredBy)
        return res.status(400).json({ message: "User was not referred by anyone" });
      if (user.referralBonusCredited)
        return res.status(400).json({ message: "Referral bonus already credited for this user" });

      const Wallet = (await import("../model/Wallet.js")).default;
      const Config = (await import("../model/Config.js")).default;
      const Commission = (await import("../model/Commission.js")).default;
      const Agent = (await import("../model/Agent.js")).default;
      const configDoc = await Config.findOne({ key: "referralRewards" });
      const rewards = configDoc?.value && typeof configDoc.value === "object"
        ? { retailerReferrer: 50, retailerReferee: 50, mrToRetailerMr: 500, mrToRetailerRetailer: 50, mrToMr: 700, ...configDoc.value }
        : { retailerReferrer: 50, retailerReferee: 50, mrToRetailerMr: 500, mrToRetailerRetailer: 50, mrToMr: 700 };
      const referrerId = user.referredBy?._id ?? user.referredBy;
      const refereeId = user._id;
      const refereeName = user.name || user.phone || "User";

      const creditWallet = async (userId, amount, desc) => {
        if (!amount || amount <= 0) return;
        let w = await Wallet.findOne({ user: userId });
        if (!w) w = await Wallet.create({ user: userId, balance: 0 });
        const newBal = (w.balance ?? 0) + amount;
        w.balance = newBal;
        w.transactions.push({
          amount,
          type: "CREDIT",
          description: desc,
          reference: `REF-${refereeId}`,
          balanceAfter: newBal,
        });
        await w.save();
      };

      const referrer = await User.findById(referrerId);
      const referrerAgent = referrer ? await Agent.findOne({ user: referrerId }) : null;
      const refereeAgent = await Agent.findOne({ user: refereeId });

      if (referrerAgent && refereeAgent) {
        const amt = Number(rewards.mrToMr) || 0;
        if (amt > 0) {
          const referrerName = (referrer && (referrer.name || referrer.phone)) || "MR";

          // Referrer MR
          referrerAgent.totalEarned = (referrerAgent.totalEarned || 0) + amt;
          await referrerAgent.save();
          await Commission.create({
            agent: referrerAgent._id,
            amount: amt,
            type: "REFERRAL",
            description: `Referred MR: ${refereeName}`,
            status: "CREDITED",
            reference: String(refereeId),
          });
          await creditWallet(referrerId, amt, "Referral bonus (MR referred)");

          // New MR (referee)
          refereeAgent.totalEarned = (refereeAgent.totalEarned || 0) + amt;
          await refereeAgent.save();
          await Commission.create({
            agent: refereeAgent._id,
            amount: amt,
            type: "BONUS",
            description: `Signup bonus via MR referral: ${referrerName}`,
            status: "CREDITED",
            reference: String(referrerId),
          });
          await creditWallet(refereeId, amt, "Referral bonus (Joined with MR referral)");
        }
      } else if (referrerAgent && !refereeAgent) {
        const mrAmt = Number(rewards.mrToRetailerMr) || 0;
        const retailAmt = Number(rewards.mrToRetailerRetailer) || 0;
        if (mrAmt > 0) {
          referrerAgent.retailersOnboarded = (referrerAgent.retailersOnboarded || 0) + 1;
          referrerAgent.totalEarned = (referrerAgent.totalEarned || 0) + mrAmt;
          await referrerAgent.save();
          await Commission.create({
            agent: referrerAgent._id,
            amount: mrAmt,
            type: "REFERRAL",
            description: `Retailer KYC approved: ${refereeName}`,
            status: "CREDITED",
            reference: String(refereeId),
          });
          await creditWallet(referrerId, mrAmt, "Referral bonus (Retailer KYC approved)");
        }
        if (retailAmt > 0) {
          await creditWallet(refereeId, retailAmt, "Referral bonus (KYC completed)");
        }
      } else {
        const referrerAmt = Number(rewards.retailerReferrer) || 0;
        const refereeAmt = Number(rewards.retailerReferee) || 0;
        if (referrerAmt > 0) {
          await creditWallet(referrerId, referrerAmt, "Referral bonus (KYC completed)");
        }
        if (refereeAmt > 0) {
          await creditWallet(refereeId, refereeAmt, "Referral bonus (KYC completed)");
        }
      }

      user.referralBonusCredited = true;
      await user.save();

      res.json({
        message: "Referral reward credited successfully",
        credited: true,
        user: { _id: user._id, referralBonusCredited: user.referralBonusCredited },
      });
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  }
);

export default router;
