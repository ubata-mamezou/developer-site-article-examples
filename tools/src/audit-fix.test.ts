import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertTestsRan } from "./audit-fix.ts";
import { setupMockNpm } from "./mock-npm-setup.ts";

const script = fileURLToPath(new URL("./audit-fix.ts", import.meta.url));

function fixture() {
  const temp = mkdtempSync(path.join(tmpdir(), "audit-fix-test-"));
  const repo = path.join(temp, "repo");
  mkdirSync(path.join(repo, "project"), { recursive: true });
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
  git("init", "-q");
  git("config", "core.autocrlf", "false");
  writeFileSync(path.join(repo, "project", "package.json"), '{"name":"example","scripts":{"build":"build","test":"test"}}\n');
  writeFileSync(path.join(repo, "project", "package-lock.json"), '{"version":"1"}\n');
  writeFileSync(path.join(repo, "other.txt"), "old\n");
  git("add", ".");
  git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "base");
  return { temp, repo, git, cleanup: () => rmSync(temp, { recursive: true, force: true }) };
}

type Fixture = ReturnType<typeof fixture>;

function candidate(f: Fixture, file: string, content: string): string {
  const target = path.join(f.repo, file);
  const original = readFileSync(target);
  writeFileSync(target, content);
  const patch = f.git("diff", "--", file);
  writeFileSync(target, original);
  const patchFile = path.join(f.temp, "candidate.patch");
  writeFileSync(patchFile, patch);
  return patchFile;
}

function apply(f: Fixture, project: string, patchFile: string) {
  return spawnSync(process.execPath, [script, "apply", project, patchFile], {
    cwd: f.repo,
    encoding: "utf8",
  });
}

function prepareWithFakeNpm(f: Fixture, failAfterFix: boolean, project = "project") {
  const bin = path.join(f.temp, "bin");
  setupMockNpm(bin);
  const patch = path.join(f.temp, "generated.patch");
  const result = spawnSync(process.execPath, [script, "prepare", project, patch], {
    cwd: f.repo,
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, FAIL_AFTER_FIX: failAfterFix ? "1" : "0" },
  });
  return { result, patch };
}

test("正常なlockfile差分のみを適用する", () => {
  const f = fixture();
  try {
    const patch = candidate(f, "project/package-lock.json", '{"version":"2"}\n');
    const result = apply(f, "project", patch);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(path.join(f.repo, "project", "package-lock.json"), "utf8")), { version: "2" });
  } finally {
    f.cleanup();
  }
});

test("対象外のファイル変更を拒否する", () => {
  const f = fixture();
  try {
    const patch = candidate(f, "other.txt", "modified\n");
    const result = apply(f, "project", patch);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /対象lockfile以外/);
    assert.equal(readFileSync(path.join(f.repo, "other.txt"), "utf8"), "old\n");
  } finally {
    f.cleanup();
  }
});

test("不正なlockfileとリポジトリ外パスを拒否する", () => {
  const f = fixture();
  try {
    const patch = candidate(f, "project/package-lock.json", "invalid json\n");
    assert.notEqual(apply(f, "project", patch).status, 0);
    assert.notEqual(apply(f, "../project", patch).status, 0);
  } finally {
    f.cleanup();
  }
});

test("テスト全件スキップまたは結果不明を未検証として拒否する", () => {
  assert.doesNotThrow(() => assertTestsRan("ℹ pass 2\n", "project"));
  assert.doesNotThrow(() => assertTestsRan("# pass 1\n", "project"));
  assert.throws(() => assertTestsRan("ℹ pass 0\nℹ skipped 3\n", "project"), /未検証/);
  assert.throws(() => assertTestsRan("success\n", "project"), /未検証/);
});

test("修正後に検証を通過したlockfileの差分を作成する", () => {
  const f = fixture();
  try {
    const { result, patch } = prepareWithFakeNpm(f, false);
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(patch, "utf8"), /project\/package-lock\.json/);
    assert.match(result.stdout, /修正候補を作成/);
  } finally {
    f.cleanup();
  }
});

test("修正後のテスト失敗時は差分を作成しない", () => {
  const f = fixture();
  try {
    const { result, patch } = prepareWithFakeNpm(f, true);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /npm test が失敗/);
    assert.throws(() => readFileSync(patch), { code: "ENOENT" });
  } finally {
    f.cleanup();
  }
});

test("実行用フィクスチャの模擬差分を作成して適用する", () => {
  const f = fixture();
  try {
    const project = "tools/fixtures/audit-fix";
    const target = path.join(f.repo, project);
    const source = fileURLToPath(new URL("../fixtures/audit-fix/", import.meta.url));
    mkdirSync(target, { recursive: true });
    for (const file of ["package.json", "package-lock.json"]) {
      writeFileSync(path.join(target, file), readFileSync(path.join(source, file)));
    }
    f.git("add", project);
    f.git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture");
    const lock = path.join(target, "package-lock.json");
    const original = readFileSync(lock, "utf8");
    const { result, patch } = prepareWithFakeNpm(f, false, project);
    assert.equal(result.status, 0, result.stderr);
    const updated = readFileSync(lock, "utf8");
    assert.notEqual(updated, original);
    assert.deepEqual(JSON.parse(updated), JSON.parse(original));
    writeFileSync(lock, original);
    const applied = apply(f, project, patch);
    assert.equal(applied.status, 0, applied.stderr);
    assert.equal(readFileSync(lock, "utf8"), updated);
  } finally {
    f.cleanup();
  }
});

test("別名のローカル依存で参照されるプロジェクトを拒否する", () => {
  const f = fixture();
  try {
    mkdirSync(path.join(f.repo, "consumer"));
    writeFileSync(path.join(f.repo, "consumer", "package.json"),
      '{"name":"consumer","dependencies":{"alias":"file:../project"}}\n');
    f.git("add", "consumer/package.json");
    f.git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "consumer");
    const { result } = prepareWithFakeNpm(f, false);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ローカル参照/);
  } finally {
    f.cleanup();
  }
});

test("workspacesを定義するプロジェクト自身を拒否する", () => {
  const f = fixture();
  try {
    writeFileSync(path.join(f.repo, "project", "package.json"),
      '{"name":"example","workspaces":["packages/*"],"scripts":{"build":"build","test":"test"}}\n');
    f.git("add", "project/package.json");
    f.git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "workspaces");
    const { result } = prepareWithFakeNpm(f, false);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /workspacesの統合検証は未対応/);
  } finally {
    f.cleanup();
  }
});
