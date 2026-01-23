import crypto from "node:crypto";

const alipayAppId = process.env.ALIPAY_APP_ID || "";
const alipayPrivateKeyRaw = process.env.ALIPAY_PRIVATE_KEY || "";
const alipayNotifyUrl = process.env.ALIPAY_NOTIFY_URL || "";
const alipayReturnUrl = process.env.ALIPAY_RETURN_URL || "";
const alipayGateway =
  process.env.ALIPAY_GATEWAY ||
  (process.env.NODE_ENV === "production"
    ? "https://openapi.alipay.com/gateway.do"
    : "https://openapi.alipaydev.com/gateway.do");

export const buildWechatSignatureMessage = ({ timestamp, nonce, body }) => {
  return `${timestamp}\n${nonce}\n${body}\n`;
};

export const verifyWechatSignature = ({ publicKey, signature, timestamp, nonce, body }) => {
  if (!publicKey || !signature || !timestamp || !nonce) {
    return false;
  }
  const message = buildWechatSignatureMessage({ timestamp, nonce, body });
  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(message);
  verifier.end();
  return verifier.verify(publicKey, signature, "base64");
};

export const decryptWechatResource = ({ apiV3Key, resource }) => {
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

export const buildAlipaySignContent = (payload) => {
  return Object.keys(payload)
    .filter((key) => key && key !== "sign" && key !== "sign_type" && payload[key] !== undefined && payload[key] !== "")
    .sort()
    .map((key) => `${key}=${payload[key]}`)
    .join("&");
};

export const verifyAlipaySignature = ({ publicKey, payload }) => {
  if (!publicKey || !payload || !payload.sign) {
    return false;
  }
  const signContent = buildAlipaySignContent(payload);
  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(signContent);
  verifier.end();
  return verifier.verify(publicKey, payload.sign, "base64");
};

export const normalizeAlipayPrivateKey = (value) => {
  if (!value) {
    return "";
  }
  return value.includes("\\n") ? value.replaceAll("\\n", "\n") : value;
};

export const buildAlipayTimestamp = (date = new Date()) => {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}:${pad(date.getSeconds())}`;
};

export const getAlipayConfig = () => {
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

export const buildAlipayPageParams = ({ order, plan, config }) => {
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

export const signAlipayParams = ({ params, privateKey }) => {
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

export const buildAlipayPageHtml = ({ gateway, params }) => {
  const inputs = Object.entries(params)
    .map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}" />`)
    .join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8" /></head><body><form id="alipayForm" method="POST" action="${escapeHtml(
    gateway
  )}">${inputs}</form><script>document.getElementById('alipayForm').submit();</script></body></html>`;
};
