export const getVolcConfig = () => ({
  appId: process.env.VOLC_APP_ID,
  accessKey: process.env.VOLC_ACCESS_KEY,
  resourceId: process.env.VOLC_RESOURCE_ID || "volc.bigasr.auc"
});

export const ensureConfig = () => {
  const config = getVolcConfig();
  const missing = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(`缺少环境变量: ${missing.join(", ")}`);
  }
  return config;
};
