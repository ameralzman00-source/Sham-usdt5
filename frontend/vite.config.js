import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const target = "http://127.0.0.1:3001";

const proxy = {
  "/api": { target, changeOrigin: true },
  "/download": { target, changeOrigin: true }
};

export default defineConfig({
  plugins: [react({ fastRefresh: false })],
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: [".monkeycode-ai.live"],
    hmr: false,
    cors: true,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store"
    },
    proxy
  },
  preview: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: [".monkeycode-ai.live"],
    cors: true,
    proxy
  }
});
