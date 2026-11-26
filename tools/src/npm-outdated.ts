import * as semver from "semver";
import { readFileSync, writeFileSync } from "node:fs";
import { isObject, type JsonObject } from "./json.ts";
import type { IssueCandidate } from "./issue-candidates.ts";
import { dependencySections, simpleVersionSpec, type OutdatedUpdate, type UpdatePolicy } from "./npm-policy.ts";

export type OutdatedPlan = { updates: OutdatedUpdate[]; issues: IssueCandidate[] };

export function readUpdates(file: string): OutdatedUpdate[] {
  const contents = readFileSync(file, "utf8");
  if (Buffer.byteLength(contents) > 1024 * 1024) throw new Error("更新候補がサイズ上限を超えています。");
  const value: unknown = JSON.parse(contents);
  if (!Array.isArray(value) || value.length > 200) throw new Error("更新候補の形式が不正です。");
  const names = new Set<string>();
  for (const item of value) {
    if (!isObject(item) || typeof item.package !== "string"
      || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(item.package)
      || typeof item.current !== "string" || typeof item.target !== "string"
      || !simpleVersionSpec(item.current) || !simpleVersionSpec(item.target)
      || names.has(item.package)) {
      throw new Error("更新候補の形式が不正です。");
    }
    names.add(item.package);
  }
  return value;
}

export function writeUpdates(file: string, updates: OutdatedUpdate[]): void {
  writeFileSync(file, `${JSON.stringify(updates, null, 2)}\n`);
}

function issue(project: string, packageName: string, identifier: string, summary: string): IssueCandidate {
  return { kind: "outdated", project, package: packageName, identifier, summary };
}

export function planOutdated(
  project: string, manifest: JsonObject, outdated: JsonObject,
  versions: (packageName: string) => string[], policy: UpdatePolicy,
): OutdatedPlan {
  const updates: OutdatedUpdate[] = [];
  const issues: IssueCandidate[] = [];
  for (const [packageName, item] of Object.entries(outdated)) {
    if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(packageName) || !isObject(item)) {
      throw new Error("npm outdatedのパッケージ情報が不正です。");
    }
    const current = item.current;
    const latest = item.latest;
    const wanted = item.wanted;
    if (typeof current !== "string" || semver.valid(current) !== current || semver.prerelease(current)
      || typeof latest !== "string" || semver.valid(latest) !== latest || semver.prerelease(latest)
      || (wanted !== undefined && (typeof wanted !== "string" || semver.valid(wanted) !== wanted || semver.prerelease(wanted)))) {
      issues.push(issue(project, packageName, "unsupported-version", "現在または最新バージョンを判定できません。手動で確認してください。"));
      continue;
    }
    const ceiling = typeof wanted === "string" && semver.gt(wanted, latest) ? wanted : latest;
    if (semver.gt(latest, current) && semver.major(latest) > semver.major(current)) {
      issues.push(issue(project, packageName, `major-${semver.major(latest)}`,
        `メジャー更新 ${current} → ${latest} は自動更新しません。`));
    }
    const specs = dependencySections.flatMap((section) => {
      const dependencies = manifest[section];
      if (dependencies === undefined) return [];
      if (!isObject(dependencies)) throw new Error(`${section}: 依存関係が不正です。`);
      return Object.hasOwn(dependencies, packageName) ? [dependencies[packageName]] : [];
    });
    if (specs.length === 0 || specs.some((spec) => !simpleVersionSpec(spec))) {
      issues.push(issue(project, packageName, "unsupported-spec", "依存バージョンの指定形式は自動更新対象外です。手動で確認してください。"));
      continue;
    }
    const available = versions(packageName)
      .filter((version) => semver.valid(version) === version && !semver.prerelease(version)
        && semver.gt(version, current) && semver.major(version) === semver.major(current)
        && (semver.major(latest) > semver.major(current) || semver.lte(version, ceiling)))
      .sort(semver.rcompare);
    const minor = available.find((version) => semver.minor(version) > semver.minor(current));
    const patch = available.find((version) => semver.minor(version) === semver.minor(current));
    if (minor && !policy.minor) {
      issues.push(issue(project, packageName, `minor-${semver.major(minor)}.${semver.minor(minor)}`,
        `マイナー更新 ${current} → ${minor} は設定により自動更新しません。`));
    }
    if (patch && !policy.patch) {
      issues.push(issue(project, packageName, `patch-${semver.major(patch)}.${semver.minor(patch)}`,
        `パッチ更新 ${current} → ${patch} は設定により自動更新しません。`));
    }
    const target = policy.minor && minor ? minor : policy.patch ? patch : undefined;
    if (target) updates.push({ package: packageName, current, target });
  }
  return { updates, issues };
}
