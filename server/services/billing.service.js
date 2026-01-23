import crypto from "node:crypto";
import { billingPlans } from "../config/constants.js";
import { getStores } from "./store.service.js";
import { createUsageRecorder } from "../stores/billing.js";

export const billingOrders = new Map();
export const billingTasks = new Map();

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

export const resolvePlan = ({ baseId, planId }) => {
  const { billingStore } = getStores();
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

export const getPlansForBaseId = (baseId) => {
  const { billingStore } = getStores();
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

export const finalizePaidOrder = ({ orderId, paidAt }) => {
  const { subscriptionStore } = getStores();
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

export const buildPaymentUrl = ({ orderId, baseId, planId, price }) => {
  const billingPaymentUrl = process.env.BILLING_PAYMENT_URL || "";
  if (!billingPaymentUrl) {
    return "";
  }
  return billingPaymentUrl
    .replaceAll("{orderId}", orderId)
    .replaceAll("{baseId}", baseId)
    .replaceAll("{planId}", planId)
    .replaceAll("{price}", String(price));
};

export const recordUsageOnce = (params) => {
  const { billingStore } = getStores();
  const recorder = createUsageRecorder({ billingTasks, billingStore });
  return recorder(params);
};
