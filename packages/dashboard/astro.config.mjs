import { defineConfig } from "astro/config";

function normalizeBase(base) {
  if (!base || base === "/") return "/";

  const trimmed = base.endsWith("/") ? base.slice(0, -1) : base;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

const site = process.env.SITE;

export default defineConfig({
  ...(site ? { site } : {}),
  base: normalizeBase(process.env.BASE),
});
