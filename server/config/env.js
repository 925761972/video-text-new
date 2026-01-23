import fs from "node:fs";
import path from "node:path";

export const loadEnvFile = (filePath) => {
  if (!filePath || !fs.existsSync(filePath)) {
    return;
  }
  const content = fs.readFileSync(filePath, "utf-8");
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }
    const index = trimmed.indexOf("=");
    if (index <= 0) {
      return;
    }
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (!key) {
      return;
    }
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  });
};

export const loadEnvFiles = (env) => {
  const basePath = path.resolve(process.cwd(), ".env");
  const envPath = path.resolve(process.cwd(), `.env.${env}`);
  loadEnvFile(basePath);
  if (envPath !== basePath) {
    loadEnvFile(envPath);
  }
};
