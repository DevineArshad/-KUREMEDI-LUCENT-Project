import http from "http";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, ".env"), quiet: true });

import connectDB from "./config/db.js";
import { attachSupportWs } from "./supportWs.js";
import productRoutes from "./routes/productRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import categoriesRouter from "./routes/category.routes.js";
import brandRoutes from "./routes/brand.routes.js";
import cartRoutes from "./routes/cart.routes.js";
import orderRoutes from "./routes/order.routes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import addressRoutes from "./routes/address.routes.js";
import walletRoutes from "./routes/wallet.routes.js";
import configRoutes from "./routes/config.routes.js";
import agentRoutes from "./routes/agent.routes.js";
import supportRoutes from "./routes/support.routes.js";
import marketingRoutes from "./routes/marketing.routes.js";

connectDB();

if (!fs.existsSync("uploads")) fs.mkdirSync("uploads", { recursive: true });
if (!fs.existsSync("uploads/categories"))
  fs.mkdirSync("uploads/categories", { recursive: true });
if (!fs.existsSync("uploads/products"))
  fs.mkdirSync("uploads/products", { recursive: true });
if (!fs.existsSync("uploads/brands"))
  fs.mkdirSync("uploads/brands", { recursive: true });
if (!fs.existsSync("uploads/kyc"))
  fs.mkdirSync("uploads/kyc", { recursive: true });
if (!fs.existsSync("uploads/agents"))
  fs.mkdirSync("uploads/agents", { recursive: true });
if (!fs.existsSync("uploads/banners"))
  fs.mkdirSync("uploads/banners", { recursive: true });

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware to define allowed origins (includes both correct and typo domains)
const allowedOrigins = [
  "https://www.kuremedi.com",
  "https://www.kuremcdi.com", // typo variant for backwards compatibility
  "https://kuremedi.com",
  "https://kuremcdi.com",
  "https://admin.kuremedi.com",
  "https://admin.kuremcdi.com",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:5173",
  "http://localhost:5174",
];

// Middlewares
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      // For development, allow all origins as fallback
      callback(null, true);
    }
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
}));
// Razorpay webhook must receive the exact raw request body for signature verification.
app.use("/api/payment/webhook", express.raw({ type: "application/json" }));

// Keep regular JSON parsing for all other API routes.
// Increased limit to handle product forms with base64 images and metadata
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Test Route
app.get("/", (req, res) => {
  res.send("CI/CD deployed successfully 🚀");
});
// app.get("/", (req, res) => {
//   res.send("Server is running  on port 5000🚀");
// });

// Product Routes
app.use("/api/products", productRoutes);
const uploadsDirFromWorkspace = path.resolve(process.cwd(), "uploads");
const uploadsDirFromBackend = path.join(__dirname, "uploads");
app.use("/uploads", express.static(uploadsDirFromWorkspace));
if (uploadsDirFromBackend !== uploadsDirFromWorkspace) {
  app.use("/uploads", express.static(uploadsDirFromBackend));
}
app.use("/api/auth", authRoutes);

app.use("/api/categories", categoriesRouter);
app.use("/api/brands", brandRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/orders", orderRoutes);

app.use("/api/payment", paymentRoutes);
app.use("/api/addresses", addressRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/config", configRoutes);
app.use("/api/agents", agentRoutes);
app.use("/api/support", supportRoutes);
app.use("/api/marketing", marketingRoutes);

// Error handler – must have 4 args
app.use((err, req, res, next) => {
  if (err?.type === "entity.too.large" || err?.status === 413) {
    return res.status(413).json({ message: "Payload too large. Please upload smaller images." });
  }
  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ message: "One or more images exceed the allowed file size (50MB per image)." });
  }
  if (err?.code === "LIMIT_FILE_COUNT") {
    return res.status(400).json({ message: "Too many files uploaded. Maximum 6 product images are allowed." });
  }
  if (err.code === "LIMIT_UNEXPECTED_FILE") {
    return res.status(400).json({ message: "Invalid upload field. Use productImages for product photos." });
  }
  res.status(500).json({ message: err.message || "Server error" });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

const server = http.createServer(app);
attachSupportWs(server);

server.listen(PORT, "0.0.0.0", () => {
});
