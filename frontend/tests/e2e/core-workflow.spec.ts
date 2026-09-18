import { expect, test } from "@playwright/test";

test("core cascade, replay, mitigation, and reset workflow", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("API connected")).toBeVisible();
  await expect(page.getByText("Healthy", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("400.0 MW", { exact: true }).first()).toBeVisible();

  await page.getByRole("combobox", { name: "Preset" }).selectOption({
    label: "Mitigation Example",
  });
  await expect(page.locator(".header-scenario")).toContainText("Mitigation Example");
  await expect(page.getByText("500.0 MW", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Stressed", { exact: true }).first()).toBeVisible();

  await page.getByText("Operating conditions", { exact: true }).click();
  await page.getByRole("combobox", { name: "Load multiplier" }).selectOption("1.5");
  await expect(page.locator(".header-scenario")).toContainText("Custom Scenario");
  await page.getByRole("combobox", { name: "Preset" }).selectOption({ label: "Mitigation Example" });
  await expect(page.locator(".header-scenario")).toContainText("Mitigation Example");

  await page.getByRole("button", { name: "Predict Risk" }).click();
  await expect(page.getByRole("heading", { name: "Risk prediction" })).toBeVisible();
  await expect(page.getByText("Estimated load loss")).toBeVisible();
  await expect(page.getByText("High", { exact: true })).toBeVisible();

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

  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.getByText("Healthy", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("None selected")).toBeVisible();
  await expect(page.getByText("400.0 MW", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cascade timeline" })).toHaveCount(0);
});

test("component inspection is local and keeps the React Flow viewport stable", async ({ page }) => {
  let gridRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/grid") gridRequests += 1;
  });
  await page.goto("/");
  await expect(page.getByText("API connected")).toBeVisible();
  await expect(page.locator(".grid-node").first()).toBeVisible();
  const initialGridRequests = gridRequests;
  const viewport = page.locator(".react-flow__viewport");
  const transformBefore = await viewport.getAttribute("style");
  const nodes = page.locator(".react-flow__node");
  const count = await nodes.count();
  for (let index = 0; index < 10; index += 1) {
    await nodes.nth(index % count).click();
  }
  await expect(page.getByRole("tabpanel").getByRole("heading")).not.toHaveText("No component selected");
  await expect(page.getByText("Loading network")).toHaveCount(0);
  expect(gridRequests).toBe(initialGridRequests);
  expect(await viewport.getAttribute("style")).toBe(transformBefore);
});

test("grid layout can be unlocked, persisted, and reset without network refetches", async ({ page }) => {
  let gridRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/grid") gridRequests += 1;
  });
  await page.goto("/");
  await expect(page.getByText("API connected")).toBeVisible();
  const node = page.locator(".react-flow__node").first();
  await expect(node).toBeVisible();
  const initialTransform = await node.evaluate((element) => (element as HTMLElement).style.transform);
  const initialGridRequests = gridRequests;

  const dragBy = async (x: number, y: number) => {
    const box = await node.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 + x, box!.y + box!.height / 2 + y, { steps: 6 });
    await page.mouse.up();
  };

  await expect(page.getByRole("button", { name: "Locked" })).toHaveAttribute("aria-pressed", "true");
  await dragBy(90, 60);
  await expect(node).toHaveAttribute("style", new RegExp(initialTransform.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  await page.getByRole("button", { name: "Locked" }).click();
  await expect(page.getByRole("button", { name: "Unlocked" })).toHaveAttribute("aria-pressed", "false");
  await dragBy(90, 60);
  const customTransform = await node.evaluate((element) => (element as HTMLElement).style.transform);
  expect(customTransform).not.toBe(initialTransform);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("tripwire:grid-layout:v1"))).not.toBeNull();

  await page.reload();
  await expect(page.getByText("API connected")).toBeVisible();
  const restoredNode = page.locator(".react-flow__node").first();
  await expect(restoredNode).toBeVisible();
  await expect.poll(() => restoredNode.evaluate((element) => (element as HTMLElement).style.transform)).toBe(customTransform);

  await page.getByRole("combobox", { name: "Preset" }).selectOption({ label: "Mitigation Example" });
  await page.getByRole("button", { name: "Run Cascade" }).click();
  await expect(page.getByRole("button", { name: /Blackout 100\.0% loss/ })).toBeVisible();
  await expect.poll(() => restoredNode.evaluate((element) => (element as HTMLElement).style.transform)).toBe(customTransform);

  const requestsBeforeLayoutActions = gridRequests;
  await page.getByRole("button", { name: "Auto Layout" }).click();
  await page.getByRole("button", { name: "Fit View" }).click();
  await page.getByRole("button", { name: "Reset Layout" }).click();
  expect(gridRequests).toBe(requestsBeforeLayoutActions);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("tripwire:grid-layout:v1"))).toBeNull();
  await expect.poll(() => restoredNode.evaluate((element) => (element as HTMLElement).style.transform)).toBe(initialTransform);
  expect(gridRequests).toBeGreaterThanOrEqual(initialGridRequests);
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
    await expect(page.getByRole("button", { name: "Reset", exact: true })).toBeVisible();
    await expect(page.locator(".grid-node").first()).toBeVisible();

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
        nodeOverlaps: overlappingPairs(document.querySelectorAll<HTMLElement>(".react-flow__node")),
        labelNodeOverlaps: overlappingSets(
          document.querySelectorAll<HTMLElement>(".edge-label"),
          document.querySelectorAll<HTMLElement>(".react-flow__node"),
        ),
      };

      function overlappingPairs(elements: NodeListOf<HTMLElement>) {
        const boxes = [...elements].map((element) => element.getBoundingClientRect());
        let overlaps = 0;
        boxes.forEach((box, index) => boxes.slice(index + 1).forEach((other) => {
          if (intersects(box, other)) overlaps += 1;
        }));
        return overlaps;
      }

      function overlappingSets(first: NodeListOf<HTMLElement>, second: NodeListOf<HTMLElement>) {
        return [...first].reduce((overlaps, element) => overlaps + [...second]
          .filter((other) => intersects(element.getBoundingClientRect(), other.getBoundingClientRect())).length, 0);
      }

      function intersects(a: DOMRect, b: DOMRect) {
        return a.left < b.right - 2 && a.right > b.left + 2 && a.top < b.bottom - 2 && a.bottom > b.top + 2;
      }
    });
    expect(layout.hasHorizontalOverflow).toBe(false);
    expect(layout.cardRadius).toBe("24px");
    expect(layout.buttonRadius).toBe("18px");
    expect(layout.nodeRadius).toBe("10px");
    expect([null, "11px"]).toContain(layout.edgeFontSize);
    expect(layout.nodeOverlaps).toBe(0);
    expect(layout.labelNodeOverlaps).toBe(0);

    const preset = page.getByRole("combobox", { name: "Preset" });
    await preset.focus();
    await expect(preset).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath(`${viewport.width}x${viewport.height}.png`), fullPage: true });
  });
}
