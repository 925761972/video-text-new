import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildSubmitPayload, extractDurationMs, extractText, normalizeFormat } from "./volcengineClient.js";
import {
  buildAlipaySignContent,
  buildAlipayPageParams,
  buildWechatSignatureMessage,
  createBillingStore,
  createSubscriptionStore,
  createUsageRecorder,
  decryptWechatResource,
  loadEnvFile,
  normalizeBaseId,
  normalizeAlipayPrivateKey,
  parsePaidBaseIds,
  signAlipayParams,
  verifyAlipaySignature,
  verifyWechatSignature
} from "./index.js";

describe("volcengineClient helpers", () => {
  it("normalizeFormat handles m4a", () => {
    expect(normalizeFormat("m4a")).toBe("mp4");
  });

  it("buildSubmitPayload keeps optional fields", () => {
    const payload = buildSubmitPayload({
      audioUrl: "https://example.com/audio.mp3",
      format: "mp3",
      language: "zh-CN",
      modelVersion: "400",
      enableItn: true,
      enablePunc: false,
      enableDdc: true,
      showUtterances: true
    });
    expect(payload.audio.url).toBe("https://example.com/audio.mp3");
    expect(payload.audio.language).toBe("zh-CN");
    expect(payload.request.model_version).toBe("400");
    expect(payload.request.enable_itn).toBe(true);
    expect(payload.request.enable_punc).toBe(false);
    expect(payload.request.enable_ddc).toBe(true);
    expect(payload.request.show_utterances).toBe(true);
  });

  it("extractText prefers text field", () => {
    const result = extractText({ text: "hello" });
    expect(result).toBe("hello");
  });

  it("extractText joins utterances when text missing", () => {
    const result = extractText({ utterances: [{ text: "a" }, { text: "b" }] });
    expect(result).toBe("ab");
  });

  it("extractDurationMs reads duration seconds", () => {
    const durationMs = extractDurationMs({ duration: 5.317 });
    expect(durationMs).toBe(5317);
  });

  it("extractDurationMs reads utterance end time", () => {
    const durationMs = extractDurationMs({ utterances: [{ end_time: 1200 }, { end_time: 3200 }] });
    expect(durationMs).toBe(3200);
  });
});

describe("subscription store", () => {
  it("normalizeBaseId trims value", () => {
    expect(normalizeBaseId("  base123 ")).toBe("base123");
    expect(normalizeBaseId(null)).toBe("");
  });

  it("parsePaidBaseIds handles csv", () => {
    const ids = parsePaidBaseIds("a, b ,c");
    expect(ids.has("a")).toBe(true);
    expect(ids.has("b")).toBe(true);
    expect(ids.has("c")).toBe(true);
  });

  it("consume respects trial limit", () => {
    const store = createSubscriptionStore({
      trialLimit: 1,
      paidBaseIds: new Set(),
      adminBaseIds: new Set(),
      allowBypass: false
    });
    const first = store.consume("base-1");
    expect(first.allowed).toBe(true);
    expect(first.freeRemaining).toBe(0);
    const second = store.consume("base-1");
    expect(second.allowed).toBe(false);
  });

  it("paid base bypasses trial", () => {
    const store = createSubscriptionStore({
      trialLimit: 1,
      paidBaseIds: new Set(["base-2"]),
      adminBaseIds: new Set(),
      allowBypass: false
    });
    const status = store.consume("base-2");
    expect(status.allowed).toBe(true);
    expect(status.isPaid).toBe(true);
  });

  it("activatePlan marks tenant as paid", () => {
    const store = createSubscriptionStore({
      trialLimit: 1,
      paidBaseIds: new Set(),
      adminBaseIds: new Set(),
      allowBypass: false
    });
    const paidUntil = store.activatePlan({ baseId: "base-3", durationMs: 1000, paidAt: Date.now() });
    expect(paidUntil).toBeGreaterThan(Date.now());
    const status = store.getStatus("base-3");
    expect(status.isPaid).toBe(true);
  });

  it("activatePlan extends existing paid period", () => {
    const store = createSubscriptionStore({
      trialLimit: 1,
      paidBaseIds: new Set(),
      adminBaseIds: new Set(),
      allowBypass: false
    });
    const first = store.activatePlan({ baseId: "base-4", durationMs: 1000, paidAt: Date.now() });
    const second = store.activatePlan({ baseId: "base-4", durationMs: 1000, paidAt: Date.now() });
    expect(second).toBeGreaterThan(first);
  });

  it("admin base is always paid", () => {
    const store = createSubscriptionStore({
      trialLimit: 1,
      paidBaseIds: new Set(),
      adminBaseIds: new Set(["admin-base"]),
      allowBypass: false
    });
    const status = store.getStatus("admin-base");
    expect(status.isPaid).toBe(true);
    expect(status.allowed).toBe(true);
    expect(status.message).toBe("管理员免付");
  });
});

