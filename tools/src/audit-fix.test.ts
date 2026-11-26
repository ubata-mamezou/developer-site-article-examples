import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertTestsRan, parseAuditResult } from "./npm-commands.ts";
import { setupMockNpm } from "./mock-npm-setup.ts";
import { runRepair, type RepairSteps } from "./repair-flow.ts";
import { issueMarker, readCandidates, writeCandidates, type IssueCandidate } from "./issue-candidates.ts";
import { publishIssues } from "./issue-publisher.ts";
import { findAuditIssues } from "./npm-audit-issues.ts";
import { planOutdated } from "./npm-outdated.ts";
import { assertManifestChanges } from "./npm-project.ts";

const script = fileURLToPath(new URL("./audit-fix.ts", import.meta.url));

function fixture() {
  const temp = mkdtempSync(path.join(tmpdir(), "audit-fix-test-"));
  const repo = path.join(temp, "repo");
  mkdirSync(path.join(repo, "project"), { recursive: true });
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
  git("init", "-q");
  git("config", "core.autocrlf", "false");
  writeFileSync(path.join(repo, "project", "package.json"), '{"name":"example","version":"1.0.0","scripts":{"build":"build","test":"test"}}\n');
  writeFileSync(path.join(repo, "project", "package-lock.json"), '{"version":"1.0.0","lockfileVersion":3,"packages":{"":{"version":"1.0.0"}}}\n');
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

function prepareWithFakeNpm(
  f: Fixture, failAfterFix: boolean, project = "project", auditClean = false, updatesFile?: string, unresolved = false,
) {
  const bin = path.join(f.temp, "bin");
  setupMockNpm(bin);
  const patch = path.join(f.temp, "generated.patch");
  const args = [script, "prepare", project, patch];
  if (updatesFile) args.push(updatesFile);
  const result = spawnSync(process.execPath, args, {
    cwd: f.repo,
    encoding: "utf8",
    env: {
      ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      FAIL_AFTER_FIX: failAfterFix ? "1" : "0", AUDIT_CLEAN: auditClean ? "1" : "0",
      MOCK_FIX_UNRESOLVED: unresolved ? "1" : "0",
    },
  });
  return { result, patch };
}

test("Issue候補を検証し、既存Issueと同一実行内の重複を作らない", async () => {
  const f = fixture();
  try {
    const candidate: IssueCandidate = {
      kind: "vulnerability", project: "project", package: "example",
      identifier: "GHSA-abcd-efgh-ijkl", summary: "修正版は未確認",
    };
    const file = path.join(f.temp, "issues.json");
    writeCandidates(file, [candidate, candidate]);
    const requests: string[] = [];
    const fakeFetch: typeof fetch = async (_url, init) => {
      requests.push(init?.method ?? "GET");
      if (init?.method === "POST") return Response.json({ number: 1 }, { status: 201 });
      return Response.json([]);
    };
    await publishIssues(readCandidates(file), "https://api.github.com", "owner/repo", "token", fakeFetch);
    assert.deepEqual(requests, ["GET", "POST"]);
    const existingFetch: typeof fetch = async (_url, init) => {
      assert.notEqual(init?.method, "POST");
      return Response.json([{ body: issueMarker(candidate) }]);
    };
    await publishIssues([candidate], "https://api.github.com", "owner/repo", "token", existingFetch);
  } finally {
    f.cleanup();
  }
});

test("outdatedのpeer依存を更新・検証し、禁止設定では差分適用を拒否する", () => {
  const f = fixture();
  try {
    const manifest = path.join(f.repo, "project", "package.json");
    const lock = path.join(f.repo, "project", "package-lock.json");
    const originalManifest = '{"name":"example","version":"1.0.0","scripts":{"build":"build","test":"test"},"peerDependencies":{"library":"^1.2.3"}}\n';
    const originalLock = '{"version":"1.0.0","lockfileVersion":3,"packages":{"":{"version":"1.0.0","peerDependencies":{"library":"^1.2.3"}},"node_modules/library":{"version":"1.2.3"}}}\n';
    writeFileSync(manifest, originalManifest);
    writeFileSync(lock, originalLock);
    f.git("add", "project");
    f.git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "dependencies");
    const updates = path.join(f.temp, "updates.json");
    writeFileSync(updates, JSON.stringify([{ package: "library", current: "1.2.3", target: "1.3.0" }]));
    const { result, patch } = prepareWithFakeNpm(f, false, "project", true, updates);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(readFileSync(manifest, "utf8")).peerDependencies.library, "^1.3.0");
    assert.equal(JSON.parse(readFileSync(lock, "utf8")).packages["node_modules/library"].version, "1.3.0");
    writeFileSync(manifest, originalManifest);
    writeFileSync(lock, originalLock);
    const rejected = spawnSync(process.execPath, [script, "apply", "project", patch], {
      cwd: f.repo, encoding: "utf8", env: { ...process.env, AUTO_MINOR: "false", AUTO_PATCH: "true" },
    });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /許可されていない変更/);
    writeFileSync(manifest, originalManifest);
    writeFileSync(lock, originalLock);
    const accepted = spawnSync(process.execPath, [script, "apply", "project", patch], {
      cwd: f.repo, encoding: "utf8", env: { ...process.env, AUTO_MINOR: "true", AUTO_PATCH: "true" },
    });
    assert.equal(accepted.status, 0, accepted.stderr);
  } finally {
    f.cleanup();
  }
});

