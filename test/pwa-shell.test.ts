import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("PWA app shell", () => {
  it("preloads the first dealt card artwork", () => {
    const html = readFileSync("index.html", "utf8");
    expect(html).toContain('<link rel="preload" as="image" href="%BASE_URL%assets/card-back.png" />');
  });
});
