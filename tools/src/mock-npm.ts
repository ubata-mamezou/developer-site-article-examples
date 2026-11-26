import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const original = readFileSync("package-lock.json", "utf8");
const parsed: unknown = JSON.parse(original);
const updated = `${JSON.stringify(parsed, null, 2)}\n`;
const fixed = original === updated;

if (args[0] === "audit" && args[1] === "fix") {
  writeFileSync("package-lock.json", updated);
} else if (args[0] === "audit" && args[1] === "--json") {
  console.log(JSON.stringify({ metadata: { vulnerabilities: { total: fixed ? 0 : 1 } } }));
  process.exitCode = fixed ? 0 : 1;
} else if (args[0] === "test") {
  if (fixed && process.env.FAIL_AFTER_FIX === "1") {
    console.error("模擬テスト失敗");
    process.exitCode = 1;
  } else {
    console.log("ℹ pass 1");
  }
} else if (args[0] !== "ci" && !(args[0] === "run" && args[1] === "build")) {
  throw new Error(`未対応の模擬npmコマンド: ${args.join(" ")}`);
}
