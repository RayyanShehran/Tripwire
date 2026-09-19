import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const frontendUrl = process.env.TRIPWIRE_FRONTEND_URL ?? "https://tripwire-eta.vercel.app";
const apiUrl = process.env.TRIPWIRE_API_URL ?? "https://tripwire-api-4ecd.onrender.com";
const outputDir = resolve(import.meta.dirname, "../../docs/screenshots");
await mkdir(outputDir, { recursive: true });

async function requireJson(path, predicate) {
  const response = await fetch(`${apiUrl}${path}`);
  assert.equal(response.ok, true, `${path} returned ${response.status}`);
  const body = await response.json();
  assert.equal(predicate(body), true, `${path} returned an unexpected response`);
}

await requireJson("/health", (body) => body.status === "ok");
await requireJson(
  "/ready",
  (body) => body.status === "ready" && body.checks?.simulator === "ok" && body.checks?.models === "ok",
);
await requireJson("/api/grid", (body) => body.nodes?.length > 0 && body.lines?.length > 0);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(30_000);

const shot = async (name) => {
  await page.screenshot({ path: resolve(outputDir, name), animations: "disabled" });
};
const ready = async () => {
  await page.getByText("API connected").waitFor({ state: "visible", timeout: 90_000 });
  await page.locator(".grid-node").first().waitFor({ state: "visible" });
};
const form = () => page.locator(".editor-dialog");
const add = async (name, values = {}) => {
  await page.getByRole("button", { name, exact: true }).click();
  for (const [label, value] of Object.entries(values)) {
    const field = form().getByLabel(label);
    if (await field.evaluate((element) => element.tagName === "SELECT")) {
      await field.selectOption(String(value));
    } else {
      await field.fill(String(value));
    }
  }
  await form().getByRole("button", { name: "Apply" }).click();
};

try {
  await page.goto(frontendUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await ready();
  await page.getByText("8 buses / 12 transmission lines").waitFor();
  await shot("01-healthy-grid.png");

  await page.locator('.react-flow__node[data-id="bus-0"]').click();
  await page.getByRole("tabpanel").getByRole("heading", { name: "North 230 kV Bus" }).waitFor();
  await shot("02-component-inspection.png");

  await page.getByRole("button", { name: "Edit Grid" }).click();
  await page.getByRole("complementary", { name: "Grid editor" }).waitFor();
  await shot("03-grid-editor.png");

  await add("Bus", { Name: "Release Bus" });
  await add("Generator", { Name: "Release Generator", "Connected bus": "bus-8", "Setpoint MW": 30 });
  await add("Load", { Name: "Release Load", "Connected bus": "bus-8", "Demand MW": 25 });
  await add("Transmission Line", { Name: "Release Tie", "Source bus": "bus-8", "Target bus": "bus-6" });
  await page.getByText("9 buses / 13 transmission lines").waitFor();

  await add("Bus", { Name: "Temporary Audit Bus" });
  await page.locator('.react-flow__node[data-id="bus-9"]').click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("complementary", { name: "Grid editor" }).getByRole("button", { name: "Remove" }).click();
  await page.locator('.react-flow__node[data-id="bus-9"]').waitFor({ state: "detached" });

  await page.locator('.react-flow__node[data-id="bus-8"]').click();
  await page.getByRole("complementary", { name: "Grid editor" }).getByRole("button", { name: "Edit" }).click();
  await form().getByLabel("Notes").fill("Release evidence scenario");
  await form().getByRole("button", { name: "Apply" }).click();
  await page.getByRole("button", { name: "Network valid" }).click();

  const customBus = page.locator('.react-flow__node[data-id="bus-8"]');
  const box = await customBus.boundingBox();
  assert.ok(box, "custom bus was not rendered");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 100, box.y + box.height / 2 + 30, { steps: 5 });
  await page.mouse.up();

  page.once("dialog", (dialog) => dialog.accept("Release Custom Grid"));
  await page.getByRole("complementary", { name: "Grid editor" }).getByRole("button", { name: "Save", exact: true }).click();
  await shot("04-custom-grid.png");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("complementary", { name: "Grid editor" }).getByRole("button", { name: "Export" }).click();
  const download = await downloadPromise;
  const exportedPath = await download.path();
  assert.ok(exportedPath, "scenario export did not produce a file");
  const exported = await readFile(exportedPath);
  await page.getByRole("complementary", { name: "Grid editor" }).locator('input[type="file"]').setInputFiles({
    name: "tripwire-release-scenario.json",
    mimeType: "application/json",
    buffer: exported,
  });
  await page.locator('.react-flow__node[data-id="bus-8"]').getByText("Release Bus").waitFor();

  await page.getByRole("button", { name: "Apply & Analyze" }).click();
  await page.getByText("ML prediction unavailable for modified topology.").waitFor();
  await page.locator('.react-flow__node[data-id="bus-8"]').click();
  await page.getByRole("button", { name: "Run Cascade" }).click();
  await page.getByRole("heading", { name: "Cascade timeline" }).waitFor();

  await page.reload({ waitUntil: "domcontentloaded" });
  await ready();
  await page.getByText("8 buses / 12 transmission lines").waitFor();
  await page.getByRole("combobox", { name: "Preset" }).selectOption({ label: "Severe Cascade" });
  await page.getByRole("button", { name: "Predict Risk" }).click();
  await page.getByRole("heading", { name: "Risk prediction" }).waitFor();
  await shot("05-risk-prediction.png");

  await page.getByRole("button", { name: "Run Cascade" }).click();
  const timeline = page.getByRole("region", { name: "Cascade timeline" });
  await timeline.waitFor();
  const steps = timeline.locator(".timeline-steps button");
  assert.ok(await steps.count() >= 3, "severe preset did not produce a multi-step cascade");
  await steps.first().click();
  await shot("06-cascade-start.png");
  await steps.nth(1).click();
  await shot("07-cascade-midpoint.png");
  await steps.last().click();
  await page.getByText("Blackout", { exact: true }).first().waitFor();
  await shot("08-blackout.png");
  await page.getByRole("button", { name: "Replay" }).click();
  await page.getByRole("button", { name: "Pause" }).waitFor();
  await timeline.scrollIntoViewIfNeeded();
  await shot("09-timeline.png");
  await page.getByRole("button", { name: "Pause" }).click();

  await page.getByRole("combobox", { name: "Preset" }).selectOption({ label: "Mitigation Example" });
  await page.getByRole("button", { name: "Run Cascade" }).click();
  await page.getByRole("button", { name: /Blackout 100\.0% loss/ }).click();
  await page.getByRole("button", { name: "Find Mitigation" }).click();
  await page.getByRole("heading", { name: "Original cascade" }).waitFor({ timeout: 90_000 });
  await shot("10-mitigation-recommendation.png");
  await page.getByRole("button", { name: "Simulate Recommendation" }).first().click();
  await page.getByText("95.0 percentage points", { exact: true }).waitFor();
  await shot("11-before-after-comparison.png");

  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await page.getByText("None selected").waitFor();
  await page.getByRole("button", { name: "Edit Grid" }).click();
  await page.getByLabel("Saved scenario").selectOption({ label: "Release Custom Grid" });
  await page.locator('.react-flow__node[data-id="bus-8"]').getByText("Release Bus").waitFor();
  await shot("12-saved-custom-scenario.png");

  console.log(`Production smoke test passed; screenshots written to ${outputDir}`);
} finally {
  await browser.close();
}