test("監査修正が未解決でもoutdated更新と合わせて再監査を通過すれば候補を作る", () => {
  const f = fixture();
  try {
    const manifest = path.join(f.repo, "project", "package.json");
    const lock = path.join(f.repo, "project", "package-lock.json");
    writeFileSync(manifest, '{"name":"example","version":"1.0.0","scripts":{"build":"build","test":"test"},"dependencies":{"library":"1.2.3"}}\n');
    writeFileSync(lock, '{"version":"1.0.0","lockfileVersion":3,"packages":{"":{"version":"1.0.0","dependencies":{"library":"1.2.3"}},"node_modules/library":{"version":"1.2.3"}}}\n');
    f.git("add", "project");
    f.git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "dependencies");
    const updates = path.join(f.temp, "updates.json");
    writeFileSync(updates, JSON.stringify([{ package: "library", current: "1.2.3", target: "1.3.0" }]));
    const { result, patch } = prepareWithFakeNpm(f, false, "project", false, updates, true);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(readFileSync(manifest, "utf8")).dependencies.library, "1.3.0");
    assert.match(readFileSync(patch, "utf8"), /project\/package-lock\.json/);
  } finally {
    f.cleanup();
  }
});

test("Issue候補が不正またはGitHub APIが失敗した場合は停止する", async () => {
  const f = fixture();
  try {
    const file = path.join(f.temp, "issues.json");
    writeFileSync(file, '[{"kind":"vulnerability","project":"../private","package":"x","identifier":"1","summary":"x"}]');
    assert.throws(() => readCandidates(file), /形式が不正/);
    const failure: typeof fetch = async () => new Response(null, { status: 403 });
    await assert.rejects(
      () => publishIssues([], "https://api.github.com", "owner/repo", "token", failure),
      /HTTP 403/,
    );
  } finally {
    f.cleanup();
  }
});

test("安全なパッチ版がないadvisoryだけをIssue候補にする", () => {
  const report = {
    vulnerabilities: {
      example: {
        via: [{ source: 123, title: "CVE-2026-1234", range: "<1.2.5" }],
        nodes: ["node_modules/example"],
      },
    },
  };
  const lock = { packages: { "node_modules/example": { version: "1.2.3" } } };
  const missing = findAuditIssues("project", report, lock, () => ["1.2.4", "1.3.0"]);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].identifier, "CVE-2026-1234");
  assert.match(missing[0].summary, /1\.2\.3/);
  assert.deepEqual(findAuditIssues("project", report, lock, () => ["1.2.5", "2.0.0"]), []);
});

test("インストール済みバージョンを特定できない場合は未確認のIssue候補にする", () => {
  const report = {
    vulnerabilities: {
      example: {
        via: [{ source: 123, url: "https://github.com/advisories/GHSA-abcd-efgh-ijkl", range: "<2.0.0" }],
        nodes: ["node_modules/example"],
      },
    },
  };
  const result = findAuditIssues("project", report, { packages: {} }, () => {
    throw new Error("バージョン一覧の取得は不要");
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].identifier, "GHSA-ABCD-EFGH-IJKL");
  assert.match(result[0].summary, /未確認/);
});

