import crypto from "node:crypto";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile, loadEnvFiles } from "./config/env.js";
import { createBillingStore, createUsageRecorder } from "./stores/billing.js";
import {
  createSubscriptionStore,
  mergeRedeemCodes,
  normalizeBaseId,
  parsePaidBaseIds
} from "./stores/subscription.js";
import { buildSubmitPayload, createVolcengineClient, extractDurationMs, extractText } from "./volcengineClient.js";

const app = express();
const port = Number.parseInt(process.env.PORT || "5174", 10);
const env = process.env.NODE_ENV || "development";

loadEnvFiles(env);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

const asyncHandler = (handler) => {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
};

const createHttpError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const shouldLog = env !== "test";

const logEvent = (level, payload) => {
  if (!shouldLog) {
    return;
  }
  const entry = {
    level,
    time: new Date().toISOString(),
    ...payload
  };
  const text = JSON.stringify(entry);
  if (level === "error") {
    console.error(text);
    return;
  }
  console.log(text);
};

app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on("finish", () => {
    logEvent("info", {
      type: "access",
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      durationMs: Date.now() - startedAt
    });
  });
  next();
});

const volcConfig = {
  appId: process.env.VOLC_APP_ID,
  accessKey: process.env.VOLC_ACCESS_KEY,
  resourceId: process.env.VOLC_RESOURCE_ID || "volc.bigasr.auc"
};

const ensureConfig = () => {
  const missing = Object.entries(volcConfig)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(`缺少环境变量: ${missing.join(", ")}`);
  }
};

const seedAdminBaseIds = new Set(["Caasb9qNgaJ6jgskH7OcAkMOnaf"]);
const seedRedeemCodeList = ["FREE-1M-H0K4-3N8Q", "FREE-1M-T9R2-5J6P", "FREE-1M-X7M1-8V2C"];
const seedRedeemCodes = seedRedeemCodeList.map((code) => ({
  codeHash: crypto.createHash("sha256").update(String(code)).digest("hex"),
  durationMs: 30 * 24 * 60 * 60 * 1000,
  usedAt: 0,
  usedBy: ""
}));

const paidBaseIds = parsePaidBaseIds(process.env.PAID_BASE_IDS || "");
const adminBaseIds = parsePaidBaseIds(process.env.ADMIN_BASE_IDS || "");
const trialLimit = Number.parseInt(process.env.TRIAL_LIMIT || "2", 10);
const allowBypass = env !== "production" && process.env.SUBSCRIPTION_BYPASS === "true";
const storePath = process.env.SUBSCRIPTION_STORE_PATH || "";
const billingPaymentUrl = process.env.BILLING_PAYMENT_URL || "";
const billingWebhookToken = process.env.BILLING_WEBHOOK_TOKEN || "";
const alipayGateway =
  process.env.ALIPAY_GATEWAY ||
  (env === "production" ? "https://openapi.alipay.com/gateway.do" : "https://openapi.alipaydev.com/gateway.do");
const alipayAppId = process.env.ALIPAY_APP_ID || "";
const alipayPrivateKeyRaw = process.env.ALIPAY_PRIVATE_KEY || "";
const alipayNotifyUrl = process.env.ALIPAY_NOTIFY_URL || "";
const alipayReturnUrl = process.env.ALIPAY_RETURN_URL || "";

const readStore = () => {
  if (!storePath || !fs.existsSync(storePath)) {
    return {
      paidUntilByBaseId: {},
      adminBaseIdList: [],
      redeemCodes: [],
      pricingByBaseId: {},
      usageByBaseId: {},
      dailyUsageByBaseId: {}
    };
  }
  try {
    const raw = fs.readFileSync(storePath, "utf-8");
    const parsed = JSON.parse(raw || "{}");
    return {
      paidUntilByBaseId: parsed.paidUntilByBaseId || {},
      adminBaseIdList: parsed.adminBaseIdList || [],
      redeemCodes: parsed.redeemCodes || [],
      pricingByBaseId: parsed.pricingByBaseId || {},
      usageByBaseId: parsed.usageByBaseId || {},
      dailyUsageByBaseId: parsed.dailyUsageByBaseId || {}
    };
  } catch {
    return {
      paidUntilByBaseId: {},
      adminBaseIdList: [],
      redeemCodes: [],
      pricingByBaseId: {},
      usageByBaseId: {},
      dailyUsageByBaseId: {}
    };
  }
};

