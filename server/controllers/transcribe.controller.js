import { createHttpError } from "../middleware/error.js";
import { ensureConfig } from "../config/volcengine.js";
import {
  buildSubmitPayload,
  createVolcengineClient,
  extractDurationMs,
  extractText
} from "../volcengineClient.js";
import { normalizeBaseId } from "../stores/subscription.js";
import { billingTasks, recordUsageOnce } from "../services/billing.service.js";

export const submitTask = async (req, res) => {
  const config = ensureConfig();
  const {
    audioUrl,
    format,
    language,
    modelVersion,
    enableItn,
    enablePunc,
    enableDdc,
    showUtterances,
    baseId,
    durationMs
  } = req.body || {};

  if (!audioUrl || typeof audioUrl !== "string") {
    throw createHttpError(400, "audioUrl 必填");
  }
  if (format && typeof format !== "string") {
    throw createHttpError(400, "format 无效");
  }
  if (language && typeof language !== "string") {
    throw createHttpError(400, "language 无效");
  }
  if (modelVersion && typeof modelVersion !== "string") {
    throw createHttpError(400, "modelVersion 无效");
  }
  if (durationMs !== undefined) {
    const parsedDuration = Number(durationMs);
    if (!Number.isFinite(parsedDuration) || parsedDuration <= 0) {
      throw createHttpError(400, "durationMs 无效");
    }
  }

  const client = createVolcengineClient(config);
  const payload = buildSubmitPayload({
    audioUrl,
    format,
    language,
    modelVersion,
    enableItn,
    enablePunc,
    enableDdc,
    showUtterances
  });

  const result = await client.submitTask(payload);
  const normalizedBaseId = normalizeBaseId(baseId);

  if (normalizedBaseId && result.taskId) {
    const parsedDuration = Number(durationMs);
    billingTasks.set(result.taskId, {
      baseId: normalizedBaseId,
      charged: false,
      durationMs: Number.isFinite(parsedDuration) ? parsedDuration : undefined
    });
  }

  res.json({ taskId: result.taskId, logId: result.logId });
};

export const queryTask = async (req, res) => {
  const config = ensureConfig();
  const { taskId, logId } = req.body || {};

  if (!taskId || typeof taskId !== "string") {
    throw createHttpError(400, "taskId 必填");
  }

  const client = createVolcengineClient(config);
  const result = await client.queryTask({ taskId, logId });

  if (result.statusCode === "20000000") {
    const durationMs = extractDurationMs(result.result?.result);
    recordUsageOnce({ taskId, durationMs });
    res.json({
      status: "done",
      text: extractText(result.result?.result),
      logId: result.logId
    });
    return;
  }

  if (result.statusCode && result.statusCode !== "20000001" && result.statusCode !== "20000002") {
    res.json({
      status: "failed",
      message: result.result?.message || "识别失败",
      logId: result.logId
    });
    return;
  }

  res.json({ status: "running", logId: result.logId });
};