test("最新がメジャー更新でも許可された同一メジャー内の更新を選ぶ", () => {
  const manifest = { dependencies: { example: "^1.2.3" } };
  const outdated = { example: { current: "1.2.3", latest: "2.0.0" } };
  const versions = () => ["1.2.4", "1.3.2", "2.0.0"];
  const both = planOutdated("project", manifest, outdated, versions, { minor: true, patch: true });
  assert.deepEqual(both.updates, [{ package: "example", current: "1.2.3", target: "1.3.2" }]);
  assert.equal(both.issues[0].identifier, "major-2");
  const patchOnly = planOutdated("project", manifest, outdated, versions, { minor: false, patch: true });
  assert.deepEqual(patchOnly.updates, [{ package: "example", current: "1.2.3", target: "1.2.4" }]);
  assert.ok(patchOnly.issues.some((item) => item.identifier === "minor-1.3"));
});

test("wantedがlatestタグより新しい場合も範囲内の更新を選ぶ", () => {
  const manifest = { dependencies: { example: "^1.2.3" } };
  const outdated = { example: { current: "1.2.3", wanted: "1.2.5", latest: "1.2.4" } };
  const result = planOutdated("project", manifest, outdated, () => ["1.2.4", "1.2.5"], { minor: true, patch: true });
  assert.deepEqual(result.updates, [{ package: "example", current: "1.2.3", target: "1.2.5" }]);
});

test("更新禁止のバージョンとサポート外の依存指定はIssue候補にする", () => {
  const outdated = { example: { current: "1.2.3", latest: "1.3.0" } };
  const versions = () => ["1.2.4", "1.3.0"];
  const disabled = planOutdated("project", { peerDependencies: { example: "~1.2.3" } },
    outdated, versions, { minor: false, patch: false });
  assert.deepEqual(disabled.updates, []);
  assert.deepEqual(disabled.issues.map((item) => item.identifier), ["minor-1.3", "patch-1.2"]);
  const peer = planOutdated("project", { peerDependencies: { example: "~1.2.3" } },
    outdated, versions, { minor: true, patch: true });
  assert.equal(peer.updates[0].target, "1.3.0");
  const unsupported = planOutdated("project", { dependencies: { example: ">=1 <3" } },
    outdated, versions, { minor: true, patch: true });
  assert.deepEqual(unsupported.updates, []);
  assert.equal(unsupported.issues[0].identifier, "unsupported-spec");
});

test("差分検証では許可範囲の更新だけを受け入れ、メジャー更新とパッチ禁止を拒否する", () => {
  const before = { version: "1.0.0", peerDependencies: { example: "^1.2.3" } };
  const originalLock = { packages: { "node_modules/example": { version: "1.2.3" } } };
  const after = (dependency: string) => ({ version: "1.0.1", peerDependencies: { example: dependency } });
  assert.doesNotThrow(() => assertManifestChanges(before, after("^1.3.0"), "1.0.1", originalLock, { minor: true, patch: false }));
  assert.throws(() => assertManifestChanges(before, after("^2.0.0"), "1.0.1", originalLock, { minor: true, patch: true }));
  assert.throws(() => assertManifestChanges(before, after("^1.2.4"), "1.0.1", originalLock, { minor: true, patch: false }));
  assert.throws(() => assertManifestChanges(before, after("~1.3.0"), "1.0.1", originalLock, { minor: true, patch: true }));
});

test("模擬レジストリの検査結果からIssueと更新候補を作る", () => {
  const f = fixture();
  try {
    const manifest = path.join(f.repo, "project", "package.json");
    const lock = path.join(f.repo, "project", "package-lock.json");
    writeFileSync(manifest, '{"name":"example","version":"1.0.0","scripts":{"build":"build","test":"test"},"dependencies":{"library":"1.2.3"}}\n');
    writeFileSync(lock, '{"version":"1.0.0","lockfileVersion":3,"packages":{"":{"version":"1.0.0","dependencies":{"library":"1.2.3"}},"node_modules/library":{"version":"1.2.3"}}}\n');
    f.git("add", "project");
    f.git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "dependencies");
    const bin = path.join(f.temp, "bin");
    setupMockNpm(bin);
    const issues = path.join(f.temp, "issues.json");
    const updates = path.join(f.temp, "updates.json");
    const scanner = fileURLToPath(new URL("./npm-inspect.ts", import.meta.url));
    const result = spawnSync(process.execPath, [scanner, "project", issues, updates], {
      cwd: f.repo, encoding: "utf8",
      env: {
        ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, AUDIT_CLEAN: "1",
        AUTO_MINOR: "false", AUTO_PATCH: "true",
        GITHUB_OUTPUT: path.join(f.temp, "outputs"),
        MOCK_OUTDATED_REPORT: JSON.stringify({ library: { current: "1.2.3", latest: "2.0.0" } }),
        MOCK_VERSIONS: JSON.stringify({ library: ["1.2.4", "1.3.0", "2.0.0"] }),
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(updates, "utf8")), [{ package: "library", current: "1.2.3", target: "1.2.4" }]);
    assert.deepEqual(readCandidates(issues).map((item) => item.identifier), ["major-2", "minor-1.3"]);
  } finally {
    f.cleanup();
  }
});

