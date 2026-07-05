import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";

export function minifyOrCopyJson(srcPath, destPath) {
  if (extname(srcPath).toLowerCase() !== ".json") {
    copyFileSync(srcPath, destPath);
    return false;
  }

  const raw = readFileSync(srcPath, "utf8");
  try {
    const parsed = JSON.parse(raw);
    writeFileSync(destPath, JSON.stringify(parsed));
    return true;
  } catch (err) {
    if (err instanceof SyntaxError) {
      copyFileSync(srcPath, destPath);
      return false;
    }
    throw err;
  }
}
