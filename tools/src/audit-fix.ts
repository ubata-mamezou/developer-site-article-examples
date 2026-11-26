import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = process.cwd();

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readObject(file: string): JsonObject {
  const value: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!isObject(value)) throw new Error(`${file}: JSONオブジェクトが必要です。`);
  return value;
}

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

export function projectFiles(project: string): { manifest: string; lock: string } {
  if (!project || project.split("/").some((part) => !part || part === "." || part === ".." || !/^[\w.-]+$/.test(part))) {
    throw new Error("プロジェクトにはリポジトリ内の相対パスを指定してください。");
  }
  const manifest = `${project}/package.json`;
  const lock = `${project}/package-lock.json`;
  const tracked = new Set(git("ls-files", "-z", "--", manifest, lock).split("\0").filter(Boolean));
  if (!tracked.has(manifest) || !tracked.has(lock)) {
    throw new Error(`${project}: Git管理対象のpackage.jsonとpackage-lock.jsonが必要です。`);
  }
  let current = root;
  for (const component of project.split("/")) {
    current = path.join(current, component);
    if (lstatSync(current).isSymbolicLink()) throw new Error("シンボリックリンクを含むパスは使用できません。");
  }
  for (const file of [manifest, lock]) {
    if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) throw new Error(`${file}: 通常ファイルが必要です。`);
    if (!realpathSync(file).startsWith(`${realpathSync(root)}${path.sep}`)) throw new Error(`${file}: リポジトリ外の参照は禁止です。`);
  }
  return { manifest, lock };
}

function runNpm(project: string, args: string[], json: true): number;
function runNpm(project: string, args: string[], json?: false): void;
function runNpm(project: string, args: string[], json = false): number | void {
  const executable = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(executable, args, {
    cwd: path.join(root, project),
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    shell: process.platform === "win32",
    env: { ...process.env, npm_config_force: "false", npm_config_audit_level: "info" },
  });
  if (result.error) throw result.error;
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (json) {
    let report: unknown;
    try {
      report = JSON.parse(result.stdout);
    } catch {
      throw new Error(`${project}: npm auditのJSONを解析できません。`);
    }
    const metadata = isObject(report) ? report.metadata : undefined;
    const counts = isObject(metadata) ? metadata.vulnerabilities : undefined;
    const total = isObject(counts) ? counts.total : undefined;
    if (!isObject(report) || report.error || typeof total !== "number" || !Number.isInteger(total)
      || (result.status !== 0 && result.status !== 1)) {
      throw new Error(`${project}: npm auditが失敗しました。`);
    }
    if ((total === 0) !== (result.status === 0)) throw new Error(`${project}: npm auditの結果が不整合です。`);
    return total;
  }
  if (result.status !== 0) throw new Error(`${project}: npm ${args.join(" ")} が失敗しました (exit ${result.status})。`);
  if (args[0] === "test") assertTestsRan(result.stdout, project);
}

