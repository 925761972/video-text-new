import { logEvent } from "./logger.js";

const env = process.env.NODE_ENV || "development";

export const createHttpError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

export const asyncHandler = (handler) => {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
};

export const errorHandler = (err, req, res, next) => {
  const status = Number(err?.status) || 500;
  const message = err?.message || "服务端错误";
  logEvent("error", {
    type: "error",
    message,
    status,
    stack: env === "production" ? undefined : err?.stack
  });
  if (res.headersSent) {
    next(err);
    return;
  }
  res.status(status).json({ message, status });
};
