import { describe, expect, it, vi } from "vitest";
import { shareRoomInvite } from "./share";

describe("room invitation sharing", () => {
  it("uses the native share sheet when available", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    await expect(shareRoomInvite("https://example.test/?room=NIGHT7", "NIGHT7", { share })).resolves.toBe("shared");
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: "https://example.test/?room=NIGHT7" }));
  });

  it("falls back to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    await expect(shareRoomInvite("https://example.test/?room=NIGHT7", "NIGHT7", { writeText })).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledWith("https://example.test/?room=NIGHT7");
  });
});
