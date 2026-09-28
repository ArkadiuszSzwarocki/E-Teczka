import * as SecureStore from "expo-secure-store";

const AUTO_LOCK_MINUTES = "eteczka.auto-lock-minutes";

export async function getAutoLockMinutes() {
  const saved = Number(await SecureStore.getItemAsync(AUTO_LOCK_MINUTES));
  return [1, 5, 15].includes(saved) ? saved : 1;
}

export async function setAutoLockMinutes(minutes: number) {
  if (![1, 5, 15].includes(minutes)) throw new Error("Nieprawidłowy czas blokady.");
  await SecureStore.setItemAsync(AUTO_LOCK_MINUTES, String(minutes));
}
