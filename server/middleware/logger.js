const env = process.env.NODE_ENV || "development";
const shouldLog = env !== "test";

export const logEvent = (level, payload) => {
  if (!shouldLog) {
    return;
  }
  const entry = {
    level,
    time: new Date().toISOString(),
    ...payload
  };
  const text = JSON.stringify(entry);
  if (level === "error") {
    console.error(text);
    return;
  }
  console.log(text);
};

export const requestLogger = (req, res, next) => {
  const startedAt = Date.now();
  res.on("finish", () => {
    logEvent("info", {
      type: "access",
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      durationMs: Date.now() - startedAt
    });
  });
  next();
};