const storeCache = readStore();
let pendingWrite = Promise.resolve();

const writeStore = (data) => {
  if (!storePath) {
    return;
  }
  storeCache.paidUntilByBaseId = data.paidUntilByBaseId ?? storeCache.paidUntilByBaseId ?? {};
  storeCache.adminBaseIdList = data.adminBaseIdList ?? storeCache.adminBaseIdList ?? [];
  storeCache.redeemCodes = data.redeemCodes ?? storeCache.redeemCodes ?? [];
  storeCache.pricingByBaseId = data.pricingByBaseId ?? storeCache.pricingByBaseId ?? {};
  storeCache.usageByBaseId = data.usageByBaseId ?? storeCache.usageByBaseId ?? {};
  storeCache.dailyUsageByBaseId = data.dailyUsageByBaseId ?? storeCache.dailyUsageByBaseId ?? {};
  const payload = JSON.stringify(storeCache, null, 2);
  pendingWrite = pendingWrite
    .then(() => fs.promises.writeFile(storePath, payload, "utf-8"))
    .catch((error) => {
      console.error(error);
    });
};

const storeData = storeCache;
const mergedAdminBaseIds = new Set([
  ...(adminBaseIds || new Set()),
  ...(storeData.adminBaseIdList || []),
  ...seedAdminBaseIds
]);
const mergedRedeemCodes = mergeRedeemCodes(storeData.redeemCodes, seedRedeemCodes);
const subscriptionStore = createSubscriptionStore({
  trialLimit,
  paidBaseIds,
  adminBaseIds: mergedAdminBaseIds,
  allowBypass,
  paidUntilByBaseId: storeData.paidUntilByBaseId,
  redeemCodes: mergedRedeemCodes,
  onPersist: writeStore
});

