import { readFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { assertChanges, assertRegularTrackedFile, git, root, trackedProjectFiles } from "./git-repository.ts";
import { isObject, type JsonObject } from "./json.ts";
import { dependencySections, isAllowedUpdate, simpleVersionSpec, type UpdatePolicy } from "./npm-policy.ts";

export { isObject, type JsonObject } from "./json.ts";

export function readObject(file: string): JsonObject {
  const value: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!isObject(value)) throw new Error(`${file}: JSONオブジェクトが必要です。`);
  return value;
}

export function projectFiles(project: string): { manifest: string; lock: string } {
  const [manifest, lock] = trackedProjectFiles(project, ["package.json", "package-lock.json"]);
  return { manifest, lock };
}

export function readTrackedJson(file: string): JsonObject {
  assertRegularTrackedFile(file);
  return readObject(file);
}

export function nextPatch(version: unknown): string {
  const match = typeof version === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (!match || match.slice(1).some((part) => !Number.isSafeInteger(Number(part)))) {
    throw new Error("プロジェクトには正式なSemVerバージョンが必要です。");
  }
  const patch = Number(match[3]);
  if (!Number.isSafeInteger(patch + 1)) throw new Error("パッチバージョンを更新できません。");
  return `${match[1]}.${match[2]}.${patch + 1}`;
}

export function assertVersions(manifest: JsonObject, lock: JsonObject, version: string): void {
  const packages = lock.packages;
  const rootPackage = isObject(packages) ? packages[""] : undefined;
  if (manifest.version !== version || lock.version !== version
    || !isObject(rootPackage) || rootPackage.version !== version) {
    throw new Error("package.jsonとpackage-lock.jsonのバージョンが一致しません。");
  }
}

export function assertManifestChanges(
  before: JsonObject, after: JsonObject, version: string, originalLock: JsonObject, policy: UpdatePolicy,
): void {
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (key === "version" || isDeepStrictEqual(before[key], after[key])) continue;
    if (!dependencySections.some((section) => section === key)) {
      throw new Error(`package.jsonの許可されていない変更です: ${key}`);
    }
    const previous = before[key];
    const updated = after[key];
    if (!isObject(previous) || !isObject(updated)
      || !isDeepStrictEqual(Object.keys(previous).sort(), Object.keys(updated).sort())) {
      throw new Error(`package.jsonの許可されていない変更です: ${key}`);
    }
    const packages = originalLock.packages;
    for (const name of Object.keys(previous)) {
      if (isDeepStrictEqual(previous[name], updated[name])) continue;
      const oldSpec = simpleVersionSpec(previous[name]);
      const newSpec = simpleVersionSpec(updated[name]);
      const locked = isObject(packages) ? packages[`node_modules/${name}`] : undefined;
      const current = isObject(locked) ? locked.version : undefined;
      if (!oldSpec || !newSpec || oldSpec.prefix !== newSpec.prefix || typeof current !== "string"
        || !isAllowedUpdate(current, newSpec.version, policy)) {
        throw new Error(`package.jsonの許可されていない変更です: ${key}.${name}`);
      }
    }
  }
  if (after.version !== version) throw new Error("パッチバージョンが正しく更新されていません。");
}

export function assertUpdatedDependencies(before: JsonObject, after: JsonObject, lock: JsonObject): void {
  const packages = lock.packages;
  const rootPackage = isObject(packages) ? packages[""] : undefined;
  if (!isObject(packages) || !isObject(rootPackage)) throw new Error("lockfileのルート情報が不正です。");
  for (const section of dependencySections) {
    const previous = before[section];
    const updated = after[section];
    if (!isObject(previous) || !isObject(updated)) continue;
    for (const name of Object.keys(previous)) {
      if (isDeepStrictEqual(previous[name], updated[name])) continue;
      const rootDependencies = rootPackage[section];
      const installed = packages[`node_modules/${name}`];
      const spec = simpleVersionSpec(updated[name]);
      if (!isObject(rootDependencies) || rootDependencies[name] !== updated[name] || !isObject(installed)
        || !spec || installed.version !== spec.version) {
        throw new Error(`lockfileの依存関係が一致しません: ${section}.${name}`);
      }
    }
  }
}

function isLocalReferenceToProject(value: unknown, otherDir: string, project: string): boolean {
  if (typeof value !== "string" || !/^(file|link):/.test(value)) return false;
  const target = path.resolve(root, otherDir, value.replace(/^(file|link):/, ""));
  const projectDir = path.resolve(root, project);
  return target === projectDir || target.startsWith(`${projectDir}${path.sep}`);
}

type DependencyContext = {
  project: string;
  manifest: string;
  otherManifest: string;
  packageName: unknown;
};

function assertDependenciesSupported(dependencies: JsonObject, context: DependencyContext): void {
  const { project, manifest, otherManifest, packageName } = context;
  const values = Object.values(dependencies);
  if (otherManifest === manifest) {
    if (values.some((value) => typeof value === "string" && /^(file|link|workspace):/.test(value))) {
      throw new Error(`${project}: ローカル依存の統合検証は未対応です。`);
    }
    return;
  }
  if (typeof packageName === "string" && packageName && Object.hasOwn(dependencies, packageName)) {
    throw new Error(`${project}: ${otherManifest}が依存しているため単独では検証できません。`);
  }
  const otherDir = path.posix.dirname(otherManifest);
  if (values.some((value) => isLocalReferenceToProject(value, otherDir, project))) {
    throw new Error(`${project}: ${otherManifest}がローカル参照しているため単独では検証できません。`);
  }
}

export function assertStandaloneProject(project: string, manifest: string, pkg: JsonObject): void {
  const manifests = git("ls-files", "-z", "--", "**/package.json", "package.json").split("\0").filter(Boolean);
  for (const otherManifest of manifests) {
    const other = readObject(otherManifest);
    const otherDir = path.posix.dirname(otherManifest);
    if (other.workspaces && (otherDir === "." || project === otherDir || project.startsWith(`${otherDir}/`))) {
      throw new Error(`${project}: workspacesの統合検証は未対応です。`);
    }
    const context: DependencyContext = { project, manifest, otherManifest, packageName: pkg.name };
    for (const value of [other.dependencies, other.devDependencies, other.optionalDependencies, other.peerDependencies]) {
      if (value !== undefined && !isObject(value)) throw new Error(`${otherManifest}: 依存関係が不正です。`);
      assertDependenciesSupported(value ?? {}, context);
    }
  }
}

export type NpmProject = {
  manifest: string;
  lock: string;
  original: JsonObject;
  originalLock: JsonObject;
  nextVersion: string;
};

export function validateProject(project: string): NpmProject {
  const { manifest, lock } = projectFiles(project);
  assertChanges([]);
  const original = readObject(manifest);
  const nextVersion = nextPatch(original.version);
  const originalLock = readTrackedJson(lock);
  assertVersions(original, originalLock, String(original.version));
  if (!isObject(original.scripts) || !original.scripts.build || !original.scripts.test) {
    throw new Error(`${project}: buildとtestの両方が必要です。`);
  }
  assertStandaloneProject(project, manifest, original);
  return { manifest, lock, original, originalLock, nextVersion };
}
