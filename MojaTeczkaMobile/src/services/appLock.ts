import { profileKey, profileOperation } from './mobileProfile';
import * as SecureStore from "expo-secure-store";

const AUTO_LOCK_MINUTES = "mojateczka.auto-lock-minutes";

async function getAutoLockMinutesImpl() {
  const saved = Number(await SecureStore.getItemAsync(profileKey(AUTO_LOCK_MINUTES)));
  return [1, 5, 15].includes(saved) ? saved : 1;
}

async function setAutoLockMinutesImpl(minutes: number) {
  if (![1, 5, 15].includes(minutes)) throw new Error("Nieprawidłowy czas blokady.");
  await SecureStore.setItemAsync(profileKey(AUTO_LOCK_MINUTES), String(minutes));
}

export const getAutoLockMinutes = profileOperation(getAutoLockMinutesImpl);
export const setAutoLockMinutes = profileOperation(setAutoLockMinutesImpl);
