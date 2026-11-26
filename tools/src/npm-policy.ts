export type UpdatePolicy = { minor: boolean; patch: boolean };
export type OutdatedUpdate = { package: string; current: string; target: string };

export const dependencySections = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;

export function simpleVersionSpec(value: unknown): { prefix: string; version: string } | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^([~^]?)((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/.exec(value);
  if (!match || match[2].split(".").some((part) => !Number.isSafeInteger(Number(part)))) return undefined;
  return { prefix: match[1], version: match[2] };
}

export function isAllowedUpdate(current: string, target: string, policy: UpdatePolicy): boolean {
  const from = simpleVersionSpec(current);
  const to = simpleVersionSpec(target);
  if (!from || !to || from.prefix || to.prefix) return false;
  const [fromMajor, fromMinor, fromPatch] = from.version.split(".").map(Number);
  const [toMajor, toMinor, toPatch] = to.version.split(".").map(Number);
  if (fromMajor !== toMajor || toMinor < fromMinor) return false;
  if (toMinor > fromMinor) return policy.minor;
  return toPatch > fromPatch && policy.patch;
}

export function policyFromEnvironment(): UpdatePolicy {
  function parse(name: string): boolean {
    const value = process.env[name] ?? "true";
    if (value !== "true" && value !== "false") throw new Error(`${name}はtrueまたはfalseで指定してください。`);
    return value === "true";
  }
  return { minor: parse("AUTO_MINOR"), patch: parse("AUTO_PATCH") };
}
