import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Serves the page locally (npm run dev) and builds the static bundle that
// GitHub Pages publishes (npm run build).
//
// base must match the repo name: Pages serves a project site from
// /crowd-tape/, so asset URLs need that prefix or they 404 in production
// while working fine locally. Rename the repo -> change this.
export default defineConfig({
  base: "/crowd-tape/",
  plugins: [react(), tailwindcss()],
  server: { port: 5199 },
  build: { outDir: "dist", emptyOutDir: true },
});
