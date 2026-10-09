import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { port: 5173, host: true, open: false, strictPort: true },
  preview: { port: 8080, host: true, strictPort: true },
  // rhino3dm 是 wasm 模块，vite 预构建会出问题，这里排除
  optimizeDeps: { exclude: ["rhino3dm"] },
});
