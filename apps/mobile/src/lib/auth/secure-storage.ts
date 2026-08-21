import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export const AUTH_STORAGE_KEY = "idobata.auth.session.v1";

const INSTALL_MARKER_KEY = "idobata.installation.v1";
const MAX_CHUNK_LENGTH = 1_800;
const secureStoreOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

type Manifest = {
  generation: string;
  chunks: number;
};

function manifestKey(key: string) {
  return `${key}.manifest`;
}

function chunkKey(key: string, generation: string, index: number) {
  return `${key}.${generation}.${index}`;
}

function parseManifest(value: string | null): Manifest | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<Manifest>;
    if (
      typeof parsed.generation !== "string" ||
      typeof parsed.chunks !== "number" ||
      !Number.isInteger(parsed.chunks) ||
      parsed.chunks < 1 ||
      parsed.chunks > 64
    ) {
      return null;
    }
    return { generation: parsed.generation, chunks: parsed.chunks };
  } catch {
    return null;
  }
}

async function deleteGeneration(key: string, manifest: Manifest | null) {
  if (!manifest) return;
  await Promise.all(
    Array.from({ length: manifest.chunks }, (_, index) =>
      SecureStore.deleteItemAsync(chunkKey(key, manifest.generation, index), secureStoreOptions),
    ),
  );
}

function webStorage() {
  return typeof localStorage === "undefined" ? null : localStorage;
}

export const secureSessionStorage = {
  async getItem(key: string) {
    if (Platform.OS === "web") return webStorage()?.getItem(key) ?? null;

    const rawManifest = await SecureStore.getItemAsync(manifestKey(key), secureStoreOptions);
    const manifest = parseManifest(rawManifest);
    if (!manifest) {
      if (rawManifest) await SecureStore.deleteItemAsync(manifestKey(key), secureStoreOptions);
      return null;
    }

    const chunks = await Promise.all(
      Array.from({ length: manifest.chunks }, (_, index) =>
        SecureStore.getItemAsync(chunkKey(key, manifest.generation, index), secureStoreOptions),
      ),
    );
    if (chunks.some((chunk) => chunk === null)) {
      await secureSessionStorage.removeItem(key);
      return null;
    }
    return chunks.join("");
  },

  async setItem(key: string, value: string) {
    if (Platform.OS === "web") {
      webStorage()?.setItem(key, value);
      return;
    }

    const previous = parseManifest(
      await SecureStore.getItemAsync(manifestKey(key), secureStoreOptions),
    );
    const generation = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    const chunks = value.match(new RegExp(`.{1,${MAX_CHUNK_LENGTH}}`, "gs")) ?? [""];
    const nextManifest = { generation, chunks: chunks.length };

    try {
      await Promise.all(
        chunks.map((chunk, index) =>
          SecureStore.setItemAsync(chunkKey(key, generation, index), chunk, secureStoreOptions),
        ),
      );
      await SecureStore.setItemAsync(
        manifestKey(key),
        JSON.stringify(nextManifest),
        secureStoreOptions,
      );
    } catch (error) {
      await deleteGeneration(key, nextManifest);
      throw error;
    }

    await deleteGeneration(key, previous);
  },

  async removeItem(key: string) {
    if (Platform.OS === "web") {
      webStorage()?.removeItem(key);
      return;
    }

    const manifest = parseManifest(
      await SecureStore.getItemAsync(manifestKey(key), secureStoreOptions),
    );
    await SecureStore.deleteItemAsync(manifestKey(key), secureStoreOptions);
    await deleteGeneration(key, manifest);
  },
};

export async function prepareAuthStorage() {
  if (Platform.OS === "web") return;

  const installationMarker = await AsyncStorage.getItem(INSTALL_MARKER_KEY);
  if (installationMarker) return;

  // iOS Keychain can survive uninstall while app-local storage does not. A new
  // installation must never silently inherit the previous installation's user.
  await secureSessionStorage.removeItem(AUTH_STORAGE_KEY);
  await AsyncStorage.setItem(INSTALL_MARKER_KEY, new Date().toISOString());
}
