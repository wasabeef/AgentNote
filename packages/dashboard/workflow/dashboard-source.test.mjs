import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardSource = readFileSync(join(__dirname, "..", "src", "pages", "index.astro"), "utf-8");

function sourceBetween(startMarker, endMarker) {
  const start = dashboardSource.indexOf(startMarker);
  const end = dashboardSource.indexOf(endMarker, start);
  assert.notEqual(start, -1, `${startMarker} should exist`);
  assert.notEqual(end, -1, `${endMarker} should exist`);
  return dashboardSource.slice(start, end);
}

describe("dashboard markdown renderer source", () => {
  it("does not depend on runtime CDN imports", () => {
    assert.ok(!dashboardSource.includes("https://esm.sh/"));
    assert.ok(!dashboardSource.includes('import("https://'));
  });

  it("renders markdown without injecting raw HTML", () => {
    const rendererSource = sourceBetween("function safeMarkdownHref", "function compactText");
    assert.ok(rendererSource.includes("document.createTextNode"));
    assert.ok(rendererSource.includes("container.replaceChildren()"));
    assert.ok(rendererSource.includes("function appendTable"));
    assert.ok(rendererSource.includes("isMarkdownTableSeparator(lines[index + 1], tableHeaders.length)"));
    assert.ok(rendererSource.includes("cells.length === expectedCells && cells.length > 1"));
    assert.ok(rendererSource.includes("function appendTaskMarkerIfPresent"));
    assert.ok(!rendererSource.includes("innerHTML"));
  });

  it("allowlists link protocols before creating anchors", () => {
    const hrefSource = sourceBetween("function safeMarkdownHref", "function appendTextWithBreaks");
    assert.ok(hrefSource.includes('"http:"'));
    assert.ok(hrefSource.includes('"https:"'));
    assert.ok(hrefSource.includes('"mailto:"'));
    assert.ok(!hrefSource.includes("javascript:"));
  });
});

describe("dashboard line attribution display source", () => {
  it("does not render missing line data as 0/0 AI-added lines", () => {
    assert.ok(dashboardSource.includes("function lineAttributionLabel"));
    assert.ok(dashboardSource.includes("function lineSummaryLabel"));
    assert.ok(dashboardSource.includes("File-level attribution"));
    assert.ok(dashboardSource.includes("No AI-added lines"));
    assert.ok(dashboardSource.includes("Line data unavailable"));
    assert.ok(!dashboardSource.includes("lines.ai_added ?? 0} / ${lines.total_added ?? 0}"));
    assert.ok(dashboardSource.includes('h("span", { className: "stat warm" }, lineSummaryLabel(summary))'));
  });
});

describe("dashboard URL restore source", () => {
  it("does not rewrite an explicit missing PR URL to the latest PR", () => {
    const restoreSource = sourceBetween("function restoreFromUrl", "function showMissingSelection");
    assert.ok(restoreSource.includes('return showMissingSelection(`PR #${pr}`);'));
    assert.ok(restoreSource.includes("if (state.index?.prs?.length) return selectPR"));
    assert.ok(
      restoreSource.indexOf('return showMissingSelection(`PR #${pr}`);') <
        restoreSource.indexOf("if (state.index?.prs?.length) return selectPR"),
    );
  });
});
