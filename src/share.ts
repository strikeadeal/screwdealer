interface ShareCapabilities {
  share?: (data: ShareData) => Promise<void>;
  writeText?: (text: string) => Promise<void>;
}

function legacyCopy(text: string): void {
  const field = document.createElement("textarea");
  field.value = text;
  field.readOnly = true;
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("Clipboard is unavailable");
}

export async function shareRoomInvite(
  url: string,
  roomCode: string,
  capabilities: ShareCapabilities = {
    share: navigator.share?.bind(navigator),
    writeText: navigator.clipboard?.writeText.bind(navigator.clipboard),
  },
): Promise<"shared" | "copied"> {
  if (capabilities.share) {
    await capabilities.share({ title: "Screw the Dealer", text: `Join room ${roomCode}`, url });
    return "shared";
  }
  if (capabilities.writeText) await capabilities.writeText(url);
  else legacyCopy(url);
  return "copied";
}
