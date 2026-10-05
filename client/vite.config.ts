import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    hmr: false,
    host: "0.0.0.0",
    port: Number(process.env.PORT || 5173),
    proxy: {
      "/api": {
        // API_PORT is set in dev:all so the API never fights Vite for $PORT.
        target: `http://localhost:${process.env.API_PORT || 4000}`,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: "0.0.0.0",
    port: Number(process.env.PORT || 4173),
  },
});
