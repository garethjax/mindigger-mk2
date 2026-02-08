import { defineConfig } from "astro/config";
import preact from "@astrojs/preact";
import tailwindcss from "@tailwindcss/vite";
import vercel from "@astrojs/vercel";

export default defineConfig({
  output: "server",
  adapter: vercel(),
  integrations: [preact({ compat: true })],
  vite: {
    plugins: [tailwindcss()],
  },
});
