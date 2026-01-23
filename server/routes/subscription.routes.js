import express from "express";
import { asyncHandler } from "../middleware/error.js";
import { getStatus, consume, grantAdmin } from "../controllers/subscription.controller.js";

const router = express.Router();

router.post("/status", asyncHandler(getStatus));
router.post("/consume", asyncHandler(consume));
router.post("/admin/grant", asyncHandler(grantAdmin));

export default router;
