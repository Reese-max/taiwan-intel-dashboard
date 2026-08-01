import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatNetworkContractErrors,
  NETWORK_FILE,
  readNetworkFile,
} from "./lib/network-contract.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fileArg = process.argv.find((arg) => arg.startsWith("--file="));
const fileName = fileArg ? fileArg.slice("--file=".length) : NETWORK_FILE;
const filePath = resolve(ROOT, fileName);
const result = readNetworkFile(filePath);

if (result.errors.length) {
  console.error(`產物契約驗收失敗（${result.errors.length} 個問題）：`);
  console.error(formatNetworkContractErrors(fileName, result.errors));
  process.exitCode = 1;
} else {
  console.log(`產物契約驗收通過：${fileName}`);
}
