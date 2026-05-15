#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const CLI_PACKAGE_PATH = "packages/cli/package.json";
const LOCKFILE_PATH = "package-lock.json";
const CLI_DIST_PATH = "packages/cli/dist/cli.js";
const KNOWN_FLAGS = new Set([
  "--push",
  "--dry-run",
  "--skip-checks",
  "--allow-dirty",
  "--allow-non-main",
  "--help",
  "-h",
]);
const RELEASE_CHECKS = [
  ["npm", ["-w", "packages/cli", "run", "build"]],
  ["npm", ["-w", "packages/cli", "run", "typecheck"]],
  ["npm", ["-w", "packages/cli", "run", "lint"]],
  ["npm", ["-w", "packages/cli", "test"]],
];

function printUsage() {
  console.log(`Usage:
  npm run release -- <version> [--push]

Examples:
  npm run release -- 1.0.6
  npm run release -- 1.0.6 --push
  npm run release -- 1.0.6 --dry-run --allow-non-main --allow-dirty

Options:
  --push             Push main and the release tag after creating them locally.
  --dry-run          Print the planned release without editing files, committing, or tagging.
  --skip-checks      Skip local build/typecheck/lint/test checks.
  --allow-dirty      Allow a dirty working tree before the release command starts.
  --allow-non-main   Allow running from a branch other than main.
  --help             Show this help.
`);
}

function run(command, args, opts = {}) {
  const printable = [command, ...args].join(" ");
  if (opts.dryRun) {
    console.log(`$ ${printable}`);
    return "";
  }
  console.log(`$ ${printable}`);
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value, dryRun) {
  if (dryRun) return;
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function normalizeVersion(input) {
  const version = input.startsWith("v") ? input.slice(1) : input;
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Release version must be x.y.z, got: ${input}`);
  }
  return version;
}

function gitOutput(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function assertCleanWorktree(allowDirty) {
  if (allowDirty) return;
  const status = gitOutput(["status", "--porcelain"]);
  if (status) {
    throw new Error(
      "Working tree must be clean before release. Commit/stash changes or pass --allow-dirty.",
    );
  }
}

function assertMainBranch(allowNonMain) {
  if (allowNonMain) return;
  const branch = gitOutput(["branch", "--show-current"]);
  if (branch !== "main") {
    throw new Error(`Release command must run on main, current branch is: ${branch}`);
  }
}

function assertTagAvailable(tag) {
  const existing = gitOutput(["tag", "--list", tag]);
  if (existing) throw new Error(`Local tag already exists: ${tag}`);
}

function updateVersions(version, dryRun) {
  const cliPackage = readJson(CLI_PACKAGE_PATH);
  cliPackage.version = version;
  writeJson(CLI_PACKAGE_PATH, cliPackage, dryRun);

  const lockfile = readJson(LOCKFILE_PATH);
  const packages = lockfile.packages;
  const cliPackageLock = packages?.["packages/cli"];
  if (!cliPackageLock) {
    throw new Error("package-lock.json is missing packages/cli metadata.");
  }
  cliPackageLock.version = version;
  writeJson(LOCKFILE_PATH, lockfile, dryRun);
}

function previewReleaseNotes(tag) {
  console.log("\nRelease note preview:\n");
  const output = execFileSync(
    "git-cliff",
    ["--config", ".github/cliff.toml", "--unreleased", "--tag", tag, "--strip", "header"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  console.log(output.trim());
  console.log("");
}

function commitAndTag(version, tag, dryRun) {
  run("git", ["add", CLI_PACKAGE_PATH, LOCKFILE_PATH], { dryRun });
  run("git", ["add", "-f", CLI_DIST_PATH], { dryRun });
  run(
    "git",
    [
      "commit",
      "-m",
      `chore: bump version to ${version}`,
      "-m",
      [
        "Why",
        `Prepare the CLI package for the v${version} release. The release workflow publishes the committed package version, so package metadata and the bundled CLI must match the tag.`,
        "",
        "User impact",
        `The v${version} npm package and GitHub release will publish the changes already merged on main.`,
        "",
        "Verification",
        "npm -w packages/cli run build",
        "npm -w packages/cli run typecheck",
        "npm -w packages/cli run lint",
        "npm -w packages/cli test",
        `git-cliff --config .github/cliff.toml --unreleased --tag ${tag} --strip header`,
        "",
        "Release note: skip",
      ].join("\n"),
    ],
    { dryRun },
  );
  run("git", ["tag", "-a", tag, "-m", tag], { dryRun });
}

function parseArgs(argv) {
  const flags = new Set(argv.filter((arg) => arg.startsWith("-")));
  const positional = argv.filter((arg) => !arg.startsWith("-"));
  for (const flag of flags) {
    if (!KNOWN_FLAGS.has(flag)) {
      throw new Error(`Unknown option: ${flag}`);
    }
  }
  if (positional.length > 1) {
    throw new Error(`Expected one version argument, got: ${positional.join(" ")}`);
  }
  return {
    version: positional[0] ?? null,
    push: flags.has("--push"),
    dryRun: flags.has("--dry-run"),
    skipChecks: flags.has("--skip-checks"),
    allowDirty: flags.has("--allow-dirty"),
    allowNonMain: flags.has("--allow-non-main"),
    help: flags.has("--help") || flags.has("-h"),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.version) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }

  const version = normalizeVersion(args.version);
  const tag = `v${version}`;

  assertMainBranch(args.allowNonMain);
  assertCleanWorktree(args.allowDirty);
  assertTagAvailable(tag);

  console.log(`Preparing ${tag}${args.dryRun ? " (dry run)" : ""}`);
  updateVersions(version, args.dryRun);

  if (!args.skipChecks) {
    for (const [command, commandArgs] of RELEASE_CHECKS) {
      run(command, commandArgs, { dryRun: args.dryRun });
    }
  }

  previewReleaseNotes(tag);
  commitAndTag(version, tag, args.dryRun);

  if (args.push) {
    run("git", ["push", "origin", "main"], { dryRun: args.dryRun });
    run("git", ["push", "origin", tag], { dryRun: args.dryRun });
  } else {
    console.log(`Local release commit and ${tag} tag are ready.`);
    console.log(`Run: git push origin main && git push origin ${tag}`);
  }
}

try {
  main();
} catch (error) {
  console.error(`release: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
