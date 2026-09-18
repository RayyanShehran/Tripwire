import { expect, test, type Page } from "@playwright/test";

async function watchNetwork(page: Page) {
  const requests: string[] = [];
  page.on("request", request => {
    if (new URL(request.url()).pathname.startsWith("/api/")) requests.push(request.url());
  });
  await page.goto("/");
  await expect(page.locator(".grid-node").first()).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Preset" }).locator("option")).not.toHaveCount(1);
  await page.evaluate(() => {
    const canvas = document.querySelector(".network-canvas")!;
    const probe = { loading: 0, mounts: 0 };
    Object.assign(window, { networkProbe: probe });
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node instanceof Element) {
          if (node.textContent?.includes("Loading network")) probe.loading++;
          if (node.matches(".react-flow") || node.querySelector(".react-flow")) probe.mounts++;
        }
      }
    }).observe(canvas, { childList: true, subtree: true });
  });
  return requests;
}

async function expectNoRemount(page: Page) {
  expect(await page.evaluate(() => (window as unknown as { networkProbe: unknown }).networkProbe))
    .toEqual({ loading: 0, mounts: 0 });
}

test("new-component actions reuse the existing operating baseline", async ({ page }) => {
  const requests = await watchNetwork(page);
  const initial = requests.filter(url => new URL(url).pathname === "/api/grid").length;
  await page.locator(".react-flow__node-bus").first().click();
  await page.getByRole("button", { name: "Predict Risk", exact: true }).first().click();
  await expect(page.getByText("Estimated load loss")).toBeVisible();
  expect(requests.filter(url => new URL(url).pathname === "/api/grid")).toHaveLength(initial);
  await expectNoRemount(page);
});

test("presets with identical operating conditions do not unload the network", async ({ page }) => {
  const requests = await watchNetwork(page);
  const preset = page.getByRole("combobox", { name: "Preset" });
  await preset.selectOption({ label: "Severe Cascade" });
  await expect(page.getByText("500.0 MW", { exact: true }).first()).toBeVisible();
  await page.evaluate(() => Object.assign((window as unknown as { networkProbe: object }).networkProbe, { loading: 0, mounts: 0 }));
  const initial = requests.length;
  await preset.selectOption({ label: "Mitigation Example" });
  await expect(page.locator(".header-scenario")).toContainText("Mitigation Example");
  await expect(page.locator(".grid-node").first()).toBeVisible();
  expect(requests).toHaveLength(initial);
  await expectNoRemount(page);
});

test("inspection and tabs preserve prediction, cascade, and viewport without API calls", async ({ page }) => {
  const requests = await watchNetwork(page);
  await page.getByRole("combobox", { name: "Preset" }).selectOption({ label: "Mitigation Example" });
  await expect(page.getByText("500.0 MW", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Predict Risk", exact: true }).first().click();
  await expect(page.getByText("Estimated load loss")).toBeVisible();
  await page.getByRole("button", { name: "Run Cascade", exact: true }).click();
  const lastStep = page.getByRole("button", { name: /Blackout 100\.0% loss/ });
  await expect(lastStep).toBeVisible();
  await lastStep.click();
  await page.evaluate(() => Object.assign((window as unknown as { networkProbe: object }).networkProbe, { loading: 0, mounts: 0 }));
  const initial = requests.length;
  const viewport = page.locator(".react-flow__viewport");
  const transform = await viewport.getAttribute("style");
  for (const type of ["bus", "generator", "load"]) {
    await page.locator(`.react-flow__node-${type}`).first().click();
    await expect(page.getByRole("tab", { name: "Component", exact: true })).toHaveAttribute("aria-selected", "true");
  }
  await page.locator('.react-flow__edge[data-id="line-101"]').click({ force: true });
  await page.getByRole("button", { name: "Clear selected component" }).click();
  await expect(page.locator(".react-flow__node.selected, .react-flow__edge.selected")).toHaveCount(0);
  await page.getByRole("tab", { name: "Prediction", exact: true }).click();
  await expect(page.getByText("Estimated load loss")).toBeVisible();
  await expect(lastStep).toBeVisible();
  expect(requests).toHaveLength(initial);
  expect(await viewport.getAttribute("style")).toBe(transform);
  await expectNoRemount(page);
});
