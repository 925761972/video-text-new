import express from "express";
import { asyncHandler } from "../middleware/error.js";
import {
  getPlans,
  checkout,
  alipayPage,
  getUsage,
  setPricing,
  webhook,
  notifyWechat,
  notifyAlipay,
  notifyAggregator,
  redeem,
  addRedeemCode
} from "../controllers/billing.controller.js";

const router = express.Router();

router.get("/plans", getPlans);
router.post("/checkout", asyncHandler(checkout));
router.get("/alipay/page", alipayPage);
router.post("/usage", asyncHandler(getUsage));
router.post("/pricing/set", asyncHandler(setPricing));
router.post("/webhook", webhook);
router.post("/notify/wechat", notifyWechat);
router.post("/notify/alipay", notifyAlipay);
router.post("/notify/aggregator", notifyAggregator);
router.post("/redeem", asyncHandler(redeem));
router.post("/redeem/manage/add", asyncHandler(addRedeemCode));

export default router;
