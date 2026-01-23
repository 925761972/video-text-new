import crypto from "node:crypto";
import { createHttpError } from "../middleware/error.js";
import { allowAdmin } from "../middleware/auth.js";
import { getStores } from "../services/store.service.js";
import { normalizeBaseId } from "../stores/subscription.js";
import {
  getPlansForBaseId,
  resolvePlan,
  billingOrders,
  buildPaymentUrl,
  finalizePaidOrder
} from "../services/billing.service.js";
import {
  getAlipayConfig,
  buildAlipayPageParams,
  signAlipayParams,
  buildAlipayPageHtml,
  verifyWechatSignature,
  decryptWechatResource,
  verifyAlipaySignature
} from "../services/payment.service.js";

const billingWebhookToken = process.env.BILLING_WEBHOOK_TOKEN || "";

export const getPlans = (req, res) => {
  const baseId = normalizeBaseId(req.query.baseId);
  res.json(getPlansForBaseId(baseId));
};

export const checkout = async (req, res) => {
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
};

export const alipayPage = (req, res) => {
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
  const plan = resolvePlan({ baseId: order.baseId, planId: order.planId });
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
};

export const getUsage = async (req, res) => {
  const { billingStore } = getStores();
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
};

export const setPricing = async (req, res) => {
  if (!allowAdmin(req)) {
    throw createHttpError(401, "未授权");
  }
  const { billingStore } = getStores();
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
};

export const webhook = (req, res) => {
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
};

export const notifyWechat = (req, res) => {
  const publicKey = process.env.WECHATPAY_PUBLIC_KEY || "";
  const apiV3Key = process.env.WECHATPAY_API_V3_KEY || "";
  const signature = req.get("wechatpay-signature") || "";
  const timestamp = req.get("wechatpay-timestamp") || "";
  const nonce = req.get("wechatpay-nonce") || "";
  
  // 优先使用 rawBody (由中间件捕获)，否则尝试使用 req.body (如果是 Buffer)
  const rawBody = req.rawBody || req.body;
  const bodyText = rawBody ? (Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody)) : "";
  
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
};

export const notifyAlipay = (req, res) => {
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
};

export const notifyAggregator = (req, res) => {
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
};

export const redeem = async (req, res) => {
  const { subscriptionStore } = getStores();
  const { baseId, code } = req.body || {};
  const result = subscriptionStore.redeem({ baseId, code });
  if (!result.ok) {
    throw createHttpError(400, result.message || "兑换失败");
  }
  res.json({ ok: true, paidUntil: result.paidUntil });
};

export const addRedeemCode = async (req, res) => {
  if (!allowAdmin(req)) {
    throw createHttpError(401, "未授权");
  }
  const { subscriptionStore } = getStores();
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
};