const parseTieredPrices = (value) => {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const hourlyUnitPrice = 6.5;
const defaultPricing = {
  modelUnitPrice: hourlyUnitPrice / 60,
  modelUnitLabel: "分钟",
  tieredPrices: []
};

const billingStore = createBillingStore({
  pricingByBaseId: storeData.pricingByBaseId,
  usageByBaseId: storeData.usageByBaseId,
  dailyUsageByBaseId: storeData.dailyUsageByBaseId,
  defaultPricing,
  onPersist: writeStore
});

const billingPlans = [
  { id: "monthly", label: "月度", price: 9.9, durationMs: 30 * 24 * 60 * 60 * 1000, usageNote: "模型调用费用另计" },
  { id: "quarterly", label: "季度", price: 19.9, durationMs: 90 * 24 * 60 * 60 * 1000, usageNote: "模型调用费用另计" },
  { id: "halfyear", label: "半年", price: 49.9, durationMs: 180 * 24 * 60 * 60 * 1000, usageNote: "模型调用费用另计" }
];

const billingOrders = new Map();
const billingTasks = new Map();

const formatUsageNote = (pricing) => {
  if (pricing?.tieredPrices?.length) {
    return "模型调用费用按阶梯计费";
  }
  const price = Number(pricing.modelUnitPrice);
  if (!Number.isFinite(price) || price <= 0) {
    return "模型调用费用另计";
  }
  return `模型调用费用 ${price}元/${pricing.modelUnitLabel}`;
};

const resolvePlan = ({ baseId, planId }) => {
  const plan = billingPlans.find((item) => item.id === planId);
  if (!plan) {
    return null;
  }
  const pricing = billingStore.getPricing(baseId);
  const overridePrice = pricing.planPriceById?.[planId];
  const overrideValue = Number(overridePrice);
  return {
    ...plan,
    price: Number.isFinite(overrideValue) ? overrideValue : plan.price,
    usageNote: formatUsageNote(pricing)
  };
};

const getPlansForBaseId = (baseId) => {
  const pricing = billingStore.getPricing(baseId);
  return billingPlans.map((plan) => {
    const overridePrice = pricing.planPriceById?.[plan.id];
    const overrideValue = Number(overridePrice);
    return {
      ...plan,
      price: Number.isFinite(overrideValue) ? overrideValue : plan.price,
      usageNote: formatUsageNote(pricing)
    };
  });
};

const recordUsageOnce = createUsageRecorder({ billingTasks, billingStore });

const finalizePaidOrder = ({ orderId, paidAt }) => {
  const order = billingOrders.get(orderId);
  if (!order) {
    return { ok: false, status: 404, message: "订单不存在" };
  }
  const plan = billingPlans.find((item) => item.id === order.planId);
  if (!plan) {
    return { ok: false, status: 400, message: "planId 无效" };
  }
  const paidUntil = subscriptionStore.activatePlan({
    baseId: order.baseId,
    durationMs: plan.durationMs,
    paidAt: paidAt || Date.now()
  });
  order.status = "paid";
  order.paidAt = paidAt || Date.now();
  order.paidUntil = paidUntil;
  return { ok: true, paidUntil };
};

const buildWechatSignatureMessage = ({ timestamp, nonce, body }) => {
  return `${timestamp}\n${nonce}\n${body}\n`;
};

const verifyWechatSignature = ({ publicKey, signature, timestamp, nonce, body }) => {
  if (!publicKey || !signature || !timestamp || !nonce) {
    return false;
  }
  const message = buildWechatSignatureMessage({ timestamp, nonce, body });
  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(message);
  verifier.end();
  return verifier.verify(publicKey, signature, "base64");
};

const decryptWechatResource = ({ apiV3Key, resource }) => {
  if (!apiV3Key || !resource) {
    return null;
  }
  const { ciphertext, nonce, associated_data: associatedData } = resource;
  if (!ciphertext || !nonce) {
    return null;
  }
  const key = Buffer.from(apiV3Key);
  const cipherBuffer = Buffer.from(ciphertext, "base64");
  const authTag = cipherBuffer.subarray(cipherBuffer.length - 16);
  const data = cipherBuffer.subarray(0, cipherBuffer.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
  if (associatedData) {
    decipher.setAAD(Buffer.from(associatedData));
  }
  decipher.setAuthTag(authTag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  return JSON.parse(plain);
};

const buildAlipaySignContent = (payload) => {
  return Object.keys(payload)
    .filter((key) => key && key !== "sign" && key !== "sign_type" && payload[key] !== undefined && payload[key] !== "")
    .sort()
    .map((key) => `${key}=${payload[key]}`)
    .join("&");
};

const verifyAlipaySignature = ({ publicKey, payload }) => {
  if (!publicKey || !payload || !payload.sign) {
    return false;
  }
  const signContent = buildAlipaySignContent(payload);
  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(signContent);
  verifier.end();
  return verifier.verify(publicKey, payload.sign, "base64");
};

const normalizeAlipayPrivateKey = (value) => {
  if (!value) {
    return "";
  }
  return value.includes("\\n") ? value.replaceAll("\\n", "\n") : value;
};

const buildAlipayTimestamp = (date = new Date()) => {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}:${pad(date.getSeconds())}`;
};

const getAlipayConfig = () => {
  const privateKey = normalizeAlipayPrivateKey(alipayPrivateKeyRaw);
  if (!alipayAppId || !privateKey || !alipayNotifyUrl || !alipayReturnUrl) {
    return null;
  }
  return {
    appId: alipayAppId,
    privateKey,
    notifyUrl: alipayNotifyUrl,
    returnUrl: alipayReturnUrl,
    gateway: alipayGateway
  };
};

const buildAlipayPageParams = ({ order, plan, config }) => {
  const totalAmount = Number(order?.price);
  const totalText = Number.isFinite(totalAmount) ? totalAmount.toFixed(2) : "0.00";
  return {
    app_id: config.appId,
    method: "alipay.trade.page.pay",
    format: "JSON",
    charset: "utf-8",
    sign_type: "RSA2",
    timestamp: buildAlipayTimestamp(),
    version: "1.0",
    notify_url: config.notifyUrl,
    return_url: config.returnUrl,
    biz_content: JSON.stringify({
      out_trade_no: order.orderId,
      product_code: "FAST_INSTANT_TRADE_PAY",
      total_amount: totalText,
      subject: `${plan?.label || "订阅"}套餐`
    })
  };
};

const signAlipayParams = ({ params, privateKey }) => {
  const signContent = buildAlipaySignContent(params);
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signContent);
  signer.end();
  return signer.sign(privateKey, "base64");
};

const escapeHtml = (value) => {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
};

const buildAlipayPageHtml = ({ gateway, params }) => {
  const inputs = Object.entries(params)
    .map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}" />`)
    .join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8" /></head><body><form id="alipayForm" method="POST" action="${escapeHtml(
    gateway
  )}">${inputs}</form><script>document.getElementById('alipayForm').submit();</script></body></html>`;
};

const buildPaymentUrl = ({ orderId, baseId, planId, price }) => {
  if (!billingPaymentUrl) {
    return "";
  }
  return billingPaymentUrl
    .replaceAll("{orderId}", orderId)
    .replaceAll("{baseId}", baseId)
    .replaceAll("{planId}", planId)
    .replaceAll("{price}", String(price));
};

app.post(
  "/api/transcribe/submit",
  asyncHandler(async (req, res) => {
    ensureConfig();
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
    const client = createVolcengineClient(volcConfig);
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
  })
);

app.post(
  "/api/transcribe/query",
  asyncHandler(async (req, res) => {
    ensureConfig();
    const { taskId, logId } = req.body || {};
    if (!taskId || typeof taskId !== "string") {
      throw createHttpError(400, "taskId 必填");
    }
    const client = createVolcengineClient(volcConfig);
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
  })
);

app.post("/api/subscription/status", (req, res) => {
  const { baseId } = req.body || {};
  res.json(subscriptionStore.getStatus(baseId));
});

app.post("/api/subscription/consume", (req, res) => {
  const { baseId } = req.body || {};
  res.json(subscriptionStore.consume(baseId));
});

app.get("/api/billing/plans", (req, res) => {
  const baseId = normalizeBaseId(req.query.baseId);
  res.json(getPlansForBaseId(baseId));
});

app.post(
  "/api/billing/checkout",
  asyncHandler(async (req, res) => {
    const { baseId, planId } = req.body || {};
    const normalized = normalizeBaseId(baseId);
    if (!normalized) {
      throw createHttpError(400, "baseId 必填");
    }
    const plan = resolvePlan({ baseId: normalized, planId });
    if (!plan) {
      throw createHttpError(400, "planId 无效");
    }
    const orderId = crypto.randomUUID();
    const order = {
      orderId,
      baseId: normalized,
      planId: plan.id,
      price: plan.price,
      status: "pending",
      createdAt: Date.now()
    };
    billingOrders.set(orderId, order);
    const configuredPayUrl = buildPaymentUrl({
      orderId,
      baseId: normalized,
      planId: plan.id,
      price: plan.price
    });
    const alipayConfig = getAlipayConfig();
    const payUrl = configuredPayUrl || (alipayConfig ? `/api/billing/alipay/page?orderId=${orderId}` : "");
    res.json({ orderId, payUrl });
  })
);

app.get("/api/billing/alipay/page", (req, res) => {
  const orderId = typeof req.query.orderId === "string" ? req.query.orderId : "";
  if (!orderId) {
    res.status(400).send("orderId 必填");
    return;
  }
  const order = billingOrders.get(orderId);
  if (!order) {
    res.status(404).send("订单不存在");
    return;
  }
  if (order.status !== "pending") {
    res.status(400).send("订单状态异常");
    return;
  }
  const plan = billingPlans.find((item) => item.id === order.planId);
  if (!plan) {
    res.status(400).send("planId 无效");
    return;
  }
  const config = getAlipayConfig();
  if (!config) {
    res.status(400).send("未配置支付宝支付参数");
    return;
  }
  const params = buildAlipayPageParams({ order, plan, config });
  const sign = signAlipayParams({ params, privateKey: config.privateKey });
  const html = buildAlipayPageHtml({ gateway: config.gateway, params: { ...params, sign } });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
});

app.post(
  "/api/billing/usage",
  asyncHandler(async (req, res) => {
    const { baseId } = req.body || {};
    const normalized = normalizeBaseId(baseId);
    if (!normalized) {
      throw createHttpError(400, "baseId 必填");
    }
    const pricing = billingStore.getPricing(normalized);
    const usage = billingStore.getUsage(normalized);
    const dailyUsage = billingStore.getDailyUsage(normalized);
    const currentUnitPrice = billingStore.resolveCurrentTierUnitPrice(
      pricing.tieredPrices,
      dailyUsage.minutes,
      pricing.modelUnitPrice
    );
    res.json({
      baseId: normalized,
      count: usage.count,
      minutes: usage.minutes,
      cost: usage.cost,
      dailyMinutes: dailyUsage.minutes,
      dailyCost: dailyUsage.cost,
      unitPrice: currentUnitPrice,
      unitLabel: pricing.modelUnitLabel
    });
  })
);

app.post(
  "/api/billing/pricing/set",
  asyncHandler(async (req, res) => {
    if (!allowAdmin(req)) {
      throw createHttpError(401, "未授权");
    }
    const { baseId, planPriceById, modelUnitPrice, modelUnitLabel } = req.body || {};
    const normalized = normalizeBaseId(baseId);
    if (!normalized) {
      throw createHttpError(400, "baseId 必填");
    }
    if (modelUnitPrice !== undefined) {
      const parsedPrice = Number(modelUnitPrice);
      if (!Number.isFinite(parsedPrice)) {
        throw createHttpError(400, "modelUnitPrice 无效");
      }
    }
    const ok = billingStore.setPricing(normalized, {
      planPriceById: planPriceById || {},
      modelUnitPrice,
      modelUnitLabel
    });
    if (!ok) {
      throw createHttpError(400, "设置失败");
    }
    res.json({ ok: true });
  })
);

app.post("/api/billing/webhook", (req, res) => {
  if (billingWebhookToken && req.get("x-billing-token") !== billingWebhookToken) {
    res.status(401).send("未授权");
    return;
  }
  const { orderId, status, paidAt } = req.body || {};
  if (!orderId) {
    res.status(400).send("orderId 必填");
    return;
  }
  const order = billingOrders.get(orderId);
  if (!order) {
    res.status(404).send("订单不存在");
    return;
  }
  if (status !== "paid") {
    order.status = status || "failed";
    res.json({ ok: true });
    return;
  }
  const paidAtValue = paidAt ? Number.parseInt(paidAt, 10) : Date.now();
  const result = finalizePaidOrder({ orderId, paidAt: paidAtValue });
  if (!result.ok) {
    res.status(result.status || 500).send(result.message || "开通失败");
    return;
  }
  res.json({ ok: true, paidUntil: result.paidUntil });
});

app.post("/api/billing/notify/wechat", express.raw({ type: "*/*" }), (req, res) => {
  const publicKey = process.env.WECHATPAY_PUBLIC_KEY || "";
  const apiV3Key = process.env.WECHATPAY_API_V3_KEY || "";
  const signature = req.get("wechatpay-signature") || "";
  const timestamp = req.get("wechatpay-timestamp") || "";
  const nonce = req.get("wechatpay-nonce") || "";
  const bodyText = req.body ? req.body.toString("utf8") : "";
  const verified = verifyWechatSignature({
    publicKey,
    signature,
    timestamp,
    nonce,
    body: bodyText
  });
  if (!verified) {
    res.status(401).json({ code: "FAIL", message: "签名校验失败" });
    return;
  }
  let parsed;
  try {
    parsed = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    res.status(400).json({ code: "FAIL", message: "解析失败" });
    return;
  }
  const resource = decryptWechatResource({ apiV3Key, resource: parsed.resource });
  if (!resource) {
    res.status(400).json({ code: "FAIL", message: "解密失败" });
    return;
  }
  if (resource.trade_state !== "SUCCESS") {
    res.status(200).json({ code: "SUCCESS", message: "OK" });
    return;
  }
  const orderId = resource.out_trade_no;
  const paidAt = resource.success_time ? Date.parse(resource.success_time) : Date.now();
  const result = finalizePaidOrder({ orderId, paidAt: Number.isFinite(paidAt) ? paidAt : Date.now() });
  if (!result.ok) {
    res.status(result.status || 500).json({ code: "FAIL", message: result.message || "开通失败" });
    return;
  }
  res.status(200).json({ code: "SUCCESS", message: "OK" });
});

app.post("/api/billing/notify/alipay", express.urlencoded({ extended: false }), (req, res) => {
  const publicKey = process.env.ALIPAY_PUBLIC_KEY || "";
  const payload = req.body || {};
  const verified = verifyAlipaySignature({ publicKey, payload });
  if (!verified) {
    res.status(401).send("sign verify failed");
    return;
  }
  const status = payload.trade_status;
  if (status !== "TRADE_SUCCESS" && status !== "TRADE_FINISHED") {
    res.send("success");
    return;
  }
  const orderId = payload.out_trade_no;
  const paidAt = payload.gmt_payment ? Date.parse(payload.gmt_payment) : Date.now();
  const result = finalizePaidOrder({ orderId, paidAt: Number.isFinite(paidAt) ? paidAt : Date.now() });
  if (!result.ok) {
    res.status(result.status || 500).send(result.message || "开通失败");
    return;
  }
  res.send("success");
});

app.post("/api/billing/notify/aggregator", (req, res) => {
  if (billingWebhookToken && req.get("x-billing-token") !== billingWebhookToken) {
    res.status(401).send("未授权");
    return;
  }
  const { orderId, status, paidAt } = req.body || {};
  if (!orderId) {
    res.status(400).send("orderId 必填");
    return;
  }
  if (status !== "paid") {
    res.json({ ok: true });
    return;
  }
  const paidAtValue = paidAt ? Number.parseInt(paidAt, 10) : Date.now();
  const result = finalizePaidOrder({ orderId, paidAt: paidAtValue });
  if (!result.ok) {
    res.status(result.status || 500).send(result.message || "开通失败");
    return;
  }
  res.json({ ok: true, paidUntil: result.paidUntil });
});

const allowAdmin = (req) => {
  const token = process.env.ADMIN_TOKEN || "";
  if (token) {
    return req.get("x-admin-token") === token;
  }
  return env !== "production";
};

app.post(
  "/api/subscription/admin/grant",
  asyncHandler(async (req, res) => {
    if (!allowAdmin(req)) {
      throw createHttpError(401, "未授权");
    }
    const { baseId } = req.body || {};
    if (!baseId) {
      throw createHttpError(400, "baseId 必填");
    }
    const ok = subscriptionStore.setAdmin(baseId, true);
    if (!ok) {
      throw createHttpError(400, "设置失败");
    }
    res.json({ ok: true });
  })
);

app.post(
  "/api/billing/redeem",
  asyncHandler(async (req, res) => {
    const { baseId, code } = req.body || {};
    const result = subscriptionStore.redeem({ baseId, code });
    if (!result.ok) {
      throw createHttpError(400, result.message || "兑换失败");
    }
    res.json({ ok: true, paidUntil: result.paidUntil });
  })
);

app.post(
  "/api/billing/redeem/manage/add",
  asyncHandler(async (req, res) => {
    if (!allowAdmin(req)) {
      throw createHttpError(401, "未授权");
    }
    const { code, durationDays } = req.body || {};
    const parsedDays = Number.parseInt(durationDays || "30", 10);
    if (!Number.isFinite(parsedDays) || parsedDays <= 0) {
      throw createHttpError(400, "durationDays 无效");
    }
    const durationMs = parsedDays * 24 * 60 * 60 * 1000;
    const ok = subscriptionStore.addRedeemCode({ code, durationMs });
    if (!ok) {
      throw createHttpError(400, "添加失败");
    }
    res.json({ ok: true });
  })
);
app.use((err, req, res, next) => {
  const status = Number(err?.status) || 500;
  const message = err?.message || "服务端错误";
  logEvent("error", {
    type: "error",
    message,
    status,
    stack: env === "production" ? undefined : err?.stack
  });
  if (res.headersSent) {
    next(err);
    return;
  }
  res.status(status).json({ message, status });
});

if (env === "production") {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const distPath = path.resolve(__dirname, "../dist");
  app.use(express.static(distPath));
  app.get("*", (req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

if (env !== "test") {
  app.listen(port, () => {
    console.log(`api:${port}`);
  });
}

export {
  buildAlipaySignContent,
  buildAlipayPageParams,
  buildWechatSignatureMessage,
  createUsageRecorder,
  createBillingStore,
  createSubscriptionStore,
  decryptWechatResource,
  loadEnvFile,
  loadEnvFiles,
  normalizeBaseId,
  normalizeAlipayPrivateKey,
  parsePaidBaseIds,
  signAlipayParams,
  verifyAlipaySignature,
  verifyWechatSignature
};
