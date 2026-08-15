import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Local preview only. crowd-tape.jsx is meant to be dropped into your own
// React app; this harness just renders it so you can see changes live.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5199 },
});