export function assertTestsRan(output: string, project: string): void {
  const match = output.match(/^(?:ℹ\s*|#\s*)pass\s+(\d+)\s*$/m);
  if (!match || Number(match[1]) === 0) {
    throw new Error(`${project}: 成功したテスト数を確認できません。未検証として停止します。`);
  }
}

function assertChanges(lock: string, allowLock: boolean): boolean {
  const status = git("status", "--porcelain=v1", "-z", "--untracked-files=all").split("\0").filter(Boolean);
  for (const entry of status) {
    if (!allowLock || entry !== ` M ${lock}`) throw new Error(`想定外の変更を検出しました: ${entry}`);
  }
  return status.length > 0;
}

function assertRegularLock(lock: string): void {
  const entry = git("ls-files", "--stage", "--", lock);
  if (!entry.startsWith("100644 ") || !lstatSync(lock).isFile() || lstatSync(lock).isSymbolicLink()) {
    throw new Error(`${lock}: 通常のlockfileではありません。`);
  }
  JSON.parse(readFileSync(lock, "utf8"));
}

export function prepare(project: string, patchFile: string): boolean {
  const { manifest, lock } = projectFiles(project);
  assertChanges(lock, false);
  const pkg = readObject(manifest);
  if (!isObject(pkg.scripts) || !pkg.scripts.build || !pkg.scripts.test) {
    throw new Error(`${project}: buildとtestの両方が必要です。`);
  }
  const manifests = git("ls-files", "-z", "--", "**/package.json", "package.json").split("\0").filter(Boolean);
  for (const otherManifest of manifests) {
    const other = readObject(otherManifest);
    const otherDir = path.posix.dirname(otherManifest);
    if (other.workspaces && (otherDir === "." || project === otherDir || project.startsWith(`${otherDir}/`))) {
      throw new Error(`${project}: workspacesの統合検証は未対応です。`);
    }
    for (const value of [other.dependencies, other.devDependencies, other.optionalDependencies, other.peerDependencies]) {
      if (value !== undefined && !isObject(value)) throw new Error(`${otherManifest}: 依存関係が不正です。`);
      const dependencies = value ?? {};
      if (otherManifest !== manifest && typeof pkg.name === "string" && pkg.name && Object.hasOwn(dependencies, pkg.name)) {
        throw new Error(`${project}: ${otherManifest}が依存しているため単独では検証できません。`);
      }
      if (otherManifest !== manifest && Object.values(dependencies).some((value) => {
        if (typeof value !== "string" || !/^(file|link):/.test(value)) return false;
        const target = path.resolve(root, otherDir, value.replace(/^(file|link):/, ""));
        const projectDir = path.resolve(root, project);
        return target === projectDir || target.startsWith(`${projectDir}${path.sep}`);
      })) {
        throw new Error(`${project}: ${otherManifest}がローカル参照しているため単独では検証できません。`);
      }
      if (otherManifest === manifest && Object.values(dependencies).some((value) =>
        typeof value === "string" && /^(file|link|workspace):/.test(value))) {
        throw new Error(`${project}: ローカル依存の統合検証は未対応です。`);
      }
    }
  }
  runNpm(project, ["ci"]);
  runNpm(project, ["run", "build"]);
  runNpm(project, ["test"]);
  assertChanges(lock, false);
  const before = runNpm(project, ["audit", "--json"], true);
  if (before === 0) return false;
  runNpm(project, ["audit", "fix"]);
  assertChanges(lock, true);
  runNpm(project, ["ci"]);
  runNpm(project, ["run", "build"]);
  runNpm(project, ["test"]);
  if (runNpm(project, ["audit", "--json"], true) !== 0) throw new Error(`${project}: 脆弱性が残っています。`);
  if (!assertChanges(lock, true)) throw new Error(`${project}: 修正前に脆弱性がありましたが、lockfileに変更がありません。`);
  assertRegularLock(lock);
  writeFileSync(patchFile, git("diff", "--no-ext-diff", "--binary", "--", lock));
  return true;
}

export function applyCandidate(project: string, patchFile: string): void {
  const { lock } = projectFiles(project);
  assertChanges(lock, false);
  assertRegularLock(lock);
  const patch = readFileSync(patchFile);
  if (patch.length === 0 || patch.length > 5 * 1024 * 1024) throw new Error("差分のサイズが不正です。");
  const records = git("apply", "--numstat", "-z", "--", patchFile).split("\0").filter(Boolean);
  if (records.length !== 1 || !/^\d+\t\d+\t/.test(records[0]) || records[0].split("\t")[2] !== lock) {
    throw new Error("対象lockfile以外の差分、バイナリ、名前変更は許可されません。");
  }
  git("apply", "--check", "--", patchFile);
  git("apply", "--", patchFile);
  if (!assertChanges(lock, true)) throw new Error("差分が適用されませんでした。");
  assertRegularLock(lock);
  const raw = git("diff", "--raw", "--no-abbrev", "--", lock);
  if (!/^:100644 100644 [0-9a-f]+ [0-9a-f]+ M\t/.test(raw)) throw new Error("lockfileのモード変更は禁止です。");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const [mode, project, patchFile] = process.argv.slice(2);
    if (!project || !patchFile) throw new Error("モード、プロジェクト、差分ファイルを指定してください。");
    if (mode === "prepare") {
      const changed = prepare(project, patchFile);
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
      console.log(changed ? "修正候補を作成しました。" : "脆弱性は検出されませんでした。");
    } else if (mode === "apply") {
      applyCandidate(project, patchFile);
      console.log("候補の差分を確認しました。");
    } else {
      throw new Error("不明なモードです。");
    }
  } catch (error) {
    console.error(`エラー: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
