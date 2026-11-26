import { appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertChanges } from "./git-repository.ts";
import { writeCandidates } from "./issue-candidates.ts";
import { findAuditIssues } from "./npm-audit-issues.ts";
import { createNpmCommands } from "./npm-commands.ts";
import { planOutdated, writeUpdates } from "./npm-outdated.ts";
import { policyFromEnvironment } from "./npm-policy.ts";
import { readTrackedJson, validateProject } from "./npm-project.ts";

function inspect(project: string, issueFile: string, updatesFile: string): void {
  const { manifest, lock } = validateProject(project);
  const npm = createNpmCommands(project);
  npm.install();
  assertChanges([]);
  const audit = npm.auditReport();
  const cache = new Map<string, string[]>();
  const versions = (name: string): string[] => {
    const cached = cache.get(name);
    if (cached) return cached;
    const result = npm.versions(name);
    cache.set(name, result);
    return result;
  };
  const candidates = audit.total === 0 ? [] : findAuditIssues(project, audit.report, readTrackedJson(lock), versions);
  const outdated = planOutdated(project, readTrackedJson(manifest), npm.outdated(), versions, policyFromEnvironment());
  candidates.push(...outdated.issues);
  writeCandidates(issueFile, candidates);
  writeUpdates(updatesFile, outdated.updates);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `issues=${candidates.length > 0}\n`);
  console.log(`Issue候補: ${candidates.length}件`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const [project, issueFile, updatesFile] = process.argv.slice(2);
    if (!project || !issueFile || !updatesFile) throw new Error("プロジェクトと候補ファイルを指定してください。");
    inspect(project, issueFile, updatesFile);
  } catch (error) {
    console.error(`エラー: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
