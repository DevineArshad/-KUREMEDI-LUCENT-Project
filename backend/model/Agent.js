import mongoose from "mongoose";
import crypto from "crypto";

const generateReferralCode = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "MR";
  for (let i = 0; i < 8; i++) {
    code += chars[crypto.randomInt(0, chars.length)];
  }
  return code;
};

const agentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    // Profile
    name: { type: String, trim: true, required: true },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      sparse: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    profileImage: { type: String },

    // Territory & status
    territory: { type: String, trim: true },
    address: { type: String, trim: true },
    status: {
      type: String,
      enum: ["Active", "Pending", "Inactive"],
      default: "Pending",
    },

    // KYC
    aadharNumber: { type: String, trim: true },
    aadharDoc: { type: String },
    panNumber: { type: String, trim: true },
    panDoc: { type: String },
    gstNumber: { type: String, trim: true },
    gstDoc: { type: String },
    kycStatus: {
      type: String,
      enum: ["APPROVED", "PENDING", "REJECTED", "BLANK"],
      default: "BLANK",
    },

    // Bank details
    bankName: { type: String, trim: true },
    accountHolderName: { type: String, trim: true },
    accountNumber: { type: String, trim: true },
    ifscCode: { type: String, trim: true },
    cancelChequeDoc: { type: String },

    // Referral
    referralCode: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      uppercase: true,
    },
    referredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Agent",
      default: null,
    },
    referralBonusCredited: { type: Boolean, default: false },

    // Commission (denormalized for quick display; can sync from Wallet)
    totalEarned: { type: Number, default: 0 },
    totalPending: { type: Number, default: 0 },
    retailersOnboarded: { type: Number, default: 0 },
  },
  { timestamps: true }
);

agentSchema.pre("save", async function () {
  if (!this.referralCode) {
    let code;
    let exists = true;
    while (exists) {
      code = generateReferralCode();
      const found = await mongoose.model("Agent").findOne(
        { referralCode: code, _id: { $ne: this._id } },
        { _id: 1 }
      );
      exists = !!found;
    }
    this.referralCode = code;
  }
});

const Agent = mongoose.model("Agent", agentSchema);
export default Agent;
