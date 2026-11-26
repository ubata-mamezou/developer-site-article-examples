import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

export const root = process.cwd();

export function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

export function trackedProjectFiles(project: string, names: string[]): string[] {
  if (!project || project.split("/").some((part) => !part || part === "." || part === ".." || !/^[\w.-]+$/.test(part))) {
    throw new Error("プロジェクトにはリポジトリ内の相対パスを指定してください。");
  }
  const files = names.map((name) => `${project}/${name}`);
  const tracked = new Set(git("ls-files", "-z", "--", ...files).split("\0").filter(Boolean));
  if (files.some((file) => !tracked.has(file))) {
    throw new Error(`${project}: Git管理対象の${names.join("と")}が必要です。`);
  }
  let current = root;
  for (const component of project.split("/")) {
    current = path.join(current, component);
    if (lstatSync(current).isSymbolicLink()) throw new Error("シンボリックリンクを含むパスは使用できません。");
  }
  for (const file of files) {
    if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) throw new Error(`${file}: 通常ファイルが必要です。`);
    if (!realpathSync(file).startsWith(`${realpathSync(root)}${path.sep}`)) throw new Error(`${file}: リポジトリ外の参照は禁止です。`);
  }
  return files;
}

export function assertChanges(files: string[]): boolean {
  const status = git("status", "--porcelain=v1", "-z", "--untracked-files=all").split("\0").filter(Boolean);
  for (const entry of status) {
    if (!files.some((file) => entry === ` M ${file}`)) throw new Error(`想定外の変更を検出しました: ${entry}`);
  }
  return status.length > 0;
}

export function assertRegularTrackedFile(file: string): void {
  const entry = git("ls-files", "--stage", "--", file);
  if (!entry.startsWith("100644 ") || !lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) {
    throw new Error(`${file}: 通常のGit管理ファイルではありません。`);
  }
}

export function applyPatch(patchFile: string, files: string[]): void {
  const patch = readFileSync(patchFile);
  if (patch.length === 0 || patch.length > 5 * 1024 * 1024) throw new Error("差分のサイズが不正です。");
  const records = git("apply", "--numstat", "-z", "--", patchFile).split("\0").filter(Boolean);
  if (records.length !== files.length || records.some((record) => !/^\d+\t\d+\t/.test(record))
    || !files.every((file) => records.some((record) => record.split("\t")[2] === file))) {
    throw new Error("許可対象外の差分、バイナリ、名前変更は許可されません。");
  }
  git("apply", "--check", "--", patchFile);
  git("apply", "--", patchFile);
}

export function assertUnchangedFileModes(files: string[]): void {
  for (const file of files) {
    const raw = git("diff", "--raw", "--no-abbrev", "--", file);
    if (!/^:100644 100644 [0-9a-f]+ [0-9a-f]+ M\t/.test(raw)) throw new Error(`${file}: モード変更は禁止です。`);
  }
}
