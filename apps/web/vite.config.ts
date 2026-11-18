import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: { "/api": "http://127.0.0.1:3001" } },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          charts: ["recharts"],
          barcode: ["jsbarcode"],
          forms: ["react-hook-form", "zod", "@hookform/resolvers/zod"],
          query: ["@tanstack/react-query"],
        },
      },
    },
  },
});
