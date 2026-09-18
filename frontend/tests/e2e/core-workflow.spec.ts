import { expect, test } from "@playwright/test";

test("core cascade, replay, mitigation, and reset workflow", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("API connected")).toBeVisible();
  await expect(page.getByText("Healthy", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("400.0 MW", { exact: true }).first()).toBeVisible();

  await page.getByRole("combobox", { name: "Preset" }).selectOption({
    label: "Mitigation Example",
  });
  await expect(page.getByText("500.0 MW", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Stressed", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Predict Risk" }).click();
  await expect(page.getByRole("heading", { name: "Risk prediction" })).toBeVisible();
  await expect(page.getByText("Predicted load loss")).toBeVisible();

  await page.getByRole("button", { name: "Run Cascade" }).click();
  const blackoutStep = page.getByRole("button", { name: /Blackout 100\.0% loss/ });
  await expect(blackoutStep).toBeVisible();
  await blackoutStep.click();
  await expect(page.getByText("Blackout", { exact: true }).first()).toBeVisible();

  const replay = page.getByRole("button", { name: "Replay" });
  await expect(replay).toBeEnabled();
  await replay.click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();

  await page.getByRole("button", { name: "Find Mitigation" }).click();
  const recommendation = page.getByRole("button", {
    name: "Simulate Recommendation",
  }).first();
  await expect(recommendation).toBeVisible();
  await expect(page.getByRole("heading", { name: "Original cascade" })).toBeVisible();
  await expect(page.getByText("95.0 pp", { exact: true })).toBeVisible();

  await recommendation.click();
  await expect(page.getByText("Mitigated", { exact: true })).toBeVisible();
  await expect(page.getByText("Improvement", { exact: true })).toBeVisible();
  await expect(page.getByText("25.0 MW", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("95.0 percentage points", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Reset" }).click();
  await expect(page.getByText("Healthy", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("None selected")).toBeVisible();
  await expect(page.getByText("400.0 MW", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cascade timeline" })).toHaveCount(0);
});

for (const viewport of [
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
]) {
  test(`desktop workspace remains usable at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.getByText("API connected")).toBeVisible();

    const controls = page.getByRole("complementary", { name: "Scenario controls" });
    const network = page.getByRole("region", { name: "Power network" });
    const details = page.getByRole("complementary", { name: "Scenario details" });
    await expect(controls).toBeVisible();
    await expect(network).toBeVisible();
    await expect(details).toBeVisible();
    await expect(page.getByRole("button", { name: "Reset" })).toBeVisible();
    await expect(page.locator(".grid-node").first()).toBeVisible();
    await expect(page.locator(".edge-label").first()).toBeVisible();

    const boxes = await Promise.all([controls.boundingBox(), network.boundingBox(), details.boundingBox()]);
    expect(boxes.every(Boolean)).toBe(true);
    const [controlsBox, networkBox, detailsBox] = boxes;
    expect(controlsBox!.x + controlsBox!.width).toBeLessThanOrEqual(networkBox!.x);
    expect(networkBox!.x + networkBox!.width).toBeLessThanOrEqual(detailsBox!.x);
    expect(networkBox!.width).toBeGreaterThan(700);

    const layout = await page.evaluate(() => {
      const card = document.querySelector<HTMLElement>(".network-frame");
      const button = document.querySelector<HTMLElement>(".button");
      const node = document.querySelector<HTMLElement>(".grid-node");
      const edgeLabel = document.querySelector<HTMLElement>(".edge-label");
      return {
        hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        cardRadius: card ? getComputedStyle(card).borderRadius : null,
        buttonRadius: button ? getComputedStyle(button).borderRadius : null,
        nodeRadius: node ? getComputedStyle(node).borderRadius : null,
        edgeFontSize: edgeLabel ? getComputedStyle(edgeLabel).fontSize : null,
      };
    });
    expect(layout).toEqual({
      hasHorizontalOverflow: false,
      cardRadius: "24px",
      buttonRadius: "18px",
      nodeRadius: "10px",
      edgeFontSize: "13px",
    });

    const preset = page.getByRole("combobox", { name: "Preset" });
    await preset.focus();
    await expect(preset).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath(`${viewport.width}x${viewport.height}.png`), fullPage: true });
  });
}
