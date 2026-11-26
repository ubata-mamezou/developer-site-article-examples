import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { isObject } from "./json.ts";

export type IssueCandidate = {
  kind: "vulnerability" | "outdated";
  project: string;
  package: string;
  identifier: string;
  summary: string;
};

function isCandidate(value: unknown): value is IssueCandidate {
  if (!isObject(value)) return false;
  return (value.kind === "vulnerability" || value.kind === "outdated")
    && typeof value.project === "string" && value.project.length <= 1024
    && value.project.split("/").every((part) => part !== "." && part !== ".." && /^[\w.-]+$/.test(part))
    && typeof value.package === "string" && /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(value.package)
    && typeof value.identifier === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.identifier)
    && typeof value.summary === "string" && value.summary.length > 0 && value.summary.length <= 500
    && !/[\r\n\x00-\x1f]/.test(value.summary);
}

export function readCandidates(file: string): IssueCandidate[] {
  const contents = readFileSync(file, "utf8");
  if (Buffer.byteLength(contents) > 1024 * 1024) throw new Error("Issue候補がサイズ上限を超えています。");
  const value: unknown = JSON.parse(contents);
  if (!Array.isArray(value) || value.length > 200 || !value.every(isCandidate)) {
    throw new Error("Issue候補の形式が不正です。");
  }
  return value;
}

export function writeCandidates(file: string, candidates: IssueCandidate[]): void {
  if (candidates.length > 200 || !candidates.every(isCandidate)) throw new Error("Issue候補の形式が不正です。");
  writeFileSync(file, `${JSON.stringify(candidates, null, 2)}\n`);
}

export function issueMarker(candidate: IssueCandidate): string {
  const key = JSON.stringify([candidate.kind, candidate.project, candidate.package, candidate.identifier]);
  return `<!-- maintenance:${createHash("sha256").update(key).digest("hex")} -->`;
}
