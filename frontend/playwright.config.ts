import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";

const frontendDir = __dirname;
const backendDir = resolve(frontendDir, "../backend");
const venvPython = resolve(
  backendDir,
  process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python",
);
const python = existsSync(venvPython) ? `"${venvPython}"` : "python";
const frontendCommand = process.platform === "win32"
  ? "set NEXT_PUBLIC_API_URL=http://127.0.0.1:8000&& set NEXT_DIST_DIR=.next-e2e&& pnpm dev --hostname 127.0.0.1 --port 3000"
  : "NEXT_PUBLIC_API_URL=http://127.0.0.1:8000 NEXT_DIST_DIR=.next-e2e pnpm dev --hostname 127.0.0.1 --port 3000";

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
