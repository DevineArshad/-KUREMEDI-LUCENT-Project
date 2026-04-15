import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const generateReferralCode = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "REF";
  for (let i = 0; i < 8; i++) {
    code += chars[crypto.randomInt(0, chars.length)];
  }
  return code;
};

const userSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true },
    email: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
    },
    password: { type: String }, // optional for OTP-only users
    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },

    referralCode: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      uppercase: true,
    },
    referredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    referralBonusCredited: { type: Boolean, default: false },

    aadharNumber: { type: String },
    aadharDoc: { type: String },
    drugLicenseNumber: { type: String },
    drugLicenseExpiry: { type: Date },
    drugLicenseDoc: { type: String },
    gstNumber: { type: String },
    gstDoc: { type: String },
    panNumber: { type: String },
    panDoc: { type: String },
    shopImage: { type: String },
    bankName: { type: String },
    accountHolderName: { type: String },
    accountNumber: { type: String },
    ifscCode: { type: String },
    cancelChequeDoc: { type: String },
  
    kyc: {
      type: String,
      enum: ["APPROVED", "PENDING", "REJECTED", "BLANK"],
      default: "BLANK",
    },
    kycRejectionReason: { type: String, trim: true, default: "" },
    kycHistory: [
      {
        status: {
          type: String,
          enum: ["APPROVED", "PENDING", "REJECTED", "BLANK"],
          required: true,
        },
        event: {
          type: String,
          enum: ["SUBMITTED", "STATUS_CHANGE", "DOCS_DELETED"],
          default: "STATUS_CHANGE",
        },
        rejectionReason: { type: String, trim: true, default: "" },
        changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        changedAt: { type: Date, default: Date.now },
        documents: {
          aadharDoc: { type: String, default: "" },
          drugLicenseDoc: { type: String, default: "" },
          gstDoc: { type: String, default: "" },
          panDoc: { type: String, default: "" },
          shopImage: { type: String, default: "" },
          cancelChequeDoc: { type: String, default: "" },
        },
      },
    ],

    adminSecurityQuestions: [
      {
        question: { type: String, trim: true },
        answerHash: { type: String, required: true, select: false },
        updatedAt: { type: Date, default: Date.now },
      },
    ],

    role: { type: String, enum: ["user", "vendor", "admin", "agent"], default: "user" },
    isVerified: { type: Boolean, default: false },
    isBlocked: { type: Boolean, default: false },
    blockReason: { type: String, trim: true, default: "" },
    expoPushTokens: [{ type: String, trim: true }],
  },
  { timestamps: true }
);

userSchema.pre("save", async function () {
  if (!this.referralCode) {
    let code;
    let exists = true;
    while (exists) {
      code = generateReferralCode();
      const found = await mongoose.model("User").findOne(
        { referralCode: code, _id: { $ne: this._id } },
        { _id: 1 }
      );
      exists = !!found;
    }
    this.referralCode = code;
  }
});

const User = mongoose.model("User", userSchema);
export default User;
