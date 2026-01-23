import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFiles } from "./config/env.js";
import { initStores } from "./services/store.service.js";
import { requestLogger } from "./middleware/logger.js";
import { errorHandler } from "./middleware/error.js";
import transcribeRoutes from "./routes/transcribe.routes.js";
import subscriptionRoutes from "./routes/subscription.routes.js";
import billingRoutes from "./routes/billing.routes.js";

const app = express();
const port = Number.parseInt(process.env.PORT || "5174", 10);
const env = process.env.NODE_ENV || "development";

// 1. Load Env
loadEnvFiles(env);

// 2. Init Stores
initStores();

// 3. Global Middleware
app.use(express.json({
  limit: "1mb",
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false }));

// Security Headers
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

// Logging
app.use(requestLogger);

// 4. Routes
app.use("/api/transcribe", transcribeRoutes);
app.use("/api/subscription", subscriptionRoutes);
app.use("/api/billing", billingRoutes);

// 5. Static Files (Production)
if (env === "production") {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const distPath = path.resolve(__dirname, "../dist");
  app.use(express.static(distPath));
  app.get("*", (req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

// 6. Error Handler
app.use(errorHandler);

// 7. Start Server
if (env !== "test") {
  app.listen(port, () => {
    console.log(`api:${port}`);
  });
}

export default app;
