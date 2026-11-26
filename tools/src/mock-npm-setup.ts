import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function setupMockNpm(bin: string): void {
  mkdirSync(bin, { recursive: true });
  const script = fileURLToPath(new URL("./mock-npm.ts", import.meta.url));
  const command = path.join(bin, process.platform === "win32" ? "npm.cmd" : "npm");
  if (process.platform === "win32") {
    writeFileSync(command, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
  } else {
    const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
    writeFileSync(command, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(script)} "$@"\n`);
    chmodSync(command, 0o755);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const bin = process.argv[2];
  if (!bin) throw new Error("模擬npmの配置先が必要です。");
  setupMockNpm(bin);
}