describe("alipay helpers", () => {
  it("normalizeAlipayPrivateKey restores line breaks", () => {
    const raw = "line1\\nline2\\nline3";
    expect(normalizeAlipayPrivateKey(raw)).toBe("line1\nline2\nline3");
  });

  it("signAlipayParams matches verifyAlipaySignature", () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicPem = publicKey.export({ type: "pkcs1", format: "pem" });
    const privatePem = privateKey.export({ type: "pkcs1", format: "pem" });
    const params = buildAlipayPageParams({
      order: { orderId: "order-1", price: 9.9 },
      plan: { label: "月度" },
      config: {
        appId: "app-1",
        notifyUrl: "https://example.com/notify",
        returnUrl: "https://example.com/return",
        gateway: "https://openapi.alipay.com/gateway.do"
      }
    });
    const sign = signAlipayParams({ params, privateKey: privatePem });
    const ok = verifyAlipaySignature({ publicKey: publicPem, payload: { ...params, sign } });
    expect(ok).toBe(true);
  });
});

describe("billing store", () => {
  it("falls back to default pricing", () => {
    const store = createBillingStore({
      defaultPricing: { modelUnitPrice: 0.1, modelUnitLabel: "分钟" }
    });
    const pricing = store.getPricing("base-1");
    expect(pricing.modelUnitPrice).toBe(0.1);
    expect(pricing.modelUnitLabel).toBe("分钟");
  });

  it("overrides pricing per tenant", () => {
    const store = createBillingStore({
      pricingByBaseId: {
        "base-1": { modelUnitPrice: 0.2, modelUnitLabel: "次", planPriceById: { monthly: 5 } }
      },
      defaultPricing: { modelUnitPrice: 0.1, modelUnitLabel: "分钟" }
    });
    const pricing = store.getPricing("base-1");
    expect(pricing.modelUnitPrice).toBe(0.2);
    expect(pricing.modelUnitLabel).toBe("次");
    expect(pricing.planPriceById.monthly).toBe(5);
  });

  it("records usage cost", () => {
    const store = createBillingStore({
      pricingByBaseId: {
        "base-1": { modelUnitPrice: 0.3, modelUnitLabel: "次" }
      },
      defaultPricing: { modelUnitPrice: 0.1, modelUnitLabel: "分钟" }
    });
    const first = store.recordUsage({ baseId: "base-1", minutes: 2 });
    expect(first.count).toBe(2);
    expect(first.cost).toBe(0.6);
    const second = store.recordUsage({ baseId: "base-1", minutes: 1 });
    expect(second.count).toBe(3);
    expect(second.cost).toBe(0.9);
  });

  it("applies tiered pricing per day", () => {
    const store = createBillingStore({
      defaultPricing: {
        modelUnitPrice: 0.1,
        modelUnitLabel: "分钟",
        tieredPrices: [
          { upToMinutes: 2, unitPrice: 0.2 },
          { upToMinutes: 5, unitPrice: 0.1 },
          { upToMinutes: Number.POSITIVE_INFINITY, unitPrice: 0.05 }
        ]
      }
    });
    const at = Date.parse("2025-01-01T00:00:00.000Z");
    const first = store.recordUsage({ baseId: "base-tier", minutes: 1, occurredAt: at });
    expect(first.dailyMinutes).toBe(1);
    expect(first.dailyCost).toBe(0.2);
    const second = store.recordUsage({ baseId: "base-tier", minutes: 2, occurredAt: at });
    expect(second.dailyMinutes).toBe(3);
    expect(second.dailyCost).toBe(0.5);
  });
});

