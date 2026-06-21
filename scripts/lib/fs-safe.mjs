import { existsSync, readdirSync, rmdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export function emptyDirContents(dir) {
  if (!existsSync(dir)) return;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const target = join(dir, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      emptyDirContents(target);
      rmdirSync(target);
    } else {
      unlinkSync(target);
    }
  }
}
