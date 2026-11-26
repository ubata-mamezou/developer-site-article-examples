export type Detection =
  | { status: "clean" }
  | { status: "needs-repair" }
  | { status: "unresolved"; reason: string };

export type RepairResult =
  | { status: "changed" }
  | { status: "unchanged" }
  | { status: "unresolved"; reason: string };

export type RepairSteps<Context> = {
  prepare: () => Context;
  detect: (context: Context) => Detection;
  repair: (context: Context) => void;
  verify: (context: Context) => void;
  save: (context: Context) => void;
};

export function runRepair<Context>(steps: RepairSteps<Context>): RepairResult {
  const context = steps.prepare();
  const detection = steps.detect(context);
  if (detection.status === "clean") return { status: "unchanged" };
  if (detection.status === "unresolved") return detection;
  steps.repair(context);
  steps.verify(context);
  steps.save(context);
  return { status: "changed" };
}
