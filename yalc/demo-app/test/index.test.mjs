import assert from "node:assert/strict";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const packageRoot = fileURLToPath(new URL("../../packages/math-utils", import.meta.url));
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

test("declares the published yalc package as its dependency", () => {
  assert.ok(packageJson.dependencies["@sample-yalc/math-utils"]);
});

test("demo app runs with math-utils without a prior yalc installation", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "demo-app-test-"));
  const temporaryPackage = join(
    temporaryRoot,
    "node_modules",
    "@sample-yalc",
    "math-utils",
  );
  const packageJsonPath = join(packageRoot, "package.json");
  const libraryPackageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const compilerPath = join(projectRoot, "node_modules", "typescript", "bin", "tsc");

  try {
    cpSync(join(projectRoot, "src"), join(temporaryRoot, "src"), {
      recursive: true,
    });
    cpSync(
      join(projectRoot, "tsconfig.json"),
      join(temporaryRoot, "tsconfig.json"),
    );
    mkdirSync(temporaryPackage, { recursive: true });
    writeFileSync(
      join(temporaryRoot, "package.json"),
      JSON.stringify(packageJson),
    );
    writeFileSync(
      join(temporaryPackage, "package.json"),
      JSON.stringify(libraryPackageJson),
    );

    const libraryBuild = spawnSync(
      process.execPath,
      [
        compilerPath,
        "--ignoreConfig",
        "--target",
        "ES2020",
        "--module",
        "commonjs",
        "--declaration",
        "--rootDir",
        join(packageRoot, "src"),
        "--outDir",
        temporaryPackage,
        join(packageRoot, "src", "index.ts"),
      ],
      { cwd: temporaryRoot, encoding: "utf8" },
    );
    assert.equal(
      libraryBuild.status,
      0,
      libraryBuild.error?.message ??
        `${libraryBuild.stdout}\n${libraryBuild.stderr}`,
    );

    const appBuild = spawnSync(process.execPath, [compilerPath], {
      cwd: temporaryRoot,
      encoding: "utf8",
    });
    assert.equal(
      appBuild.status,
      0,
      appBuild.error?.message ?? `${appBuild.stdout}\n${appBuild.stderr}`,
    );

    const result = spawnSync(process.execPath, ["dist/index.js"], {
      cwd: temporaryRoot,
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
    assert.match(result.stdout, /10 \+ 5 = 15/);
    assert.match(result.stdout, /10 - 5 = 5/);
    assert.match(result.stdout, /10 × 5 = 50/);
    assert.match(result.stdout, /10 ÷ 5 = 2/);
    assert.match(result.stderr, /エラー: Division by zero is not allowed/);
    assert.match(result.stdout, /Demo completed successfully/);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});