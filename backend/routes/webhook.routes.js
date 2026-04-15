import express from "express";
import { handleShiprocketWebhook } from "../controllers/order.controller.js";
import { validateShiprocketWebhook } from "../middleware/validateShiprocketWebhook.js";

const router = express.Router();

router.post("/shipping", validateShiprocketWebhook, handleShiprocketWebhook);
router.post("/shiprocket", validateShiprocketWebhook, handleShiprocketWebhook);

export default router;
