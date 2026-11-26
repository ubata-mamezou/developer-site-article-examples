import * as semver from "semver";
import { isObject, type JsonObject } from "./json.ts";
import type { IssueCandidate } from "./issue-candidates.ts";

type Advisory = { identifier: string; range: string };

function advisories(via: unknown): Advisory[] {
  if (!Array.isArray(via)) throw new Error("npm監査のadvisory一覧が不正です。");
  return via.filter(isObject).map((item) => {
    if (typeof item.range !== "string" || !semver.validRange(item.range)) {
      throw new Error("npm監査の脆弱性範囲が不正です。");
    }
    const text = `${typeof item.title === "string" ? item.title : ""} ${typeof item.url === "string" ? item.url : ""}`;
    const identifier = text.match(/CVE-\d{4}-\d{4,}/i)?.[0]
      ?? text.match(/GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i)?.[0]
      ?? (typeof item.source === "number" && Number.isSafeInteger(item.source) && item.source > 0
        ? `NPM-${item.source}` : undefined);
    if (!identifier) throw new Error("npm監査のadvisory識別子を確認できません。");
    return { identifier: identifier.toUpperCase(), range: item.range };
  });
}

function installedVersions(nodes: unknown, packages: unknown): string[] | undefined {
  if (!Array.isArray(nodes) || nodes.length === 0 || !isObject(packages)) return undefined;
  const result: string[] = [];
  for (const node of nodes) {
    if (typeof node !== "string") return undefined;
    const item = packages[node];
    if (!isObject(item) || typeof item.version !== "string"
      || semver.valid(item.version) !== item.version || semver.prerelease(item.version)) return undefined;
    result.push(item.version);
  }
  return [...new Set(result)];
}

export function findAuditIssues(
  project: string, report: JsonObject, lock: JsonObject, versions: (packageName: string) => string[],
): IssueCandidate[] {
  const vulnerabilities = report.vulnerabilities;
  if (!isObject(vulnerabilities)) throw new Error("npm監査の脆弱性一覧が不正です。");
  const candidates: IssueCandidate[] = [];
  let hasDirectAdvisory = false;
  for (const [packageName, vulnerability] of Object.entries(vulnerabilities)) {
    if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(packageName) || !isObject(vulnerability)) {
      throw new Error("npm監査のパッケージ情報が不正です。");
    }
    const direct = advisories(vulnerability.via);
    if (direct.length === 0) continue;
    hasDirectAdvisory = true;
    const installed = installedVersions(vulnerability.nodes, lock.packages);
    let summary: string | undefined;
    if (!installed) {
      summary = "対象のインストール済みバージョンを特定できないため、修正版の有無は未確認です。";
    } else {
      const available = versions(packageName).filter((version) => semver.valid(version) === version && !semver.prerelease(version));
      const missing = installed.filter((current) => !available.some((version) =>
        semver.gt(version, current)
        && semver.major(version) === semver.major(current)
        && semver.minor(version) === semver.minor(current)
        && direct.every((advisory) => !semver.satisfies(version, advisory.range))));
      if (missing.length) {
        summary = `対象バージョン ${missing.join(", ")} の既知のadvisory範囲外となるパッチ版は一覧に見つかりません。確認が必要です。`;
      }
      if (!hasDirectAdvisory) throw new Error("npm監査のadvisory詳細を確認できません。");
    }
    if (!summary) continue;
    for (const advisory of direct) {
      candidates.push({ kind: "vulnerability", project, package: packageName, identifier: advisory.identifier, summary });
    }
  }
  // TODO: ライブラリのリポジトリにある関連Issueを調査する。
  return candidates;
}
