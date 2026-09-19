import { expect, test } from "@playwright/test";

test("build, save, solve, simulate, and restore a custom grid", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByText("8 buses / 12 transmission lines")).toBeVisible();

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
