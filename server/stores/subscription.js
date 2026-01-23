import crypto from "node:crypto";

export const normalizeBaseId = (value) => {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
};

const hashCode = (code) => {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
};

export const parsePaidBaseIds = (value = "") => {
  return new Set(
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );
};

export const mergeRedeemCodes = (baseList = [], extraList = []) => {
  const map = new Map();
  [...baseList, ...extraList].forEach((item) => {
    if (!item || !item.codeHash) {
      return;
    }
    map.set(item.codeHash, {
      codeHash: item.codeHash,
      durationMs: item.durationMs,
      usedAt: item.usedAt || 0,
      usedBy: item.usedBy || ""
    });
  });
  return Array.from(map.values());
};

export const createSubscriptionStore = ({
  trialLimit,
  paidBaseIds,
  adminBaseIds,
  allowBypass,
  paidUntilByBaseId = {},
  redeemCodes = [],
  onPersist
}) => {
  const usage = new Map();
  const paidUntilMap = new Map(Object.entries(paidUntilByBaseId));
  const adminSet = new Set(adminBaseIds || []);
  const redeemList = Array.isArray(redeemCodes) ? [...redeemCodes] : [];

  const buildStatus = ({ baseId, isPaid, freeRemaining, allowed, message, paidUntil }) => {
    return {
      baseId,
      isPaid,
      freeRemaining,
      allowed,
      message,
      paidUntil
    };
  };

  const getPaidUntil = (baseId) => {
    const until = paidUntilMap.get(baseId);
    return until ? Number.parseInt(until, 10) : 0;
  };

  const setPaidUntil = (baseId, until) => {
    if (!baseId) {
      return;
    }
    paidUntilMap.set(baseId, String(until));
    if (onPersist) {
      onPersist({
        paidUntilByBaseId: Object.fromEntries(paidUntilMap.entries()),
        adminBaseIdList: Array.from(adminSet),
        redeemCodes: redeemList
      });
    }
  };

  const setAdmin = (baseId, enabled) => {
    const normalized = normalizeBaseId(baseId);
    if (!normalized) {
      return false;
    }
    if (enabled) {
      adminSet.add(normalized);
    } else {
      adminSet.delete(normalized);
    }
    if (onPersist) {
      onPersist({
        paidUntilByBaseId: Object.fromEntries(paidUntilMap.entries()),
        adminBaseIdList: Array.from(adminSet),
        redeemCodes: redeemList
      });
    }
    return true;
  };

  const addRedeemCode = ({ code, durationMs }) => {
    if (!code || !durationMs) {
      return false;
    }
    const codeHash = hashCode(code);
    redeemList.push({ codeHash, durationMs, usedAt: 0, usedBy: "" });
    if (onPersist) {
      onPersist({
        paidUntilByBaseId: Object.fromEntries(paidUntilMap.entries()),
        adminBaseIdList: Array.from(adminSet),
        redeemCodes: redeemList
      });
    }
    return true;
  };

  const redeem = ({ baseId, code }) => {
    const normalized = normalizeBaseId(baseId);
    if (!normalized || !code) {
      return { ok: false, message: "缺少 baseId 或兑换码" };
    }
    const codeHash = hashCode(code);
    const item = redeemList.find((x) => x.codeHash === codeHash);
    if (!item) {
      return { ok: false, message: "兑换码无效" };
    }
    if (item.usedAt && item.usedBy) {
      return { ok: false, message: "兑换码已使用" };
    }
    const paidUntil = activatePlan({ baseId: normalized, durationMs: item.durationMs, paidAt: Date.now() });
    item.usedAt = Date.now();
    item.usedBy = normalized;
    if (onPersist) {
      onPersist({
        paidUntilByBaseId: Object.fromEntries(paidUntilMap.entries()),
        adminBaseIdList: Array.from(adminSet),
        redeemCodes: redeemList
      });
    }
    return { ok: true, paidUntil };
  };

  const isPaid = (baseId) => {
    if (adminSet.has(baseId)) {
      return { paid: true, paidUntil: Number.MAX_SAFE_INTEGER, admin: true };
    }
    if (paidBaseIds.has(baseId)) {
      return { paid: true, paidUntil: Number.MAX_SAFE_INTEGER };
    }
    const until = getPaidUntil(baseId);
    if (!until) {
      return { paid: false, paidUntil: 0 };
    }
    if (Date.now() <= until) {
      return { paid: true, paidUntil: until };
    }
    return { paid: false, paidUntil: until };
  };

  const getFreeRemaining = (baseId) => {
    const used = usage.get(baseId) || 0;
    return Math.max(0, trialLimit - used);
  };

  const getStatus = (rawBaseId) => {
    const baseId = normalizeBaseId(rawBaseId);
    if (!baseId) {
      return buildStatus({
        baseId,
        isPaid: false,
        freeRemaining: 0,
        allowed: false,
        message: "缺少 baseId"
      });
    }
    if (allowBypass) {
      return buildStatus({
        baseId,
        isPaid: true,
        freeRemaining: trialLimit,
        allowed: true,
        message: "开发环境已放行",
        paidUntil: Number.MAX_SAFE_INTEGER
      });
    }
    const paidInfo = isPaid(baseId);
    if (paidInfo.paid) {
      return buildStatus({
        baseId,
        isPaid: true,
        freeRemaining: trialLimit,
        allowed: true,
        message: paidInfo.admin ? "管理员免付" : "已开通",
        paidUntil: paidInfo.paidUntil
      });
    }
    const freeRemaining = getFreeRemaining(baseId);
    return buildStatus({
      baseId,
      isPaid: false,
      freeRemaining,
      allowed: freeRemaining > 0,
      message: freeRemaining > 0 ? `剩余试用 ${freeRemaining} 次` : "试用已用完",
      paidUntil: paidInfo.paidUntil
    });
  };

  const consume = (rawBaseId) => {
    const baseId = normalizeBaseId(rawBaseId);
    if (!baseId) {
      return buildStatus({
        baseId,
        isPaid: false,
        freeRemaining: 0,
        allowed: false,
        message: "缺少 baseId"
      });
    }
    if (allowBypass) {
      return buildStatus({
        baseId,
        isPaid: true,
        freeRemaining: trialLimit,
        allowed: true,
        message: "开发环境已放行",
        paidUntil: Number.MAX_SAFE_INTEGER
      });
    }
    const paidInfo = isPaid(baseId);
    if (paidInfo.paid) {
      return buildStatus({
        baseId,
        isPaid: true,
        freeRemaining: trialLimit,
        allowed: true,
        message: paidInfo.admin ? "管理员免付" : "已开通",
        paidUntil: paidInfo.paidUntil
      });
    }
    const freeRemaining = getFreeRemaining(baseId);
    if (freeRemaining <= 0) {
      return buildStatus({
        baseId,
        isPaid: false,
        freeRemaining: 0,
        allowed: false,
        message: "试用已用完",
        paidUntil: paidInfo.paidUntil
      });
    }
    usage.set(baseId, (usage.get(baseId) || 0) + 1);
    const nextRemaining = getFreeRemaining(baseId);
    return buildStatus({
      baseId,
      isPaid: false,
      freeRemaining: nextRemaining,
      allowed: true,
      message: nextRemaining > 0 ? `剩余试用 ${nextRemaining} 次` : "试用已用完",
      paidUntil: paidInfo.paidUntil
    });
  };

  const activatePlan = ({ baseId, durationMs, paidAt }) => {
    const normalized = normalizeBaseId(baseId);
    if (!normalized || !durationMs) {
      return null;
    }
    const start = Math.max(Date.now(), paidAt || Date.now(), getPaidUntil(normalized));
    const nextUntil = start + durationMs;
    setPaidUntil(normalized, nextUntil);
    return nextUntil;
  };

  return {
    getStatus,
    consume,
    activatePlan,
    getPaidUntil,
    setAdmin,
    addRedeemCode,
    redeem
  };
};
