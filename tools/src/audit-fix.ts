import { appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const [mode, project, patchFile, updatesFile] = process.argv.slice(2);
    if (!project || !patchFile) throw new Error("モード、プロジェクト、差分ファイルを指定してください。");
    if (mode === "prepare") {
      const { prepare } = await import("./npm-repair.ts");
      const result = prepare(project, patchFile, updatesFile);
      if (result.status === "unresolved") throw new Error(result.reason);
      const changed = result.status === "changed";
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
      console.log(changed ? "修正候補を作成しました。" : "脆弱性は検出されませんでした。");
    } else if (mode === "apply") {
      const { applyCandidate } = await import("./npm-apply.ts");
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
