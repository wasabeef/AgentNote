import { defineConfig } from "astro/config";

export default defineConfig({
  site: process.env.SITE ?? "https://wasabeef.github.io",
  base: process.env.BASE ?? "/AgentNote/dashboard",
});
