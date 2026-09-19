import { expect, test, type Page } from "@playwright/test";

async function resetBrowserState(page: Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByText("8 buses / 12 transmission lines")).toBeVisible();
}

async function addCustomBranch(page: Page, prefix: string) {
  await page.getByRole("button", { name: "Bus", exact: true }).click();
  let form = page.locator(".editor-dialog");
  await form.getByLabel("Name").fill(`${prefix} Bus`);
  await form.getByRole("button", { name: "Apply" }).click();

  await page.getByRole("button", { name: "Load", exact: true }).click();
  form = page.locator(".editor-dialog");
  await form.getByLabel("Name").fill(`${prefix} Load`);
  await form.getByLabel("Connected bus").selectOption("bus-8");
  await form.getByRole("button", { name: "Apply" }).click();

  await page.getByRole("button", { name: "Transmission Line" }).click();
  form = page.locator(".editor-dialog");
  await form.getByLabel("Name").fill(`${prefix} Tie`);
  await form.getByLabel("Source bus").selectOption("bus-8");
  await form.getByLabel("Target bus").selectOption("bus-6");
  await form.getByRole("button", { name: "Apply" }).click();
}

test("build, save, solve, simulate, and restore a custom grid", async ({ page }) => {
  await resetBrowserState(page);

  await page.getByRole("button", { name: "Edit Grid" }).click();
  await page.getByRole("button", { name: "Duplicate" }).click();

  await page.getByRole("button", { name: "Bus", exact: true }).click();
  let form = page.locator(".editor-dialog");
  await form.getByLabel("Name").fill("Builder Test Bus");
  await form.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("9 buses / 12 transmission lines")).toBeVisible();

  await page.getByRole("button", { name: "Load", exact: true }).click();
  form = page.locator(".editor-dialog");
  await form.getByLabel("Name").fill("Builder Test Load");
  await form.getByLabel("Connected bus").selectOption("bus-8");
  await form.getByRole("button", { name: "Apply" }).click();

  await page.getByRole("button", { name: "Transmission Line" }).click();
  form = page.locator(".editor-dialog");
  await form.getByLabel("Name").fill("Builder Test Tie");
  await form.getByLabel("Source bus").selectOption("bus-8");
  await form.getByLabel("Target bus").selectOption("bus-6");
  await form.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("9 buses / 13 transmission lines")).toBeVisible();

  const customBus = page.locator('.react-flow__node[data-id="bus-8"]');
  const before = await customBus.boundingBox();
  if (!before) throw new Error("Custom bus was not rendered");
  const beforeTransform = await customBus.getAttribute("style");
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 - 120, before.y + before.height / 2 + 40, { steps: 5 });
  await page.mouse.up();
  await expect(customBus).not.toHaveAttribute("style", beforeTransform ?? "");

  page.once("dialog", (dialog) => dialog.accept("Custom Test Grid"));
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Apply & Analyze" }).click();
  await expect(page.getByText("9 buses / 13 transmission lines")).toBeVisible();
  await expect(page.getByText("ML prediction unavailable for modified topology.")).toBeVisible();

  await page.locator('.react-flow__node[data-id="bus-8"]').click();
  await page.getByRole("button", { name: "Run Cascade" }).click();
  await expect(page.getByRole("heading", { name: "Cascade timeline" })).toBeVisible();

  await page.reload();
  await expect(page.getByText("8 buses / 12 transmission lines")).toBeVisible();
  await page.getByRole("button", { name: "Edit Grid" }).click();
  await page.getByLabel("Saved scenario").selectOption({ label: "Custom Test Grid" });
  await expect(page.getByText("Builder Test Bus")).toBeVisible();
  const restored = await page.locator('.react-flow__node[data-id="bus-8"]').boundingBox();
  expect(restored).not.toBeNull();
  const savedPosition = await page.evaluate(() => {
    const presets = JSON.parse(localStorage.getItem("tripwire:grid-editor:presets:v1") ?? "[]");
    return presets.find((item: { name: string }) => item.name === "Custom Test Grid")?.visual_layout.positions["bus-8"];
  });
  expect(savedPosition).not.toEqual({ x: 810, y: 360 });
});

