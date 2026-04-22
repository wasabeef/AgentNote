import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://wasabeef.github.io",
  base: "/AgentNote",
  devToolbar: {
    enabled: false,
  },
  integrations: [
    starlight({
      title: "Agent Note",
      disable404Route: true,
      logo: {
        src: "./src/assets/logo.jpg",
        alt: "Agent Note",
      },
      favicon: "/favicon.png",
      customCss: ["./src/styles/custom.css"],
      description: "Know why your code changed, not just what changed.",
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/wasabeef/AgentNote" },
      ],
      head: [
        { tag: "meta", attrs: { property: "og:image", content: "/AgentNote/og.png" } },
        { tag: "meta", attrs: { property: "og:image:width", content: "1536" } },
        { tag: "meta", attrs: { property: "og:image:height", content: "1024" } },
        { tag: "meta", attrs: { name: "twitter:card", content: "summary_large_image" } },
        { tag: "meta", attrs: { name: "twitter:image", content: "/AgentNote/og.png" } },
        {
          tag: "script",
          content: `
            (function() {
              if (sessionStorage.getItem('lang-redirected')) return;
              var path = location.pathname;
              var base = '/AgentNote';
              var locales = ['ja','fr','de','it','es','ko','zh-cn','zh-tw','ru','id','pt-br'];
              var isRoot = path === base || path === base + '/';
              if (!isRoot) return;
              var lang = (navigator.language || '').toLowerCase();
              var match = locales.find(function(l) {
                return lang === l || lang.startsWith(l.split('-')[0]);
              });
              if (match) {
                sessionStorage.setItem('lang-redirected', '1');
                location.replace(base + '/' + match + '/');
              }
            })();
          `,
        },
      ],
      defaultLocale: "root",
      locales: {
        root: { label: "English", lang: "en" },
        ja: { label: "日本語", lang: "ja" },
        fr: { label: "Français", lang: "fr" },
        de: { label: "Deutsch", lang: "de" },
        it: { label: "Italiano", lang: "it" },
        es: { label: "Español", lang: "es" },
        ko: { label: "한국어", lang: "ko" },
        "zh-cn": { label: "简体中文", lang: "zh-CN" },
        "zh-tw": { label: "繁體中文", lang: "zh-TW" },
        ru: { label: "Русский", lang: "ru" },
        id: { label: "Bahasa Indonesia", lang: "id" },
        "pt-br": { label: "Português (BR)", lang: "pt-BR" },
      },
      sidebar: [
        {
          label: "Basics",
          items: [
            { slug: "getting-started" },
            { slug: "commands" },
            { slug: "how-it-works" },
          ],
        },
        {
          label: "GitHub",
          items: [{ slug: "github-action" }, { slug: "dashboard" }],
        },
      ],
      editLink: {
        baseUrl: "https://github.com/wasabeef/AgentNote/edit/main/website/",
      },
    }),
  ],
});