describe("usage recorder", () => {
  it("records usage only for known tasks", () => {
    const billingTasks = new Map();
    const billingStore = createBillingStore({
      defaultPricing: { modelUnitPrice: 0.5, modelUnitLabel: "分钟" }
    });
    const recordUsageOnce = createUsageRecorder({ billingTasks, billingStore });
    expect(recordUsageOnce({ taskId: "missing" })).toBe(null);
    expect(billingStore.getUsage("base-1").count).toBe(0);

    billingTasks.set("task-1", { baseId: " base-1 ", charged: false, durationMs: 120000 });
    const first = recordUsageOnce({ taskId: "task-1", durationMs: 60000 });
    expect(first.count).toBe(2);
    expect(billingStore.getUsage("base-1").count).toBe(2);
    expect(recordUsageOnce({ taskId: "task-1" })).toBe(null);
    expect(billingTasks.has("task-1")).toBe(false);

    billingTasks.set("task-2", { baseId: "base-1", charged: false, durationMs: 60000 });
    const second = recordUsageOnce({ taskId: "task-2" });
    expect(second.count).toBe(3);
    expect(billingStore.getUsage("base-1").count).toBe(3);
  });
});

describe("payment verify helpers", () => {
  it("verifyWechatSignature checks signature", () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const body = JSON.stringify({ id: "123" });
    const timestamp = "1700000000";
    const nonce = "nonce";
    const message = buildWechatSignatureMessage({ timestamp, nonce, body });
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(message);
    signer.end();
    const signature = signer.sign(privateKey, "base64");
    const verified = verifyWechatSignature({
      publicKey,
      signature,
      timestamp,
      nonce,
      body
    });
    expect(verified).toBe(true);
  });

  it("decryptWechatResource decrypts payload", () => {
    const apiV3Key = "12345678901234567890123456789012";
    const payload = { out_trade_no: "order-1", trade_state: "SUCCESS" };
    const nonce = "randomnonce123";
    const associatedData = "data";
    const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(apiV3Key), nonce);
    cipher.setAAD(Buffer.from(associatedData));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const ciphertext = Buffer.concat([encrypted, authTag]).toString("base64");
    const resource = {
      ciphertext,
      nonce,
      associated_data: associatedData
    };
    const decoded = decryptWechatResource({ apiV3Key, resource });
    expect(decoded.out_trade_no).toBe("order-1");
    expect(decoded.trade_state).toBe("SUCCESS");
  });

  it("verifyAlipaySignature checks signature", () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const payload = {
      out_trade_no: "order-2",
      trade_status: "TRADE_SUCCESS",
      total_amount: "9.9",
      sign_type: "RSA2"
    };
    const signContent = buildAlipaySignContent(payload);
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(signContent);
    signer.end();
    const sign = signer.sign(privateKey, "base64");
    const verified = verifyAlipaySignature({
      publicKey,
      payload: { ...payload, sign }
    });
    expect(verified).toBe(true);
  });
});

describe("env loader", () => {
  it("loadEnvFile populates missing variables", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "env-test-"));
    const envPath = path.join(tmpDir, ".env");
    fs.writeFileSync(envPath, "VOLC_APP_ID=app-123\nVOLC_ACCESS_KEY=key-456\n");
    const prevAppId = process.env.VOLC_APP_ID;
    const prevAccessKey = process.env.VOLC_ACCESS_KEY;
    delete process.env.VOLC_APP_ID;
    delete process.env.VOLC_ACCESS_KEY;
    loadEnvFile(envPath);
    expect(process.env.VOLC_APP_ID).toBe("app-123");
    expect(process.env.VOLC_ACCESS_KEY).toBe("key-456");
    if (prevAppId === undefined) {
      delete process.env.VOLC_APP_ID;
    } else {
      process.env.VOLC_APP_ID = prevAppId;
    }
    if (prevAccessKey === undefined) {
      delete process.env.VOLC_ACCESS_KEY;
    } else {
      process.env.VOLC_ACCESS_KEY = prevAccessKey;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadEnvFile keeps existing variables", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "env-test-"));
    const envPath = path.join(tmpDir, ".env");
    fs.writeFileSync(envPath, "TEST_ENV_KEY=next\n");
    const prevValue = process.env.TEST_ENV_KEY;
    process.env.TEST_ENV_KEY = "current";
    loadEnvFile(envPath);
    expect(process.env.TEST_ENV_KEY).toBe("current");
    if (prevValue === undefined) {
      delete process.env.TEST_ENV_KEY;
    } else {
      process.env.TEST_ENV_KEY = prevValue;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
