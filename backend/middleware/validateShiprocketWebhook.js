import crypto from "crypto";

const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

export const validateShiprocketWebhook = (req, res, next) => {
  const expectedToken = String(process.env.SHIPROCKET_WEBHOOK_TOKEN || "").trim();
  if (!expectedToken) {
    return res.status(500).json({ message: "Shiprocket webhook token is not configured" });
  }

  const providedToken = String(req.header("x-api-key") || "").trim();
  if (!providedToken || !safeEqual(providedToken, expectedToken)) {
    return res.status(401).json({ message: "Invalid Shiprocket webhook token" });
  }

  next();
};
