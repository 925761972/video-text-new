import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:5174"
    }
  }
});
