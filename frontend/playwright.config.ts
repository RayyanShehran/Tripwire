import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { defineConfig } from "@playwright/test";

const frontendDir = __dirname;
const backendDir = resolve(frontendDir, "../backend");
const venvPython = resolve(
  backendDir,
  process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python",
);
const python = existsSync(venvPython) ? `"${venvPython}"` : "python";
const nextBuildDir = resolve(frontendDir, ".next");
if (dirname(nextBuildDir) !== frontendDir) {
  throw new Error("Refusing to clean a Next.js build directory outside the frontend root");
}
const frontendCommand = process.platform === "win32"
  ? `powershell -NoProfile -Command "$env:NEXT_PUBLIC_API_URL='http://127.0.0.1:8000'; Remove-Item -LiteralPath '${nextBuildDir}' -Recurse -Force -ErrorAction SilentlyContinue; pnpm dev --hostname 127.0.0.1 --port 3000"`
  : `rm -rf '${nextBuildDir}' && NEXT_PUBLIC_API_URL=http://127.0.0.1:8000 pnpm dev --hostname 127.0.0.1 --port 3000`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "line",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: `${python} -m uvicorn app.main:app --host 127.0.0.1 --port 8000`,
      cwd: backendDir,
      url: "http://127.0.0.1:8000/health",
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: frontendCommand,
      cwd: frontendDir,
      url: "http://127.0.0.1:3000",
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
