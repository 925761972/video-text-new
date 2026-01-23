import fs from "node:fs";
import crypto from "node:crypto";
import { createBillingStore } from "../stores/billing.js";
import {
  createSubscriptionStore,
  mergeRedeemCodes,
  parsePaidBaseIds
} from "../stores/subscription.js";
import { seedAdminBaseIds, seedRedeemCodeList, defaultPricing } from "../config/constants.js";

let subscriptionStore;
let billingStore;
let storeData;

const readStore = (storePath) => {
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

const createWriteStore = (storePath, cache) => {
  let pendingWrite = Promise.resolve();
  return (data) => {
    if (!storePath) {
      return;
    }
    cache.paidUntilByBaseId = data.paidUntilByBaseId ?? cache.paidUntilByBaseId ?? {};
    cache.adminBaseIdList = data.adminBaseIdList ?? cache.adminBaseIdList ?? [];
    cache.redeemCodes = data.redeemCodes ?? cache.redeemCodes ?? [];
    cache.pricingByBaseId = data.pricingByBaseId ?? cache.pricingByBaseId ?? {};
    cache.usageByBaseId = data.usageByBaseId ?? cache.usageByBaseId ?? {};
    cache.dailyUsageByBaseId = data.dailyUsageByBaseId ?? cache.dailyUsageByBaseId ?? {};
    const payload = JSON.stringify(cache, null, 2);
    pendingWrite = pendingWrite
      .then(() => fs.promises.writeFile(storePath, payload, "utf-8"))
      .catch((error) => {
        console.error(error);
      });
  };
};

export const initStores = () => {
  const env = process.env.NODE_ENV || "development";
  const storePath = process.env.SUBSCRIPTION_STORE_PATH || "";
  const trialLimit = Number.parseInt(process.env.TRIAL_LIMIT || "2", 10);
  const allowBypass = env !== "production" && process.env.SUBSCRIPTION_BYPASS === "true";
  const paidBaseIds = parsePaidBaseIds(process.env.PAID_BASE_IDS || "");
  const adminBaseIds = parsePaidBaseIds(process.env.ADMIN_BASE_IDS || "");

  const storeCache = readStore(storePath);
  const writeStore = createWriteStore(storePath, storeCache);
  storeData = storeCache;

  const mergedAdminBaseIds = new Set([
    ...(adminBaseIds || new Set()),
    ...(storeData.adminBaseIdList || []),
    ...seedAdminBaseIds
  ]);

  const seedRedeemCodes = seedRedeemCodeList.map((code) => ({
    codeHash: crypto.createHash("sha256").update(String(code)).digest("hex"),
    durationMs: 30 * 24 * 60 * 60 * 1000,
    usedAt: 0,
    usedBy: ""
  }));

  const mergedRedeemCodes = mergeRedeemCodes(storeData.redeemCodes, seedRedeemCodes);

  subscriptionStore = createSubscriptionStore({
    trialLimit,
    paidBaseIds,
    adminBaseIds: mergedAdminBaseIds,
    allowBypass,
    paidUntilByBaseId: storeData.paidUntilByBaseId,
    redeemCodes: mergedRedeemCodes,
    onPersist: writeStore
  });

  billingStore = createBillingStore({
    pricingByBaseId: storeData.pricingByBaseId,
    usageByBaseId: storeData.usageByBaseId,
    dailyUsageByBaseId: storeData.dailyUsageByBaseId,
    defaultPricing,
    onPersist: writeStore
  });

  return { subscriptionStore, billingStore };
};

export const getStores = () => {
  if (!subscriptionStore || !billingStore) {
    throw new Error("Stores not initialized");
  }
  return { subscriptionStore, billingStore };
};
