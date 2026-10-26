import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { add, subtract, multiply, divide } = require("../index.js");

test("performs the four basic arithmetic operations", () => {
  assert.equal(add(10, 5), 15);
  assert.equal(subtract(10, 5), 5);
  assert.equal(multiply(10, 5), 50);
  assert.equal(divide(10, 5), 2);
});

test("rejects division by zero", () => {
  assert.throws(() => divide(10, 0), /Division by zero/);
});