import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // npm workspaces run this script with cwd = apps/web, so Vite's default envDir (cwd)
  // never sees the monorepo-root .env that VITE_API_URL etc. actually live in — API_URL
  // silently fell back to "" and every request hit the Vite dev server itself instead
  // of the API, failing with a generic error instead of a real login failure message.
  envDir: "../..",
  server: { port: 5173, strictPort: true },
});
