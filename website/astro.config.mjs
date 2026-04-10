import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://wasabeef.github.io",
  base: "/agentnote",
  integrations: [
    starlight({
      title: "Agent Note",
      logo: {
        src: "./src/assets/logo.jpg",
        alt: "Agent Note",
      },
      favicon: "/favicon.png",
      customCss: ["./src/styles/custom.css"],
      description: "Know why your code changed, not just what changed.",
      head: [
        { tag: "meta", attrs: { property: "og:image", content: "/agentnote/og.png" } },
        { tag: "meta", attrs: { property: "og:image:width", content: "1536" } },
        { tag: "meta", attrs: { property: "og:image:height", content: "1024" } },
        { tag: "meta", attrs: { name: "twitter:card", content: "summary_large_image" } },
        { tag: "meta", attrs: { name: "twitter:image", content: "/agentnote/og.png" } },
      ],
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/wasabeef/agentnote" },
      ],
      sidebar: [
        { slug: "getting-started" },
        { slug: "how-it-works" },
        { slug: "commands" },
        { slug: "github-action" },
      ],
      editLink: {
        baseUrl: "https://github.com/wasabeef/agentnote/edit/main/website/",
      },
    }),
  ],
});
