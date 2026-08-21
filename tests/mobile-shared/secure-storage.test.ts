import { beforeEach, describe, expect, it, vi } from "vitest";

const storageState = vi.hoisted(() => ({
  secure: new Map<string, string>(),
}));

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "WHEN_UNLOCKED_THIS_DEVICE_ONLY",
  getItemAsync: vi.fn(async (key: string) => storageState.secure.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    storageState.secure.set(key, value);
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    storageState.secure.delete(key);
  }),
}));

import {
  AUTH_STORAGE_KEY,
  prepareAuthStorage,
  secureSessionStorage,
} from "../../apps/mobile/src/lib/auth/secure-storage";

describe("mobile secure session storage", () => {
  beforeEach(() => {
    storageState.secure.clear();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("round-trips and removes sessions larger than one Keychain value", async () => {
    const session = JSON.stringify({ access_token: "a".repeat(5_000), refresh_token: "refresh" });

    await secureSessionStorage.setItem(AUTH_STORAGE_KEY, session);

    await expect(secureSessionStorage.getItem(AUTH_STORAGE_KEY)).resolves.toBe(session);
    expect([...storageState.secure.keys()].filter((key) => !key.endsWith(".manifest"))).toHaveLength(3);

    await secureSessionStorage.removeItem(AUTH_STORAGE_KEY);
    await expect(secureSessionStorage.getItem(AUTH_STORAGE_KEY)).resolves.toBeNull();
    expect(storageState.secure.size).toBe(0);
  });

  it("cleans an incomplete chunk generation instead of returning partial credentials", async () => {
    await secureSessionStorage.setItem(AUTH_STORAGE_KEY, "s".repeat(3_000));
    const chunk = [...storageState.secure.keys()].find((key) => !key.endsWith(".manifest"));
    expect(chunk).toBeDefined();
    storageState.secure.delete(chunk!);

    await expect(secureSessionStorage.getItem(AUTH_STORAGE_KEY)).resolves.toBeNull();
    expect(storageState.secure.size).toBe(0);
  });

  it("clears surviving Keychain credentials on a fresh installation only", async () => {
    await secureSessionStorage.setItem(AUTH_STORAGE_KEY, "previous-install-session");

    await prepareAuthStorage();

    await expect(secureSessionStorage.getItem(AUTH_STORAGE_KEY)).resolves.toBeNull();
    expect(window.localStorage.length).toBe(1);

    await secureSessionStorage.setItem(AUTH_STORAGE_KEY, "current-install-session");
    await prepareAuthStorage();
    await expect(secureSessionStorage.getItem(AUTH_STORAGE_KEY)).resolves.toBe(
      "current-install-session",
    );
  });
});
