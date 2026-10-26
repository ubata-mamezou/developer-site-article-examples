import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

test("declares the published yalc package as its dependency", () => {
  assert.ok(packageJson.dependencies["@sample-yalc/math-utils"]);
});

test("demo app runs with math-utils resolved from yalc", (t) => {
  const installedPackage = `${projectRoot}/node_modules/@sample-yalc/math-utils`;
  if (!existsSync(installedPackage)) {
    t.skip("Run yalc add @sample-yalc/math-utils in demo-app first");
    return;
  }

  const build = spawnSync(
    process.execPath,
    ["node_modules/typescript/bin/tsc"],
    { cwd: projectRoot, encoding: "utf8" },
  );
  assert.equal(build.status, 0, build.stderr);

  const result = spawnSync(process.execPath, ["dist/index.js"], {
    cwd: projectRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /10 \+ 5 = 15/);
  assert.match(result.stdout, /10 - 5 = 5/);
  assert.match(result.stdout, /10 × 5 = 50/);
  assert.match(result.stdout, /10 ÷ 5 = 2/);
  assert.match(result.stdout, /Demo completed successfully/);
});