test("修正フローは検知・修正・検証後に候補を保存する", () => {
  const calls: string[] = [];
  const steps: RepairSteps<string> = {
    prepare: () => { calls.push("prepare"); return "candidate"; },
    detect: (context) => { calls.push(`detect:${context}`); return { status: "needs-repair" }; },
    repair: (context) => { calls.push(`repair:${context}`); },
    verify: (context) => { calls.push(`verify:${context}`); },
    save: (context) => { calls.push(`save:${context}`); },
  };
  assert.deepEqual(runRepair(steps), { status: "changed" });
  assert.deepEqual(calls, ["prepare", "detect:candidate", "repair:candidate", "verify:candidate", "save:candidate"]);
});

test("変更不要または未解決の場合は修正や保存を行わない", () => {
  const calls: string[] = [];
  const steps: RepairSteps<void> = {
    prepare: () => { calls.push("prepare"); },
    detect: () => ({ status: "clean" }),
    repair: () => { calls.push("repair"); },
    verify: () => { calls.push("verify"); },
    save: () => { calls.push("save"); },
  };
  assert.deepEqual(runRepair(steps), { status: "unchanged" });
  assert.deepEqual(calls, ["prepare"]);
  steps.detect = () => ({ status: "unresolved", reason: "確認が必要です" });
  assert.deepEqual(runRepair(steps), { status: "unresolved", reason: "確認が必要です" });
  assert.deepEqual(calls, ["prepare", "prepare"]);
});

test("修正や検証の失敗時は候補を保存しない", () => {
  const calls: string[] = [];
  const steps: RepairSteps<void> = {
    prepare: () => {},
    detect: () => ({ status: "needs-repair" }),
    repair: () => { calls.push("repair"); },
    verify: () => { calls.push("verify"); throw new Error("検証失敗"); },
    save: () => { calls.push("save"); },
  };
  assert.throws(() => runRepair(steps), /検証失敗/);
  assert.deepEqual(calls, ["repair", "verify"]);
  calls.length = 0;
  steps.repair = () => { calls.push("repair"); throw new Error("修正失敗"); };
  assert.throws(() => runRepair(steps), /修正失敗/);
  assert.deepEqual(calls, ["repair"]);
});

test("npm監査の異常なJSONや終了コードを拒否する", () => {
  const report = (total: number) => JSON.stringify({ metadata: { vulnerabilities: { total } } });
  assert.equal(parseAuditResult("project", { stdout: report(0), status: 0 }), 0);
  assert.equal(parseAuditResult("project", { stdout: report(2), status: 1 }), 2);
  for (const result of [
    { stdout: "invalid", status: 1 },
    { stdout: "{}", status: 0 },
    { stdout: report(-1), status: 1 },
    { stdout: report(0), status: 1 },
    { stdout: report(1), status: 0 },
    { stdout: report(1), status: 2 },
  ]) {
    assert.throws(() => parseAuditResult("project", result));
  }
});

test("正常なパッチバージョンとlockfile差分を適用する", () => {
  const f = fixture();
  try {
    const manifest = path.join(f.repo, "project", "package.json");
    const lock = path.join(f.repo, "project", "package-lock.json");
    const originalManifest = readFileSync(manifest, "utf8");
    const originalLock = readFileSync(lock, "utf8");
    const { result: prepared, patch } = prepareWithFakeNpm(f, false);
    assert.equal(prepared.status, 0, prepared.stderr);
    writeFileSync(manifest, originalManifest);
    writeFileSync(lock, originalLock);
    for (const file of ["audit-fix.ts", "git-repository.ts", "json.ts", "npm-policy.ts", "npm-project.ts", "npm-apply.ts"]) {
      copyFileSync(path.join(path.dirname(script), file), path.join(f.temp, file));
    }
    const isolatedScript = path.join(f.temp, "audit-fix.ts");
    const result = spawnSync(process.execPath, [isolatedScript, "apply", "project", patch], {
      cwd: f.repo,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(readFileSync(manifest, "utf8")).version, "1.0.1");
    assert.equal(JSON.parse(readFileSync(lock, "utf8")).packages[""].version, "1.0.1");
  } finally {
    f.cleanup();
  }
});

test("未承認の依存関係変更を拒否する", () => {
  const f = fixture();
  try {
    const manifest = path.join(f.repo, "project", "package.json");
    const lock = path.join(f.repo, "project", "package-lock.json");
    const originalManifest = readFileSync(manifest);
    const originalLock = readFileSync(lock);
    writeFileSync(manifest, '{"name":"example","version":"1.0.1","scripts":{"build":"build","test":"test"},"dependencies":{"unexpected":"1.0.0"}}\n');
    writeFileSync(lock, '{"version":"1.0.1","lockfileVersion":3,"packages":{"":{"version":"1.0.1"}}}\n');
    const patch = path.join(f.temp, "candidate.patch");
    writeFileSync(patch, f.git("diff", "--", "project/package.json", "project/package-lock.json"));
    writeFileSync(manifest, originalManifest);
    writeFileSync(lock, originalLock);
    const result = apply(f, "project", patch);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /許可されていない変更.*dependencies/);
  } finally {
    f.cleanup();
  }
});

