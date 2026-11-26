import path from "node:path";
import { fileURLToPath } from "node:url";
import { issueMarker, readCandidates, type IssueCandidate } from "./issue-candidates.ts";
import { isObject } from "./json.ts";

type Fetch = typeof fetch;

async function request(fetcher: Fetch, url: string, token: string, init?: RequestInit): Promise<unknown> {
  const response = await fetcher(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...init?.headers,
    },
  });
  if (!response.ok) throw new Error(`GitHub APIが失敗しました: HTTP ${response.status}`);
  return response.json();
}

export async function publishIssues(
  candidates: IssueCandidate[], apiUrl: string, repository: string, token: string, fetcher: Fetch = fetch,
): Promise<void> {
  if (!/^https:\/\/[^/?#]+(?:\/[^?#]*)?$/.test(apiUrl)
    || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !token) {
    throw new Error("GitHub APIの接続情報が不正です。");
  }
  const endpoint = `${apiUrl.replace(/\/$/, "")}/repos/${repository}/issues`;
  const existing = new Set<string>();
  for (let page = 1; page <= 20; page++) {
    const data = await request(fetcher, `${endpoint}?state=open&per_page=100&page=${page}`, token);
    if (!Array.isArray(data)) throw new Error("GitHub Issue一覧の形式が不正です。");
    for (const item of data) {
      if (!isObject(item) || typeof item.body !== "string" && item.body !== null) {
        throw new Error("GitHub Issue一覧の形式が不正です。");
      }
      if (!item.pull_request && typeof item.body === "string") {
        for (const marker of item.body.match(/<!-- maintenance:[a-f0-9]{64} -->/g) ?? []) existing.add(marker);
      }
    }
    if (data.length < 100) break;
    if (page === 20) throw new Error("Issue一覧が取得上限を超えました。重複確認できないため停止します。");
  }
  for (const candidate of candidates) {
    const marker = issueMarker(candidate);
    if (existing.has(marker)) {
      console.log(`既存Issueを確認: ${candidate.project} ${candidate.package} ${candidate.identifier}`);
      continue;
    }
    const title = `[${candidate.kind}] ${candidate.package} ${candidate.identifier}`.slice(0, 256);
    const summary = candidate.summary.replaceAll("`", "'");
    const reference = /^CVE-\d{4}-\d{4,}$/.test(candidate.identifier)
      ? `\n参考: https://nvd.nist.gov/vuln/detail/${candidate.identifier}\n`
      : /^GHSA-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(candidate.identifier)
        ? `\n参考: https://github.com/advisories/GHSA-${candidate.identifier.slice(5).toLowerCase()}\n`
        : "";
    const body = `${marker}\n\n対象: \`${candidate.project}\`\n\nパッケージ: \`${candidate.package}\`\n\n識別子: \`${candidate.identifier}\`\n\n\`${summary}\`\n${reference}`;
    await request(fetcher, endpoint, token, {
      method: "POST",
      body: JSON.stringify({ title, body }),
      headers: { "Content-Type": "application/json" },
    });
    existing.add(marker);
    console.log(`Issueを作成: ${candidate.project} ${candidate.package} ${candidate.identifier}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const file = process.argv[2];
    if (!file) throw new Error("Issue候補ファイルを指定してください。");
    await publishIssues(readCandidates(file), process.env.GITHUB_API_URL ?? "", process.env.GITHUB_REPOSITORY ?? "",
      process.env.GITHUB_TOKEN ?? "");
  } catch (error) {
    console.error(`エラー: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
