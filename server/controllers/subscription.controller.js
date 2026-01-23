import { createHttpError } from "../middleware/error.js";
import { allowAdmin } from "../middleware/auth.js";
import { getStores } from "../services/store.service.js";

export const getStatus = (req, res) => {
  const { subscriptionStore } = getStores();
  const { baseId } = req.body || {};
  res.json(subscriptionStore.getStatus(baseId));
};

export const consume = (req, res) => {
  const { subscriptionStore } = getStores();
  const { baseId } = req.body || {};
  res.json(subscriptionStore.consume(baseId));
};

export const grantAdmin = (req, res) => {
  if (!allowAdmin(req)) {
    throw createHttpError(401, "未授权");
  }
  const { subscriptionStore } = getStores();
  const { baseId } = req.body || {};
  if (!baseId) {
    throw createHttpError(400, "baseId 必填");
  }
  const ok = subscriptionStore.setAdmin(baseId, true);
  if (!ok) {
    throw createHttpError(400, "设置失败");
  }
  res.json({ ok: true });
};
