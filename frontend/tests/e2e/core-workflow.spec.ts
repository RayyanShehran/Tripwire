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
