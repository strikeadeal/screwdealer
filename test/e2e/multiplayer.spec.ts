import { expect, test, type Page } from "@playwright/test";

async function pageWithButton(pages: Page[], name: RegExp): Promise<Page> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    for (const page of pages) {
      if (await page.getByRole("button", { name }).isVisible()) return page;
    }
    await pages[0].waitForTimeout(100);
  }
  throw new Error(`No player saw button ${name}`);
}

async function firstGuessWasMiss(dealer: Page, guesser: Page): Promise<boolean> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await dealer.getByRole("button", { name: "Deal next card" }).isVisible()) return false;
    if (await guesser.locator(".hint-copy").isVisible()) return true;
    await guesser.waitForTimeout(100);
  }
  throw new Error("The first guess did not resolve");
}

test("two iPhones can create, join, play a round, and recover a session", async ({ browser, baseURL }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  await host.goto(baseURL!);
  if (process.env.PLAYWRIGHT_BASE_URL) {
    const manifestHref = await host.locator('link[rel="manifest"]').getAttribute("href");
    expect(new URL(manifestHref!, host.url()).pathname).toBe("/screwdealer/manifest.webmanifest");
    const manifestResponse = await hostContext.request.get(new URL(manifestHref!, host.url()).toString());
    expect(manifestResponse.ok()).toBe(true);
    await expect(manifestResponse.json()).resolves.toMatchObject({
      scope: "/screwdealer/",
      start_url: "/screwdealer/",
      display: "standalone",
    });
    const serviceWorkerScope = await host.evaluate(async () => {
      const registration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Service worker timeout")), 10_000)),
      ]);
      return registration.scope;
    });
    expect(new URL(serviceWorkerScope).pathname).toBe("/screwdealer/");
  }
  await host.getByLabel("Your name").fill("Ava");
  await host.getByRole("button", { name: "Create a game" }).click();
  await expect(host.getByText("Players", { exact: true })).toBeVisible();
  const roomCode = (await host.locator(".lobby-header h1").textContent())!.trim();
  expect(roomCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);

  await guest.goto(`${baseURL}?room=${roomCode}`);
  await guest.getByLabel("Your name").fill("Ben");
  await guest.getByRole("button", { name: "Join game" }).click();
  await expect(host.getByText("Ben", { exact: true })).toBeVisible();
  await expect(guest.getByText("Ava", { exact: true })).toBeVisible();

  await host.getByRole("button", { name: "Start game" }).click();
  const players = [host, guest];
  const dealer = await pageWithButton(players, /Deal the card/);
  await dealer.getByRole("button", { name: "Deal the card" }).click();
  const guesser = await pageWithButton(players, /Lock in/);
  if (process.env.VISUAL_QA_PATH) await guesser.screenshot({ path: process.env.VISUAL_QA_PATH });
  await guesser.getByRole("button", { name: "Choose 7" }).click();
  await guesser.getByRole("button", { name: "Lock in 7" }).click();

  const firstGuessMissed = await firstGuessWasMiss(dealer, guesser);
  if (firstGuessMissed) {
    await guesser.locator(".rank-picker button:not([disabled])").first().click();
    await guesser.getByRole("button", { name: /Lock in/ }).click();
  }

  await expect(dealer.getByRole("button", { name: "Deal next card" })).toBeVisible();
  await expect(host.locator(".card-rail .face-card")).toHaveCount(1);
  await expect(guest.locator(".card-rail .face-card")).toHaveCount(1);

  await guest.reload();
  await expect(guest.locator(".room-code-button strong")).toHaveText(roomCode);
  await expect(guest.getByText("Connected", { exact: true })).toBeVisible();

  await guestContext.setOffline(true);
  await expect(guest.locator(".connection-ribbon")).toHaveText("Offline");
  await guestContext.setOffline(false);
  await expect(guest.getByText("Connected", { exact: true })).toBeVisible();
  await expect(guest.locator(".connection-ribbon")).toHaveCount(0);

  await hostContext.close();
  await guestContext.close();
});
