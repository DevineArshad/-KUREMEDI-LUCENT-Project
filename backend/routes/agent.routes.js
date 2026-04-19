import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";
import Agent from "../model/Agent.js";
import Commission from "../model/Commission.js";
import Withdrawal from "../model/Withdrawal.js";
import User from "../model/User.js";
import Wallet from "../model/Wallet.js";
import { protect } from "../middleware/protect.js";
import { authorizeRoles } from "../middleware/authorize.js";
import { requireAgent } from "../middleware/requireAgent.js";
import {
  createAgentWithdrawalPayout,
  isPayoutAutomationEnabled,
} from "../utils/razorpayPayout.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();

const agentUploadDir = "uploads/agents";
if (!fs.existsSync("uploads")) fs.mkdirSync("uploads", { recursive: true });
if (!fs.existsSync(agentUploadDir)) fs.mkdirSync(agentUploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, agentUploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `${Date.now()}-${crypto.randomInt(1000, 9999)}${ext}`);
  },
});
const upload = multer({
  storage,
});

// ---------- Admin: list all agents ----------
router.get(
  "/",
  protect,
  authorizeRoles("admin"),
  async (req, res) => {
    try {
      const { status } = req.query;
      const filter = status ? { status } : {};
      const agents = await Agent.find(filter)
        .populate("user", "name email phone")
        .populate("referredBy", "name referralCode")
        .sort({ createdAt: -1 });
      const total = agents.length;
      const active = agents.filter((a) => a.status === "Active").length;
      const pending = agents.filter((a) => a.status === "Pending").length;
      const inactive = agents.filter((a) => a.status === "Inactive").length;
      const retailers = agents.reduce((s, a) => s + (a.retailersOnboarded || 0), 0);
      const payout = agents.reduce((s, a) => s + (a.totalPending || 0), 0);
      res.json({
        total,
        active,
        pending,
        inactive,
        retailers,
        payout,
        agents,
      });
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  }
);

// ---------- Admin: all referral tracking (agent → retailers) ----------
router.get(
  "/referrals",
  protect,
  authorizeRoles("admin"),
  async (req, res) => {
    try {
      const User = (await import("../model/User.js")).default;
      const referredUsers = await User.find({ referredBy: { $exists: true, $ne: null } })
        .select("name email phone kyc referralBonusCredited createdAt referredBy")
        .sort({ createdAt: -1 })
        .lean();
      const referrerUserIds = [...new Set(referredUsers.map((u) => u.referredBy).filter(Boolean))];
      const refereeUserIds = referredUsers.map((u) => u._id);
      const [agents, referrerUsers] = await Promise.all([
        Agent.find({ user: { $in: referrerUserIds.concat(refereeUserIds) } }).select("name phone referralCode user").lean(),
        User.find({ _id: { $in: referrerUserIds } }).select("name referralCode").lean(),
      ]);
      const agentByUserId = {};
      agents.forEach((a) => { agentByUserId[String(a.user)] = a; });
      const userById = {};
      referrerUsers.forEach((u) => { userById[String(u._id)] = { name: u.name, referralCode: u.referralCode }; });
      const list = referredUsers.map((u) => {
        const referrerIsMr = u.referredBy && agentByUserId[String(u.referredBy)];
        const refereeIsMr = agentByUserId[String(u._id)];
        const type = referrerIsMr && refereeIsMr ? "MR→MR" : referrerIsMr ? "MR→R" : refereeIsMr ? "R→MR" : "R→R";
        const agent = u.referredBy ? agentByUserId[String(u.referredBy)] : null;
        const referrerUser = u.referredBy && !agent ? userById[String(u.referredBy)] : null;
        return {
          retailer: { _id: u._id, name: u.name, phone: u.phone, email: u.email, kyc: u.kyc || "BLANK", credited: !!u.referralBonusCredited, createdAt: u.createdAt },
          agent: agent,
          referrerUser: referrerUser,
          referralType: type,
        };
      });
      res.json({ total: list.length, referrals: list });
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  }
);

// ---------- Admin: list all withdrawal requests ----------
router.get(
  "/withdrawals",
  protect,
  authorizeRoles("admin"),
  async (req, res) => {
    try {
      const statusFilter = req.query.status; // optional: PENDING, APPROVED, REJECTED
      const match = statusFilter && ["PENDING", "APPROVED", "REJECTED"].includes(String(statusFilter))
        ? { status: statusFilter }
        : {};
      const list = await Withdrawal.find(match)
        .populate("agent", "name phone referralCode")
        .sort({ createdAt: -1 })
        .limit(200)
        .lean();
      res.json({ total: list.length, withdrawals: list });
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  }
);

// ---------- Admin: approve or reject withdrawal ----------
router.patch(
  "/withdrawals/:id",
  protect,
  authorizeRoles("admin"),
  async (req, res) => {
    try {
      const { status, adminNote } = req.body;
      if (!status || !["APPROVED", "REJECTED"].includes(status))
        return res.status(400).json({ message: "status must be APPROVED or REJECTED" });
      const withdrawal = await Withdrawal.findById(req.params.id);
      if (!withdrawal) return res.status(404).json({ message: "Withdrawal not found" });
      if (withdrawal.status !== "PENDING")
        return res.status(400).json({ message: "Withdrawal already processed" });
      withdrawal.status = status;
      if (typeof adminNote === "string") withdrawal.adminNote = adminNote.trim().slice(0, 500);
      withdrawal.processedAt = new Date();

      if (status === "APPROVED" && isPayoutAutomationEnabled()) {
        const agent = await Agent.findById(withdrawal.agent).lean();
        if (!agent) {
          return res.status(404).json({ message: "Linked agent not found for this withdrawal" });
        }

        const user = agent.user ? await User.findById(agent.user).select("name email phone").lean() : null;

        try {
          const payout = await createAgentWithdrawalPayout({
            withdrawal,
            agent,
            user,
          });

          withdrawal.payoutProvider = "RAZORPAYX";
          withdrawal.payoutId = payout.payoutId;
          withdrawal.payoutStatus = payout.payoutStatus;
          withdrawal.payoutError = undefined;
          if (payout.payoutStatus === "PROCESSED") {
            withdrawal.payoutProcessedAt = new Date();
          }
        } catch (payoutErr) {
          withdrawal.payoutProvider = "RAZORPAYX";
          withdrawal.payoutStatus = "FAILED";
          withdrawal.payoutError = String(payoutErr?.message || "Payout initiation failed").slice(0, 500);
        }
      }

      await withdrawal.save();
      res.json(withdrawal);
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  }
);

// ---------- MR app: get my agent profile (by user id from auth) ----------
router.get("/me/profile", protect, requireAgent, async (req, res) => {
  try {
    const agent = await Agent.findOne({ user: req.user._id })
      .populate("referredBy", "name referralCode");
    if (!agent) return res.status(404).json({ message: "Agent profile not found" });
    res.json(agent);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// ---------- MR app: commission summary + history ----------
// totalEarned is synced from Commission entries if Agent.totalEarned is lower (fixes missed credits)
router.get("/me/commission", protect, requireAgent, async (req, res) => {
  try {
    const agent = await Agent.findOne({ user: req.user._id });
    if (!agent) {
      return res.json({ totalEarned: 0, pending: 0, entries: [] });
    }
    const entries = await Commission.find({ agent: agent._id })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    const fromEntries = entries
      .filter((e) => e.status === "CREDITED" || e.status === "PAID_OUT")
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    let totalEarned = Number(agent.totalEarned) || 0;
    if (fromEntries > totalEarned) {
      totalEarned = fromEntries;
      agent.totalEarned = totalEarned;
      await agent.save().catch(() => {});
    }
    const pending = agent.totalPending ?? 0;
    res.json({
      totalEarned,
      pending,
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

// ---------- MR app: list my withdrawal requests ----------
router.get("/me/withdrawals", protect, requireAgent, async (req, res) => {
  try {
    const agent = await Agent.findOne({ user: req.user._id });
    if (!agent) return res.json({ withdrawals: [], totalEarned: 0, alreadyWithdrawn: 0, availableBalance: 0 });
    const withdrawals = await Withdrawal.find({ agent: agent._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    let totalEarned = Number(agent.totalEarned) || 0;
    const fromCommission = await Commission.aggregate([
      { $match: { agent: agent._id, status: { $in: ["CREDITED", "PAID_OUT"] } } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    const fromEntries = fromCommission[0]?.total ?? 0;
    if (fromEntries > totalEarned) {
      totalEarned = fromEntries;
      agent.totalEarned = totalEarned;
      await agent.save().catch(() => {});
    }
    const approvedSum = await Withdrawal.aggregate([
      { $match: { agent: agent._id, status: "APPROVED" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    const alreadyWithdrawn = approvedSum[0]?.total ?? 0;
    const pendingSum = await Withdrawal.aggregate([
      { $match: { agent: agent._id, status: "PENDING" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    const pendingWithdraw = pendingSum[0]?.total ?? 0;
    const availableBalance = Math.max(0, totalEarned - alreadyWithdrawn - pendingWithdraw);
    res.json({
      withdrawals: withdrawals.map((w) => ({
        _id: w._id,
        amount: w.amount,
        status: w.status,
        note: w.note,
        adminNote: w.adminNote,
        createdAt: w.createdAt,
        processedAt: w.processedAt,
      })),
      totalEarned,
      alreadyWithdrawn,
      availableBalance,
    });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// ---------- MR app: request withdrawal ----------
router.post("/me/withdrawals", protect, requireAgent, async (req, res) => {
  try {
    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount < 1) {
      return res.status(400).json({ message: "Invalid amount. Minimum ₹1." });
    }
    const agent = await Agent.findOne({ user: req.user._id });
    if (!agent) return res.status(404).json({ message: "Agent profile not found" });
    let totalEarned = Number(agent.totalEarned) || 0;
    const fromCommission = await Commission.aggregate([
      { $match: { agent: agent._id, status: { $in: ["CREDITED", "PAID_OUT"] } } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    const fromEntries = fromCommission[0]?.total ?? 0;
    if (fromEntries > totalEarned) {
      totalEarned = fromEntries;
      agent.totalEarned = totalEarned;
      await agent.save().catch(() => {});
    }
    const [approvedSum, pendingSum] = await Promise.all([
      Withdrawal.aggregate([
        { $match: { agent: agent._id, status: "APPROVED" } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      Withdrawal.aggregate([
        { $match: { agent: agent._id, status: "PENDING" } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
    ]);
    const alreadyWithdrawn = approvedSum[0]?.total ?? 0;
    const pendingWithdraw = pendingSum[0]?.total ?? 0;
    const availableBalance = Math.max(0, totalEarned - alreadyWithdrawn - pendingWithdraw);
    if (amount > availableBalance) {
      return res.status(400).json({
        message: `Available balance is ₹${availableBalance.toFixed(2)}. You cannot request more.`,
      });
    }
    const withdrawal = await Withdrawal.create({
      agent: agent._id,
      amount: Math.round(amount * 100) / 100,
      status: "PENDING",
      note: typeof req.body.note === "string" ? req.body.note.trim().slice(0, 500) : undefined,
    });
    res.status(201).json({
      _id: withdrawal._id,
      amount: withdrawal.amount,
      status: withdrawal.status,
      note: withdrawal.note,
      createdAt: withdrawal.createdAt,
    });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// ---------- MR app: get my referred users (tracking) - agents and retailers who referred others ----------
// Any user (agent or retailer) can see users they referred (referredBy = their User id)
router.get("/me/referrals", protect, async (req, res) => {
  try {
    const User = (await import("../model/User.js")).default;
    const referrals = await User.find({ referredBy: req.user._id })
      .select("name email phone kyc referralBonusCredited createdAt")
      .sort({ createdAt: -1 })
      .lean();
    const count = referrals.length;
    const kycApproved = referrals.filter((r) => r.kyc === "APPROVED").length;
    res.json({
      count,
      kycApproved,
      referrals: referrals.map((r) => ({
        _id: r._id,
        name: r.name || "—",
        phone: r.phone || "—",
        email: r.email || "—",
        kyc: r.kyc || "BLANK",
        credited: !!r.referralBonusCredited,
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// ---------- MR app: update my agent profile (KYC, bank, etc.) ----------
router.put(
  "/me/profile",
  protect,
  requireAgent,
  upload.fields([
    { name: "profileImage", maxCount: 1 },
    { name: "aadharDoc", maxCount: 1 },
    { name: "panDoc", maxCount: 1 },
    { name: "cancelChequeDoc", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const agent = await Agent.findOne({ user: req.user._id });
      if (!agent) return res.status(404).json({ message: "Agent profile not found" });

      const fields = [
        "name", "email", "phone", "territory",
        "aadharNumber", "panNumber", "gstNumber",
        "bankName", "accountHolderName", "accountNumber", "ifscCode",
      ];
      fields.forEach((f) => {
        if (req.body[f] !== undefined) agent[f] = req.body[f];
      });

      const files = req.files;
      if (files?.profileImage) agent.profileImage = `agents/${files.profileImage[0].filename}`;
      if (files?.aadharDoc) agent.aadharDoc = `agents/${files.aadharDoc[0].filename}`;
      if (files?.panDoc) agent.panDoc = `agents/${files.panDoc[0].filename}`;
      if (files?.cancelChequeDoc) agent.cancelChequeDoc = `agents/${files.cancelChequeDoc[0].filename}`;

      await agent.save();
      res.json(agent);
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  }
);

// ---------- Admin: get one agent ----------
router.get(
  "/:id",
  protect,
  authorizeRoles("admin"),
  async (req, res) => {
    try {
      const agent = await Agent.findById(req.params.id)
        .populate("user", "name email phone kyc")
        .populate("referredBy", "name phone referralCode");
      if (!agent) return res.status(404).json({ message: "Agent not found" });
      res.json(agent);
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  }
);

// ---------- Admin: update agent KYC status (verify) ----------
router.put(
  "/:id/kyc-status",
  protect,
  authorizeRoles("admin"),
  async (req, res) => {
    try {
      const { status } = req.body;
      if (!status || !["APPROVED", "REJECTED", "PENDING"].includes(status))
        return res.status(400).json({ message: "Status must be APPROVED, REJECTED, or PENDING" });

      const agent = await Agent.findById(req.params.id);
      if (!agent) return res.status(404).json({ message: "Agent not found" });

      const hadApprovedKyc = agent.kycStatus === "APPROVED";
      agent.kycStatus = status;
      await agent.save();

      if (agent.user) {
        const user = await User.findById(agent.user);
        if (user) {
          const wasApproved = user.kyc === "APPROVED";
          user.kyc = status;
          user.isVerified = status === "APPROVED";
          await user.save();

          // Mirror referral reward logic used in /auth/kyc-status so that
          // approving MR KYC from the Agents screen also credits bonuses.
          if (
            status === "APPROVED" &&
            !wasApproved &&
            user.referredBy &&
            !user.referralBonusCredited
          ) {
            const Config = (await import("../model/Config.js")).default;
            const configDoc = await Config.findOne({ key: "referralRewards" });
            const rewards =
              configDoc?.value && typeof configDoc.value === "object"
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

            const referrerUser = await User.findById(referrerId);
            const referrerAgent = referrerUser
              ? await Agent.findOne({ user: referrerId })
              : null;
            const refereeAgent = await Agent.findOne({ user: refereeId });

            if (referrerAgent && refereeAgent) {
              // MR → MR
              const refAmt =
                Number(rewards.mrToMrReferrer ?? rewards.mrToMr) || 0;
              const newAmt =
                Number(rewards.mrToMrReferee ?? rewards.mrToMr) || 0;

              if (refAmt > 0) {
                const referrerName =
                  (referrerUser &&
                    (referrerUser.name || referrerUser.phone)) ||
                  "MR";
                referrerAgent.totalEarned =
                  (referrerAgent.totalEarned || 0) + refAmt;
                await referrerAgent.save();
                await Commission.create({
                  agent: referrerAgent._id,
                  amount: refAmt,
                  type: "REFERRAL",
                  description: `Referred MR: ${refereeName}`,
                  status: "CREDITED",
                  reference: String(refereeId),
                });
                await creditWallet(
                  referrerId,
                  refAmt,
                  "Referral bonus (MR referred)"
                );
              }

              if (newAmt > 0) {
                const referrerName =
                  (referrerUser &&
                    (referrerUser.name || referrerUser.phone)) ||
                  "MR";
                refereeAgent.totalEarned =
                  (refereeAgent.totalEarned || 0) + newAmt;
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
              // MR → Retailer
              const mrAmt = Number(rewards.mrToRetailerMr) || 0;
              const retailAmt = Number(rewards.mrToRetailerRetailer) || 0;
              if (mrAmt > 0) {
                referrerAgent.retailersOnboarded =
                  (referrerAgent.retailersOnboarded || 0) + 1;
                referrerAgent.totalEarned =
                  (referrerAgent.totalEarned || 0) + mrAmt;
                await referrerAgent.save();
                await Commission.create({
                  agent: referrerAgent._id,
                  amount: mrAmt,
                  type: "REFERRAL",
                  description: `Retailer KYC approved: ${refereeName}`,
                  status: "CREDITED",
                  reference: String(refereeId),
                });
                await creditWallet(
                  referrerId,
                  mrAmt,
                  "Referral bonus (Retailer KYC approved)"
                );
              }
              if (retailAmt > 0) {
                await creditWallet(
                  refereeId,
                  retailAmt,
                  "Referral bonus (KYC completed)"
                );
              }
            } else {
              // Retailer → Retailer / Retailer → MR
              const referrerAmt =
                Number(rewards.retailerReferrer) || 0;
              const refereeAmt =
                Number(rewards.retailerReferee) || 0;
              if (referrerAmt > 0) {
                await creditWallet(
                  referrerId,
                  referrerAmt,
                  "Referral bonus (KYC completed)"
                );
              }
              if (refereeAmt > 0) {
                await creditWallet(
                  refereeId,
                  refereeAmt,
                  "Referral bonus (KYC completed)"
                );
              }
            }

            user.referralBonusCredited = true;
            await user.save();
          }
        }
      }

      res.json({ message: "KYC status updated", agent });
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  }
);

// ---------- Admin: create agent ----------
// Body may include createWithLogin: true to also create a User so the agent can log in to MR app (same phone/email/name).
router.post(
  "/",
  protect,
  authorizeRoles("admin"),
  async (req, res) => {
    try {
      const {
        name,
        email,
        phone,
        territory,
        address,
        aadharNumber,
        panNumber,
        bankName,
        accountHolderName,
        accountNumber,
        ifscCode,
        referredByCode,
        createWithLogin,
      } = req.body;
      if (!name || !phone)
        return res.status(400).json({ message: "Name and phone are required" });

      const normalizedPhone = String(phone).trim();
      const normalizedEmail = email ? String(email).trim().toLowerCase() : undefined;

      const existingAgent = await Agent.findOne({ phone: normalizedPhone });
      if (existingAgent)
        return res.status(400).json({ message: "Agent with this phone already exists" });

      if (createWithLogin) {
        const existingUser = await User.findOne({
          $or: [{ phone: normalizedPhone }, ...(normalizedEmail ? [{ email: normalizedEmail }] : [])],
        });
        if (existingUser)
          return res.status(400).json({
            message: "A user with this phone or email already exists. Use MR app signup or leave Create MR login unchecked.",
          });
      }

      // Resolve referrer (optional). We track it on both Agent (by Agent id)
      // and on the created User (by User id) so that referral rewards
      // triggered on User KYC approval also work for admin‑created MRs.
      let referredByAgentId = null;
      let referredByUserId = null;
      if (referredByCode) {
        const ref = await Agent.findOne({
          referralCode: String(referredByCode).trim().toUpperCase(),
        }).populate("user", "_id");
        if (ref) {
          referredByAgentId = ref._id;
          if (ref.user) {
            // ref.user can be either ObjectId or populated doc
            referredByUserId =
              typeof ref.user === "object" && "_id" in ref.user
                ? ref.user._id
                : ref.user;
          }
        }
      }

      let userId = null;
      if (createWithLogin) {
        const bcrypt = (await import("bcryptjs")).default;
        const crypto = (await import("crypto")).default;
        const randomPassword = crypto.randomBytes(32).toString("hex");
        const hashedPassword = await bcrypt.hash(randomPassword, 10);
        const newUser = await User.create({
          name: String(name).trim(),
          email: normalizedEmail || undefined,
          phone: normalizedPhone,
          password: hashedPassword,
          role: "agent",
          // For admin‑created MRs, ensure referral chain is stored on User
          // so MR→MR referral bonuses trigger when KYC is approved.
          referredBy: referredByUserId || undefined,
        });
        userId = newUser._id;
      }

      const agent = await Agent.create({
        user: userId,
        name: String(name).trim(),
        email: normalizedEmail,
        phone: normalizedPhone,
        territory: territory ? String(territory).trim() : undefined,
        address: address ? String(address).trim() : undefined,
        aadharNumber: aadharNumber ? String(aadharNumber).trim() : undefined,
        panNumber: panNumber ? String(panNumber).trim() : undefined,
        bankName: bankName ? String(bankName).trim() : undefined,
        accountHolderName: accountHolderName ? String(accountHolderName).trim() : undefined,
        accountNumber: accountNumber ? String(accountNumber).trim() : undefined,
        ifscCode: ifscCode ? String(ifscCode).trim() : undefined,
        referredBy: referredByAgentId,
        status: "Pending",
      });

      if (userId && agent.referralCode) {
        await User.findByIdAndUpdate(userId, { referralCode: agent.referralCode });
      }

      res.status(201).json(agent);
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  }
);

// ---------- Admin: update agent ----------
router.put(
  "/:id",
  protect,
  authorizeRoles("admin"),
  upload.fields([
    { name: "profileImage", maxCount: 1 },
    { name: "aadharDoc", maxCount: 1 },
    { name: "panDoc", maxCount: 1 },
    { name: "cancelChequeDoc", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const agent = await Agent.findById(req.params.id);
      if (!agent) return res.status(404).json({ message: "Agent not found" });

      const fields = [
        "name", "email", "phone", "territory", "address", "status",
        "aadharNumber", "panNumber", "gstNumber",
        "bankName", "accountHolderName", "accountNumber", "ifscCode",
        "kycStatus", "retailersOnboarded", "totalEarned", "totalPending",
      ];
      fields.forEach((f) => {
        if (req.body[f] !== undefined) agent[f] = req.body[f];
      });

      const files = req.files;
      if (files?.profileImage) agent.profileImage = `agents/${files.profileImage[0].filename}`;
      if (files?.aadharDoc) agent.aadharDoc = `agents/${files.aadharDoc[0].filename}`;
      if (files?.panDoc) agent.panDoc = `agents/${files.panDoc[0].filename}`;
      if (files?.cancelChequeDoc) agent.cancelChequeDoc = `agents/${files.cancelChequeDoc[0].filename}`;

      await agent.save();
      res.json(agent);
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  }
);

// ---------- Admin: delete agent ----------
router.delete(
  "/:id",
  protect,
  authorizeRoles("admin"),
  async (req, res) => {
    try {
      const agent = await Agent.findById(req.params.id);
      if (!agent) return res.status(404).json({ message: "Agent not found" });

      if (agent.user) {
        const linkedUser = await User.findById(agent.user);
        if (linkedUser && linkedUser.role === "agent") {
          await User.deleteOne({ _id: linkedUser._id });
        }
      }

      await Agent.deleteOne({ _id: agent._id });
      res.json({ message: "Agent deleted successfully" });
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  }
);

export default router;
