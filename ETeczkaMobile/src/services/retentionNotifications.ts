import { Platform } from "react-native";
import type * as ExpoNotifications from "expo-notifications";
import type { MobileDocument } from "../types/navigation";
import type { RetentionUnit } from "../types/domain";

type NotificationsModule = typeof ExpoNotifications;

export type RetentionDocument = MobileDocument & {
  createdAt: string;
  retentionEnabled?: boolean;
  retentionValue?: number;
  retentionUnit?: RetentionUnit;
  isArchived?: boolean;
  isDeleted?: boolean;
};

export type RetentionReminder = {
  at: Date;
  label: string;
};

let configured = false;

function getNotifications(): NotificationsModule {
  // A debug app can be older than the JavaScript bundle. Load notifications
  // only while synchronizing so opening documents remains possible.
  return require("expo-notifications") as NotificationsModule;
}

export function isRetentionDocument(value: unknown): value is RetentionDocument {
  if (!value || typeof value !== "object") return false;
  const document = value as Partial<RetentionDocument>;
  return typeof document.id === "number"
    && typeof document.title === "string"
    && typeof document.filePath === "string"
    && typeof document.mimeType === "string"
    && typeof document.createdAt === "string";
}

export function retentionExpiresAt(document: RetentionDocument): Date | null {
  if (document.retentionEnabled === false) return null;
  const value = Number(document.retentionValue ?? 0);
  const expiry = new Date(document.createdAt);
  if (!Number.isFinite(value) || value <= 0 || Number.isNaN(expiry.getTime())) return null;

  if (document.retentionUnit === "years") expiry.setFullYear(expiry.getFullYear() + value);
  else if (document.retentionUnit === "months") expiry.setMonth(expiry.getMonth() + value);
  else if (document.retentionUnit === "days") expiry.setDate(expiry.getDate() + value);
  else if (document.retentionUnit === "minutes") expiry.setMinutes(expiry.getMinutes() + value);
  else return null;

  return expiry;
}

/** Reminders required by E‑Teczka: six monthly and fifteen daily warnings. */
export function retentionReminders(expiry: Date, now = new Date()): RetentionReminder[] {
  const reminders: RetentionReminder[] = [];
  for (let months = 6; months >= 1; months -= 1) {
    const at = new Date(expiry);
    at.setMonth(at.getMonth() - months);
    if (at > now) reminders.push({ at, label: `${months} ${months === 1 ? "miesiąc" : "mies."}` });
  }
  for (let days = 15; days >= 1; days -= 1) {
    const at = new Date(expiry);
    at.setDate(at.getDate() - days);
    if (at > now) reminders.push({ at, label: `${days} ${days === 1 ? "dzień" : "dni"}` });
  }
  return reminders.sort((left, right) => left.at.getTime() - right.at.getTime());
}

export async function scheduleRetentionNotifications(documents: RetentionDocument[]) {
  try {
    const Notifications = getNotifications();
    if (!configured) {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: false,
          shouldSetBadge: true,
        }),
      });
      configured = true;
    }

    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted && !(await Notifications.requestPermissionsAsync()).granted) return;
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("retention", {
        name: "Życie dokumentów",
        importance: Notifications.AndroidImportance.HIGH,
      });
    }

    await Notifications.cancelAllScheduledNotificationsAsync();
    const now = new Date();
    for (const document of documents) {
      const expiry = retentionExpiresAt(document);
      if (!expiry) continue;
      for (const reminder of retentionReminders(expiry, now)) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: "Termin życia dokumentu",
            body: `„${document.title}” — pozostało ${reminder.label}.`,
            data: { screen: "document", documentId: document.id },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: reminder.at,
            channelId: "retention",
          },
        });
      }
    }
  } catch {
    // The app remains available until a build with the notification module is installed.
  }
}
