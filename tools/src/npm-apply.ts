import { applyPatch, assertChanges, assertUnchangedFileModes } from "./git-repository.ts";
import { assertManifestChanges, assertUpdatedDependencies, assertVersions, nextPatch, projectFiles, readTrackedJson } from "./npm-project.ts";
import { policyFromEnvironment } from "./npm-policy.ts";

export function applyCandidate(project: string, patchFile: string): void {
  const { manifest, lock } = projectFiles(project);
  assertChanges([]);
  const before = readTrackedJson(manifest);
  const expectedVersion = nextPatch(before.version);
  const originalLock = readTrackedJson(lock);
  assertVersions(before, originalLock, String(before.version));
  applyPatch(patchFile, [manifest, lock]);
  if (!assertChanges([manifest, lock])) throw new Error("差分が適用されませんでした。");
  const after = readTrackedJson(manifest);
  assertManifestChanges(before, after, expectedVersion, originalLock, policyFromEnvironment());
  const updatedLock = readTrackedJson(lock);
  assertVersions(after, updatedLock, expectedVersion);
  assertUpdatedDependencies(before, after, updatedLock);
  assertUnchangedFileModes([manifest, lock]);
}
