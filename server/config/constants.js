export const seedAdminBaseIds = ["Caasb9qNgaJ6jgskH7OcAkMOnaf"];

export const seedRedeemCodeList = [
  "FREE-1M-H0K4-3N8Q",
  "FREE-1M-T9R2-5J6P",
  "FREE-1M-X7M1-8V2C"
];

const hourlyUnitPrice = 6.5;

export const defaultPricing = {
  modelUnitPrice: hourlyUnitPrice / 60,
  modelUnitLabel: "分钟",
  tieredPrices: []
};

export const billingPlans = [
  { id: "monthly", label: "月度", price: 9.9, durationMs: 30 * 24 * 60 * 60 * 1000, usageNote: "模型调用费用另计" },
  { id: "quarterly", label: "季度", price: 19.9, durationMs: 90 * 24 * 60 * 60 * 1000, usageNote: "模型调用费用另计" },
  { id: "halfyear", label: "半年", price: 49.9, durationMs: 180 * 24 * 60 * 60 * 1000, usageNote: "模型调用费用另计" }
];
