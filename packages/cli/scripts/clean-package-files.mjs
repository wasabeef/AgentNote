import { rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = resolve(SCRIPT_DIR, "..");
const GENERATED_PACKAGE_FILES = ["README.md", "LICENSE"];

for (const fileName of GENERATED_PACKAGE_FILES) {
  rmSync(join(PACKAGE_DIR, fileName), { force: true });
}
