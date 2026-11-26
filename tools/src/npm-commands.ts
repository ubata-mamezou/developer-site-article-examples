import { spawnSync } from "node:child_process";
import path from "node:path";
import { root } from "./git-repository.ts";
import { isObject, type JsonObject } from "./json.ts";

type CommandResult = {
  stdout: string;
  status: number | null;
};

type CommandRunner = (project: string, args: string[]) => CommandResult;

function runCommand(project: string, args: string[]): CommandResult {
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
  return { stdout: result.stdout, status: result.status };
}

export function parseAuditReport(project: string, result: CommandResult): { total: number; report: JsonObject } {
  let report: unknown;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(`${project}: npm auditのJSONを解析できません。`);
  }
  const metadata = isObject(report) ? report.metadata : undefined;
  const counts = isObject(metadata) ? metadata.vulnerabilities : undefined;
  const total = isObject(counts) ? counts.total : undefined;
  if (!isObject(report) || report.error || typeof total !== "number" || !Number.isInteger(total) || total < 0
    || (result.status !== 0 && result.status !== 1)) {
    throw new Error(`${project}: npm auditが失敗しました。`);
  }
  if ((total === 0) !== (result.status === 0)) throw new Error(`${project}: npm auditの結果が不整合です。`);
  return { total, report };
}

export function parseAuditResult(project: string, result: CommandResult): number {
  return parseAuditReport(project, result).total;
}

export function assertTestsRan(output: string, project: string): void {
  const match = output.match(/^(?:ℹ\s*|#\s*)pass\s+(\d+)\s*$/m);
  if (!match || Number(match[1]) === 0) {
    throw new Error(`${project}: 成功したテスト数を確認できません。未検証として停止します。`);
  }
}

export type NpmCommands = {
  install: () => void;
  build: () => void;
  test: () => void;
  audit: () => number;
  auditReport: () => { total: number; report: JsonObject };
  outdated: () => JsonObject;
  versions: (packageName: string) => string[];
  fix: () => number;
  incrementPatch: () => void;
  updateLock: () => void;
};

export function createNpmCommands(project: string, runner: CommandRunner = runCommand): NpmCommands {
  function execute(args: string[]): string {
    const result = runner(project, args);
    if (result.status !== 0) throw new Error(`${project}: npm ${args.join(" ")} が失敗しました (exit ${result.status})。`);
    return result.stdout;
  }

  return {
    install: () => { execute(["ci"]); },
    build: () => { execute(["run", "build"]); },
    test: () => { assertTestsRan(execute(["test"]), project); },
    audit: () => parseAuditResult(project, runner(project, ["audit", "--json"])),
    auditReport: () => parseAuditReport(project, runner(project, ["audit", "--json"])),
    outdated: () => {
      const result = runner(project, ["outdated", "--json"]);
      if (result.status !== 0 && result.status !== 1) throw new Error(`${project}: npm outdatedが失敗しました。`);
      let output: unknown;
      try {
        output = JSON.parse(result.stdout);
      } catch {
        throw new Error(`${project}: npm outdatedのJSONを解析できません。`);
      }
      if (!isObject(output) || output.error || (Object.keys(output).length === 0) !== (result.status === 0)) {
        throw new Error(`${project}: npm outdatedの結果が不正です。`);
      }
      return output;
    },
    versions: (packageName) => {
      const output = execute(["view", packageName, "versions", "--json"]);
      const versions: unknown = JSON.parse(output);
      if (typeof versions === "string") return [versions];
      if (!Array.isArray(versions) || !versions.every((value) => typeof value === "string")) {
        throw new Error(`${project}: ${packageName}のバージョン一覧が不正です。`);
      }
      return versions;
    },
    fix: () => {
      const result = runner(project, ["audit", "fix", "--json"]);
      let output: unknown;
      try {
        output = JSON.parse(result.stdout);
      } catch {
        throw new Error(`${project}: npm audit fixのJSONを解析できません。`);
      }
      if (!isObject(output) || !isObject(output.audit)) throw new Error(`${project}: npm audit fixの結果が不正です。`);
      return parseAuditResult(project, { stdout: JSON.stringify(output.audit), status: result.status });
    },
    incrementPatch: () => { execute(["version", "patch", "--no-git-tag-version", "--ignore-scripts"]); },
    updateLock: () => { execute(["install", "--package-lock-only", "--ignore-scripts"]); },
  };
}
