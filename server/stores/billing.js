import { normalizeBaseId } from "./subscription.js";

export const createBillingStore = ({
  pricingByBaseId = {},
  usageByBaseId = {},
  dailyUsageByBaseId = {},
  defaultPricing,
  onPersist
}) => {
  const pricingMap = new Map(Object.entries(pricingByBaseId));
  const usageMap = new Map(Object.entries(usageByBaseId));
  const dailyUsageMap = new Map(Object.entries(dailyUsageByBaseId));

  const getDateKey = (timestamp) => new Date(timestamp).toISOString().slice(0, 10);

  const normalizeTieredPrices = (tieredPrices, fallbackPrice) => {
    if (!Array.isArray(tieredPrices)) {
      return [];
    }
    const normalized = tieredPrices
      .map((item) => {
        if (!item || typeof item !== "object") {
          return null;
        }
        const upToMinutes = Number.isFinite(Number(item.upToMinutes))
          ? Number(item.upToMinutes)
          : Number.isFinite(Number(item.upToHours))
            ? Number(item.upToHours) * 60
            : Number.isFinite(Number(item.upTo))
              ? Number(item.upTo)
              : Number.POSITIVE_INFINITY;
        const unitPrice = Number.isFinite(Number(item.unitPrice))
          ? Number(item.unitPrice)
          : Number.isFinite(Number(item.unitPricePerMinute))
            ? Number(item.unitPricePerMinute)
            : Number.isFinite(Number(item.unitPricePerHour))
              ? Number(item.unitPricePerHour) / 60
              : Number(fallbackPrice);
        if (!Number.isFinite(unitPrice) || unitPrice < 0) {
          return null;
        }
        return { upToMinutes, unitPrice };
      })
      .filter(Boolean);
    return normalized.sort((a, b) => {
      if (a.upToMinutes === b.upToMinutes) {
        return 0;
      }
      if (a.upToMinutes === Number.POSITIVE_INFINITY) {
        return 1;
      }
      if (b.upToMinutes === Number.POSITIVE_INFINITY) {
        return -1;
      }
      return a.upToMinutes - b.upToMinutes;
    });
  };

  const normalizePricing = (pricing = {}) => {
    const planPriceById = pricing.planPriceById || {};
    const modelUnitPrice = Number(pricing.modelUnitPrice);
    const fallbackUnitPrice = Number.isFinite(modelUnitPrice) ? modelUnitPrice : defaultPricing.modelUnitPrice;
    return {
      planPriceById,
      modelUnitPrice: fallbackUnitPrice,
      modelUnitLabel: pricing.modelUnitLabel || defaultPricing.modelUnitLabel,
      tieredPrices: normalizeTieredPrices(pricing.tieredPrices || defaultPricing.tieredPrices, fallbackUnitPrice)
    };
  };

  const getPricing = (baseId) => {
    if (!baseId) {
      return normalizePricing({});
    }
    return normalizePricing(pricingMap.get(baseId) || {});
  };

  const setPricing = (baseId, nextPricing) => {
    const normalized = normalizeBaseId(baseId);
    if (!normalized) {
      return false;
    }
    const pricing = normalizePricing(nextPricing || {});
    pricingMap.set(normalized, pricing);
    if (onPersist) {
      onPersist({
        pricingByBaseId: Object.fromEntries(pricingMap.entries()),
        usageByBaseId: Object.fromEntries(usageMap.entries()),
        dailyUsageByBaseId: Object.fromEntries(dailyUsageMap.entries())
      });
    }
    return true;
  };

  const getUsage = (baseId) => {
    const normalized = normalizeBaseId(baseId);
    if (!normalized) {
      return { count: 0, cost: 0 };
    }
    const usage = usageMap.get(normalized) || {};
    const count = Number.isFinite(Number(usage.count)) ? Number(usage.count) : Number(usage.minutes) || 0;
    return {
      count,
      minutes: count,
      cost: Number(usage.cost) || 0
    };
  };

  const getDailyUsage = (baseId, dateKey = getDateKey(Date.now())) => {
    const normalized = normalizeBaseId(baseId);
    if (!normalized) {
      return { date: dateKey, minutes: 0, cost: 0 };
    }
    const dailyByDate = dailyUsageMap.get(normalized) || {};
    const daily = dailyByDate[dateKey] || {};
    return {
      date: dateKey,
      minutes: Number(daily.minutes) || 0,
      cost: Number(daily.cost) || 0
    };
  };

  const resolveCurrentTierUnitPrice = (tieredPrices, totalMinutes, fallbackUnitPrice) => {
    if (!tieredPrices?.length) {
      return fallbackUnitPrice;
    }
    for (const tier of tieredPrices) {
      if (totalMinutes <= tier.upToMinutes) {
        return tier.unitPrice;
      }
    }
    return tieredPrices[tieredPrices.length - 1].unitPrice || fallbackUnitPrice;
  };

  const calculateTieredCost = (tieredPrices, prevMinutes, addMinutes, fallbackUnitPrice) => {
    if (!tieredPrices?.length) {
      return addMinutes * fallbackUnitPrice;
    }
    let remaining = addMinutes;
    let cost = 0;
    let cursor = prevMinutes;
    for (const tier of tieredPrices) {
      if (remaining <= 0) {
        break;
      }
      const limit = tier.upToMinutes;
      const available = Number.isFinite(limit) ? Math.max(0, limit - cursor) : remaining;
      if (available <= 0) {
        continue;
      }
      const used = Math.min(remaining, available);
      cost += used * tier.unitPrice;
      remaining -= used;
      cursor += used;
    }
    if (remaining > 0) {
      cost += remaining * fallbackUnitPrice;
    }
    return cost;
  };

  const recordUsage = ({ baseId, units = 1, minutes, durationMs, occurredAt }) => {
    const normalized = normalizeBaseId(baseId);
    if (!normalized) {
      return { count: 0, cost: 0 };
    }
    const pricing = getPricing(normalized);
    const prev = getUsage(normalized);
    const resolvedMinutes =
      Number.isFinite(Number(minutes)) && Number(minutes) > 0
        ? Number(minutes)
        : Number.isFinite(Number(durationMs)) && Number(durationMs) > 0
          ? Math.max(1, Math.ceil(Number(durationMs) / 60000))
          : Number.isFinite(Number(units)) && Number(units) > 0
            ? Number(units)
            : 1;
    const dateKey = getDateKey(Number.isFinite(Number(occurredAt)) ? Number(occurredAt) : Date.now());
    const dailyPrev = getDailyUsage(normalized, dateKey);
    const dailyCostDelta = calculateTieredCost(
      pricing.tieredPrices,
      dailyPrev.minutes,
      resolvedMinutes,
      pricing.modelUnitPrice
    );
    const nextDailyMinutes = dailyPrev.minutes + resolvedMinutes;
    const nextDailyCost = Number((dailyPrev.cost + dailyCostDelta).toFixed(4));
    const dailyByDate = dailyUsageMap.get(normalized) || {};
    dailyByDate[dateKey] = { minutes: nextDailyMinutes, cost: nextDailyCost };
    dailyUsageMap.set(normalized, dailyByDate);

    const nextCount = prev.count + resolvedMinutes;
    const nextCost = Number((prev.cost + dailyCostDelta).toFixed(4));
    usageMap.set(normalized, { count: nextCount, minutes: nextCount, cost: nextCost });
    if (onPersist) {
      onPersist({
        pricingByBaseId: Object.fromEntries(pricingMap.entries()),
        usageByBaseId: Object.fromEntries(usageMap.entries()),
        dailyUsageByBaseId: Object.fromEntries(dailyUsageMap.entries())
      });
    }
    return {
      count: nextCount,
      minutes: nextCount,
      cost: nextCost,
      dailyMinutes: nextDailyMinutes,
      dailyCost: nextDailyCost,
      unitPrice: resolveCurrentTierUnitPrice(pricing.tieredPrices, nextDailyMinutes, pricing.modelUnitPrice),
      unitLabel: pricing.modelUnitLabel
    };
  };

  return {
    getPricing,
    setPricing,
    getUsage,
    getDailyUsage,
    resolveCurrentTierUnitPrice,
    recordUsage
  };
};

export const createUsageRecorder = ({ billingTasks, billingStore }) => {
  return ({ taskId, durationMs }) => {
    if (!taskId) {
      return null;
    }
    const cached = billingTasks.get(taskId);
    if (cached?.charged) {
      return null;
    }
    if (!cached) {
      return null;
    }
    const normalized = normalizeBaseId(cached.baseId);
    if (!normalized) {
      billingTasks.delete(taskId);
      return null;
    }
    const cachedDurationMs = Number(cached?.durationMs);
    const passedDurationMs = Number(durationMs);
    const resolvedDurationMs =
      Number.isFinite(cachedDurationMs) && cachedDurationMs > 0
        ? cachedDurationMs
        : Number.isFinite(passedDurationMs) && passedDurationMs > 0
          ? passedDurationMs
          : undefined;
    billingTasks.delete(taskId);
    return billingStore.recordUsage({ baseId: normalized, durationMs: resolvedDurationMs });
  };
};