test("save, rename, duplicate, and delete user scenarios while protecting the built-in grid", async ({ page }) => {
  await resetBrowserState(page);
  await page.getByRole("button", { name: "Edit Grid" }).click();
  const editor = page.getByRole("complementary", { name: "Grid editor" });
  await expect(editor.getByText("Read-only preset")).toBeVisible();
  await expect(editor.getByRole("button", { name: "Delete" })).toHaveCount(0);

  await page.getByRole("button", { name: "Bus", exact: true }).click();
  const form = page.locator(".editor-dialog");
  await form.getByLabel("Name").fill("Preset Test Bus");
  await form.getByRole("button", { name: "Apply" }).click();

  page.once("dialog", (dialog) => dialog.accept("Preset Lifecycle"));
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor.getByLabel("Saved scenario")).toHaveValue(/scenario-/);

  page.once("dialog", (dialog) => dialog.accept("Renamed Production Scenario"));
  await editor.getByRole("button", { name: "Rename" }).click();
  await expect(editor.getByLabel("Saved scenario").locator("option:checked")).toHaveText("Renamed Production Scenario");

  await editor.getByRole("button", { name: "Duplicate" }).last().click();
  await expect(editor.getByLabel("Saved scenario").locator("option:checked")).toHaveText("Renamed Production Scenario Copy");
  await expect(editor.getByLabel("Saved scenario").locator("option", { hasText: "Renamed Production Scenario" })).toHaveCount(2);

  page.once("dialog", (dialog) => dialog.accept());
  await editor.getByRole("button", { name: "Delete" }).click();
  await expect(editor.getByLabel("Saved scenario").locator("option", { hasText: "Renamed Production Scenario Copy" })).toHaveCount(0);
  await expect(editor.getByLabel("Saved scenario").locator("option", { hasText: "Renamed Production Scenario" })).toHaveCount(1);
  await expect(editor.getByText("Tripwire Teaching Grid")).toBeVisible();
});

test("exports and imports scenarios and rejects malformed documents", async ({ page }) => {
  await resetBrowserState(page);
  await page.getByRole("button", { name: "Edit Grid" }).click();
  const editor = page.getByRole("complementary", { name: "Grid editor" });

  await page.getByRole("button", { name: "Bus", exact: true }).click();
  const form = page.locator(".editor-dialog");
  await form.getByLabel("Name").fill("Exported Scenario Bus");
  await form.getByRole("button", { name: "Apply" }).click();

  const downloadPromise = page.waitForEvent("download");
  await editor.getByRole("button", { name: "Export" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("tripwire-scenario.json");
  const exportedPath = await download.path();
  expect(exportedPath).not.toBeNull();
  const exported = await import("node:fs/promises").then(({ readFile }) => readFile(exportedPath!, "utf8"));
  const exportedDocument = JSON.parse(exported);
  expect(exportedDocument.grid_definition.buses.some((bus: { name: string }) => bus.name === "Exported Scenario Bus")).toBe(true);

  page.once("dialog", (dialog) => dialog.accept());
  await editor.getByRole("button", { name: "Reset" }).click();
  await expect(page.getByText("Exported Scenario Bus")).toHaveCount(0);

  const fileInput = editor.locator('input[type="file"]');
  await fileInput.setInputFiles({ name: "tripwire-scenario.json", mimeType: "application/json", buffer: Buffer.from(exported) });
  await expect(page.getByText("Exported Scenario Bus")).toBeVisible();

  await fileInput.setInputFiles({ name: "broken.json", mimeType: "application/json", buffer: Buffer.from("{") });
  await expect(page.locator(".error-banner")).toContainText(/JSON|Expected|Unexpected/i);

  await fileInput.setInputFiles({ name: "wrong-version.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ...exportedDocument, schema_version: 999 })) });
  await expect(page.locator(".error-banner")).toContainText("Unsupported scenario schema version: 999");

  exportedDocument.grid_definition.loads[0].bus_id = "missing-bus";
  await fileInput.setInputFiles({ name: "invalid-grid.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(exportedDocument)) });
  await expect(editor.getByRole("button", { name: /1 issues/ })).toBeVisible();
  await editor.getByText("Errors and warnings").click();
  await expect(editor.getByText("Connected bus does not exist")).toBeVisible();
});

test("runs failure, cascade, and mitigation analysis on a modified grid", async ({ page }) => {
  test.setTimeout(120_000);
  await resetBrowserState(page);
  await page.getByRole("combobox", { name: "Preset" }).selectOption({ label: "Mitigation Example" });
  await expect(page.getByText("500.0 MW", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Edit Grid" }).click();
  await page.getByRole("button", { name: "Duplicate" }).click();
  await addCustomBranch(page, "Analysis Test");
  await expect(page.getByText("9 buses / 13 transmission lines")).toBeVisible();
  await page.getByRole("button", { name: "Apply & Analyze" }).click();
  await expect(page.getByText("ML prediction unavailable for modified topology.")).toBeVisible();

  await page.locator('.react-flow__edge[data-id="line-101"] path').first().click({ force: true });
  const controls = page.getByRole("complementary", { name: "Scenario controls" });
  await controls.getByRole("button", { name: "Simulate Failure" }).click();
  await expect(page.getByText("Single failure", { exact: true })).toBeVisible();
  await expect(page.getByText("Failed lines")).toBeVisible();

  await controls.getByRole("button", { name: "Run Cascade" }).click();
  await expect(page.getByRole("heading", { name: "Cascade timeline" })).toBeVisible();
  await expect(page.getByText(/FINAL OUTCOME/i)).toBeVisible();

  await controls.getByRole("button", { name: "Find Mitigation" }).click();
  await expect(page.getByRole("heading", { name: "Original cascade" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Simulate Recommendation" }).first()).toBeVisible();
});
