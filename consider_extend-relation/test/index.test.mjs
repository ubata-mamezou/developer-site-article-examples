import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

test("customer relation examples execute and print each customer", () => {
  const result = spawnSync(process.execPath, ["dist/index.js"], {
    cwd: projectRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Customer ID: 1, Name: John Doe/);
  assert.match(result.stdout, /Customer ID: 2, Name: Acme Corp/);
  assert.match(result.stdout, /Customer ID: 3, Name: Jane Doe/);
});