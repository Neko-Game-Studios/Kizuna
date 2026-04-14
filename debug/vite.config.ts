import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const PROJECT_ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT ?? 3456);

export default defineConfig({
  root: path.resolve(__dirname),
  envDir: PROJECT_ROOT,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: `http://localhost:${PORT}`,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
      "/ws": { target: `ws://localhost:${PORT}`, ws: true },
    },
  },
  build: { outDir: path.resolve(__dirname, "dist") },
});
