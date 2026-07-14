import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/screwdealer/",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/apple-touch-icon.png", "assets/card-back.png", "assets/table-texture.png"],
      manifest: {
        name: "Screw the Dealer",
        short_name: "Screw Dealer",
        description: "A live multiplayer party card game.",
        start_url: "/screwdealer/",
        scope: "/screwdealer/",
        display: "standalone",
        orientation: "portrait-primary",
        background_color: "#071018",
        theme_color: "#071018",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        navigateFallback: "/screwdealer/index.html",
        globPatterns: ["**/*.{js,css,html,png,webp,woff2}"],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
      },
    }),
  ],
  server: { port: 5173 },
});
