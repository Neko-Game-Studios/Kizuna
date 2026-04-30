import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const PROJECT_ROOT = path.resolve(__dirname, "..");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, PROJECT_ROOT, "");
  const port = Number(env.PORT ?? process.env.PORT ?? 3456);

  return {
    root: path.resolve(__dirname),
    envDir: PROJECT_ROOT,
    plugins: [react(), tailwindcss()],
    server: {
      host: "127.0.0.1",
      port: 5173,
      proxy: {
        "/api": {
          target: `http://localhost:${port}`,
          rewrite: (p) => p.replace(/^\/api/, ""),
          configure: (proxy) => {
            proxy.on("error", () => {
            });
          },
        },
        "/ws": {
          target: `ws://localhost:${port}`,
          ws: true,
          configure: (proxy) => {
            proxy.on("error", () => {
            });
          },
        },
      },
    },
    build: { outDir: path.resolve(__dirname, "dist") },
  };
});
