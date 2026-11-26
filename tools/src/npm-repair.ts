import { writeFileSync } from "node:fs";
import * as semver from "semver";
import { assertChanges, git } from "./git-repository.ts";
import { createNpmCommands, type NpmCommands } from "./npm-commands.ts";
import {
  assertManifestChanges, assertUpdatedDependencies, assertVersions, isObject, readTrackedJson,
  validateProject, type NpmProject,
} from "./npm-project.ts";
import { runRepair, type RepairResult } from "./repair-flow.ts";
import { readUpdates } from "./npm-outdated.ts";
import { dependencySections, isAllowedUpdate, policyFromEnvironment, simpleVersionSpec, type OutdatedUpdate, type UpdatePolicy } from "./npm-policy.ts";

function buildAndTest(npm: NpmCommands): void {
  npm.install();
  npm.build();
  npm.test();
}

function validateCandidate(candidate: NpmProject, policy: UpdatePolicy): void {
  const { manifest, lock, original, originalLock, nextVersion } = candidate;
  assertChanges([manifest, lock]);
  const updated = readTrackedJson(manifest);
  assertManifestChanges(original, updated, nextVersion, originalLock, policy);
  const updatedLock = readTrackedJson(lock);
  assertVersions(updated, updatedLock, nextVersion);
  assertUpdatedDependencies(original, updated, updatedLock);
}

function updateDependencies(candidate: NpmProject, updates: OutdatedUpdate[], policy: UpdatePolicy): boolean {
  const { manifest, lock, original, originalLock } = candidate;
  const originalPackages = originalLock.packages;
  const currentPackages = readTrackedJson(lock).packages;
  if (!isObject(originalPackages) || !isObject(currentPackages)) throw new Error("lockfileの依存関係が不正です。");
  const updated = structuredClone(original);
  let changed = false;
  for (const update of updates) {
    const before = originalPackages[`node_modules/${update.package}`];
    const current = currentPackages[`node_modules/${update.package}`];
    if (!isObject(before) || before.version !== update.current || !isObject(current)
      || typeof current.version !== "string" || semver.valid(current.version) !== current.version
      || !isAllowedUpdate(update.current, update.target, policy)) {
      throw new Error(`更新候補が許可されていません: ${update.package}`);
    }
    if (semver.gte(current.version, update.target)) continue;
    let found = false;
    for (const section of dependencySections) {
      const dependencies = updated[section];
      if (!isObject(dependencies) || !Object.hasOwn(dependencies, update.package)) continue;
      const spec = simpleVersionSpec(dependencies[update.package]);
      if (!spec) throw new Error(`更新対象外の指定形式です: ${section}.${update.package}`);
      dependencies[update.package] = `${spec.prefix}${update.target}`;
      found = true;
    }
    if (!found) throw new Error(`更新対象の依存関係がありません: ${update.package}`);
    changed = true;
  }
  if (changed) writeFileSync(manifest, `${JSON.stringify(updated, null, 2)}\n`);
  return changed;
}

export function prepare(project: string, patchFile: string, updatesFile?: string): RepairResult {
  const npm = createNpmCommands(project);
  const policy = policyFromEnvironment();
  const updates = updatesFile ? readUpdates(updatesFile) : [];
  let vulnerabilities = 0;
  return runRepair<NpmProject>({
    prepare: () => {
      const candidate = validateProject(project);
      buildAndTest(npm);
      assertChanges([]);
      return candidate;
    },
    detect: () => {
      vulnerabilities = npm.audit();
      return vulnerabilities === 0 && updates.length === 0 ? { status: "clean" } : { status: "needs-repair" };
    },
    repair: (candidate) => {
      if (vulnerabilities > 0) {
        const remaining = npm.fix();
        assertChanges([candidate.lock]);
        if (remaining > 0 && updates.length === 0) {
          throw new Error(`${project}: npm audit fixで脆弱性が残っています。`);
        }
      }
      if (updateDependencies(candidate, updates, policy)) npm.updateLock();
      if (!assertChanges([candidate.manifest, candidate.lock])) throw new Error(`${project}: 修正候補に変更がありません。`);
      npm.incrementPatch();
      validateCandidate(candidate, policy);
    },
    verify: (candidate) => {
      buildAndTest(npm);
      if (npm.audit() !== 0) throw new Error(`${project}: 脆弱性が残っています。`);
      validateCandidate(candidate, policy);
    },
    save: ({ manifest, lock }) => {
      writeFileSync(patchFile, git("diff", "--no-ext-diff", "--binary", "--", manifest, lock));
    },
  });
}