test("両ファイルの差分に含まれる不正なlockfileを拒否する", () => {
  const f = fixture();
  try {
    const manifest = path.join(f.repo, "project", "package.json");
    const lock = path.join(f.repo, "project", "package-lock.json");
    const originalManifest = readFileSync(manifest);
    const originalLock = readFileSync(lock);
    writeFileSync(manifest, '{"name":"example","version":"1.0.1","scripts":{"build":"build","test":"test"}}\n');
    writeFileSync(lock, "invalid json\n");
    const patch = path.join(f.temp, "candidate.patch");
    writeFileSync(patch, f.git("diff", "--", "project/package.json", "project/package-lock.json"));
    writeFileSync(manifest, originalManifest);
    writeFileSync(lock, originalLock);
    const result = apply(f, "project", patch);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /エラー:/);
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
    assert.match(result.stderr, /許可対象外の差分/);
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
    assert.match(readFileSync(patch, "utf8"), /project\/package\.json/);
    assert.match(result.stdout, /修正候補を作成/);
  } finally {
    f.cleanup();
  }
});

test("変更が不要ならバージョンを上げず差分も作らない", () => {
  const f = fixture();
  try {
    const manifest = path.join(f.repo, "project", "package.json");
    const original = readFileSync(manifest, "utf8");
    const { result, patch } = prepareWithFakeNpm(f, false, "project", true);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(manifest, "utf8"), original);
    assert.equal(f.git("status", "--porcelain"), "");
    assert.throws(() => readFileSync(patch), { code: "ENOENT" });
  } finally {
    f.cleanup();
  }
});

test("manifestとlockfileのバージョンが不一致なら停止する", () => {
  const f = fixture();
  try {
    writeFileSync(path.join(f.repo, "project", "package-lock.json"), '{"version":"1.0.2","lockfileVersion":3,"packages":{"":{"version":"1.0.2"}}}\n');
    f.git("add", "project/package-lock.json");
    f.git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "inconsistent");
    const { result } = prepareWithFakeNpm(f, false);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /バージョンが一致しません/);
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
    const manifest = path.join(target, "package.json");
    const original = readFileSync(lock, "utf8");
    const originalManifest = readFileSync(manifest, "utf8");
    const { result, patch } = prepareWithFakeNpm(f, false, project);
    assert.equal(result.status, 0, result.stderr);
    const updated = readFileSync(lock, "utf8");
    assert.notEqual(updated, original);
    assert.equal(JSON.parse(updated).version, "1.0.1");
    writeFileSync(lock, original);
    writeFileSync(manifest, originalManifest);
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
      '{"name":"example","version":"1.0.0","workspaces":["packages/*"],"scripts":{"build":"build","test":"test"}}\n');
    f.git("add", "project/package.json");
    f.git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "workspaces");
    const scanner = fileURLToPath(new URL("./npm-inspect.ts", import.meta.url));
    const bin = path.join(f.temp, "bin");
    setupMockNpm(bin);
    const inspected = spawnSync(process.execPath, [
      scanner, "project", path.join(f.temp, "issues.json"), path.join(f.temp, "updates.json"),
    ], { cwd: f.repo, encoding: "utf8", env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` } });
    assert.notEqual(inspected.status, 0);
    assert.match(inspected.stderr, /workspacesの統合検証は未対応/);
    const { result } = prepareWithFakeNpm(f, false);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /workspacesの統合検証は未対応/);
  } finally {
    f.cleanup();
  }
});
