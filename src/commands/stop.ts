import { readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { hooksDir, sessionFile, settingsFile } from "../paths.js";

export async function stop(): Promise<void> {
  const settingsPath = await settingsFile();

  // settings.json から lore hooks を削除
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
      if (settings.hooks) {
        for (const [event, entries] of Object.entries(settings.hooks)) {
          settings.hooks[event] = (entries as any[]).filter(
            (entry) => !JSON.stringify(entry).includes("lore-hook"),
          );
          if (settings.hooks[event].length === 0) {
            delete settings.hooks[event];
          }
        }
        if (Object.keys(settings.hooks).length === 0) {
          delete settings.hooks;
        }
        await writeFile(
          settingsPath,
          JSON.stringify(settings, null, 2) + "\n",
        );
      }
    } catch {
      // settings.json が壊れていても無視
    }
  }

  // hook script 削除
  const hookPath = `${await hooksDir()}/lore-hook.sh`;
  if (existsSync(hookPath)) {
    await rm(hookPath);
  }

  // session file 削除
  const sf = await sessionFile();
  if (existsSync(sf)) {
    await rm(sf);
  }

  console.log("lore: stopped and hooks removed.");
}
