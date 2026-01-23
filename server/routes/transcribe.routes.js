import express from "express";
import { asyncHandler } from "../middleware/error.js";
import { submitTask, queryTask } from "../controllers/transcribe.controller.js";

const router = express.Router();

router.post("/submit", asyncHandler(submitTask));
router.post("/query", asyncHandler(queryTask));

export default router;
