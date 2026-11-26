import { readFileSync, writeFileSync } from "node:fs";
import * as semver from "semver";
import { dependencySections, simpleVersionSpec } from "./npm-policy.ts";

const args = process.argv.slice(2);
const original = readFileSync("package-lock.json", "utf8");
const parsed: unknown = JSON.parse(original);
const updated = `${JSON.stringify(parsed, null, 2)}\n`;
const fixed = original === updated;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

if (args[0] === "audit" && args[1] === "fix") {
  writeFileSync("package-lock.json", updated);
  const remaining = process.env.MOCK_FIX_UNRESOLVED === "1" ? 1 : 0;
  console.log(JSON.stringify({ audit: { metadata: { vulnerabilities: { total: remaining } } } }));
  process.exitCode = remaining === 0 ? 0 : 1;
} else if (args[0] === "version" && args[1] === "patch") {
  const manifest: unknown = JSON.parse(readFileSync("package.json", "utf8"));
  const lock: unknown = JSON.parse(original);
  if (!isObject(manifest) || typeof manifest.version !== "string" || !isObject(lock)
    || !isObject(lock.packages) || !isObject(lock.packages[""])) {
    throw new Error("模擬バージョン更新に必要な情報がありません。");
  }
  const version = semver.inc(manifest.version, "patch");
  if (!version) throw new Error("模擬パッチバージョンを計算できません。");
  manifest.version = version;
  lock.version = version;
  lock.packages[""].version = version;
  writeFileSync("package.json", `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync("package-lock.json", `${JSON.stringify(lock, null, 2)}\n`);
} else if (args[0] === "audit" && args[1] === "--json") {
  const clean = fixed || process.env.AUDIT_CLEAN === "1";
  console.log(JSON.stringify({ metadata: { vulnerabilities: { total: clean ? 0 : 1 } } }));
  process.exitCode = clean ? 0 : 1;
} else if (args[0] === "test") {
  if (fixed && process.env.FAIL_AFTER_FIX === "1") {
    console.error("模擬テスト失敗");
    process.exitCode = 1;
  } else {
    console.log("ℹ pass 1");
  }
} else if (args[0] === "outdated" && args[1] === "--json") {
  const report: unknown = JSON.parse(process.env.MOCK_OUTDATED_REPORT ?? "{}");
  if (!isObject(report)) throw new Error("模擬outdatedの結果が不正です。");
  console.log(JSON.stringify(report));
  process.exitCode = Object.keys(report).length ? 1 : 0;
} else if (args[0] === "view" && args[2] === "versions" && args[3] === "--json") {
  const reports: unknown = JSON.parse(process.env.MOCK_VERSIONS ?? "{}");
  if (!isObject(reports) || !Array.isArray(reports[args[1]])) throw new Error("模擬バージョン一覧がありません。");
  console.log(JSON.stringify(reports[args[1]]));
} else if (args[0] === "install" && args[1] === "--package-lock-only") {
  const manifest: unknown = JSON.parse(readFileSync("package.json", "utf8"));
  const lock: unknown = JSON.parse(original);
  if (!isObject(manifest) || !isObject(lock) || !isObject(lock.packages) || !isObject(lock.packages[""])) {
    throw new Error("模擬lockfile更新に必要な情報がありません。");
  }
  const rootPackage = lock.packages[""];
  for (const section of dependencySections) {
    const dependencies = manifest[section];
    if (!isObject(dependencies)) continue;
    rootPackage[section] = dependencies;
    for (const [name, value] of Object.entries(dependencies)) {
      const installed = lock.packages[`node_modules/${name}`];
      const spec = simpleVersionSpec(value);
      if (isObject(installed) && spec) installed.version = spec.version;
    }
  }
  writeFileSync("package-lock.json", `${JSON.stringify(lock, null, 2)}\n`);
} else if (args[0] !== "ci" && !(args[0] === "run" && args[1] === "build")) {
  throw new Error(`未対応の模擬npmコマンド: ${args.join(" ")}`);
}
