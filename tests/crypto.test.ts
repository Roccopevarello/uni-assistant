import { describe, expect, it } from "vitest";
import { decrypt, encrypt, randomToken } from "../supabase/functions/_shared/crypto.ts";

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i)));

describe("secret storage", () => {
  it("round-trips and never stores the plain value", async () => {
    const sealed = await encrypt("sk-ant-secret", KEY);
    expect(sealed.startsWith("v1:")).toBe(true);
    expect(sealed).not.toContain("sk-ant-secret");
    expect(await decrypt(sealed, KEY)).toBe("sk-ant-secret");
  });

  it("fails with the wrong key", async () => {
    const other = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
    await expect(decrypt(await encrypt("x", KEY), other)).rejects.toThrow();
  });

  it("rejects short keys", async () => {
    await expect(encrypt("x", btoa("short"))).rejects.toThrow(/32 bytes/);
  });

  it("makes URL-safe tokens", () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });
});
