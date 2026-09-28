import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, StatusBar, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { NavigationContainer, createNavigationContainerRef } from "@react-navigation/native";
import { createBottomTabNavigator, type BottomTabBarButtonProps } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { NavigationBar } from "expo-navigation-bar";

import HomeScreen from "./src/screens/HomeScreen";
import FolderScreen from "./src/screens/FolderScreen";
import ScannerScreen from "./src/screens/ScannerScreen";
import SyncScreen from "./src/screens/SyncScreen";
import DocumentListScreen from "./src/screens/DocumentListScreen";
import DocumentViewerScreen from "./src/screens/DocumentViewerScreen";
import VaultLockScreen from "./src/screens/VaultLockScreen";
import { hasVault, vaultMode } from "./src/services/offlineVault";
import { getApiUrl, getAuthHeaders, getLocalConnection } from "./src/services/localConnection";
import { getAutoLockMinutes } from "./src/services/appLock";
import type { FolderStackParamList, MainTabParamList, MobileDocument, RootStackParamList } from "./src/types/navigation";

const Tab = createBottomTabNavigator<MainTabParamList>();
const ArchiveStack = createNativeStackNavigator<FolderStackParamList>();
const RootStack = createNativeStackNavigator<RootStackParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();

function isMobileDocument(value: unknown): value is MobileDocument {
  if (!value || typeof value !== "object") return false;
  const document = value as Partial<MobileDocument>;
  return typeof document.id === "number"
    && typeof document.title === "string"
    && typeof document.filePath === "string"
    && typeof document.mimeType === "string";
}

// Stos dla zakładki "Kartoteki" (pozwala wchodzić w głąb folderów)
function ArchiveStackScreen() {
  return (
    <ArchiveStack.Navigator screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
      <ArchiveStack.Screen name="HomeList" component={HomeScreen} />
      <ArchiveStack.Screen name="FolderDetails" component={FolderScreen} />
    </ArchiveStack.Navigator>
  );
}

function AppTabs({ initialTab = "Ustawienia", onLock }: { initialTab?: keyof MainTabParamList; onLock: () => void }) {
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, 16);
  const [isPaired, setIsPaired] = useState(false);

  useEffect(() => {
    getLocalConnection().then((connection) => setIsPaired(Boolean(connection)));
  }, []);

  return (
    <Tab.Navigator
      initialRouteName={initialTab}
      screenOptions={({ route }) => {
        const isLocked = !isPaired && route.name !== "Ustawienia";
        return ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: "#1e293b",
          borderTopColor: "#334155",
          height: 60 + bottomInset,
          paddingBottom: bottomInset,
          paddingTop: 8,
        },
        tabBarActiveTintColor: "#3b82f6",
        tabBarInactiveTintColor: isLocked ? "#475569" : "#64748b",
        tabBarButton: isLocked ? ({ style, accessibilityLabel, accessibilityRole, testID }: BottomTabBarButtonProps) => (
          <TouchableOpacity
            accessibilityLabel={accessibilityLabel}
            accessibilityRole={accessibilityRole}
            testID={testID}
            accessibilityState={{ disabled: true }}
            onPress={() => Alert.alert("Najpierw połącz komputer", "Otwórz Ustawienia i wpisz adres IP oraz kod z E‑Teczki na komputerze.")}
            style={[style, { opacity: 0.45 }]}
          />
        ) : undefined,
        tabBarIcon: ({ focused, color, size }) => {
          let iconName: keyof typeof Ionicons.glyphMap = "folder";
          if (route.name === "Kartoteki") iconName = focused ? "folder-open" : "folder";
          else if (route.name === "Skaner") iconName = focused ? "camera" : "camera-outline";
          else if (route.name === "Archiwum") iconName = focused ? "archive" : "archive-outline";
          else if (route.name === "Kosz") iconName = focused ? "trash" : "trash-outline";
          else if (route.name === "Ustawienia") iconName = focused ? "settings" : "settings-outline";
          return <Ionicons name={iconName} size={size + 2} color={color} />;
        },
        });
      }}
    >
      <Tab.Screen name="Kartoteki" component={ArchiveStackScreen} />
      <Tab.Screen name="Skaner" component={ScannerScreen} />
      <Tab.Screen name="Archiwum">{() => <DocumentListScreen mode="archive" />}</Tab.Screen>
      <Tab.Screen name="Kosz">{() => <DocumentListScreen mode="trash" />}</Tab.Screen>
      <Tab.Screen name="Ustawienia">
        {(props) => <SyncScreen {...props} onPaired={() => setIsPaired(true)} onLock={onLock} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

export default function App() {
  const [vaultChecked, setVaultChecked] = useState(false); const [vaultUnlocked, setVaultUnlocked] = useState(false); const [initialTab, setInitialTab] = useState<keyof MainTabParamList>("Ustawienia");
  const [vaultInitializationError, setVaultInitializationError] = useState<string | null>(null);
  const [navigationReady, setNavigationReady] = useState(false);
  const [pendingNotificationDocumentId, setPendingNotificationDocumentId] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;
    let responseSubscription: { remove: () => void } | undefined;

    const extractDocumentId = (response: any): number | null => {
      const raw = response?.notification?.request?.content?.data?.documentId;
      const id = Number(raw);
      return Number.isInteger(id) && id > 0 ? id : null;
    };

    try {
      const Notifications = require("expo-notifications");
      responseSubscription = Notifications.addNotificationResponseReceivedListener((response: any) => {
        const documentId = extractDocumentId(response);
        if (mounted && documentId !== null) setPendingNotificationDocumentId(documentId);
      });
      const lastResponsePromise = Notifications.getLastNotificationResponseAsync?.();
      if (lastResponsePromise) {
        void lastResponsePromise.then((response: any) => {
          const documentId = extractDocumentId(response);
          if (mounted && documentId !== null) setPendingNotificationDocumentId(documentId);
        });
      }
    } catch {
      // Old development clients may not contain expo-notifications.
    }

    return () => {
      mounted = false;
      responseSubscription?.remove();
    };
  }, []);
  const backgroundAt = useRef<number | null>(null);
  const openNotificationDocument = useCallback(async (documentId: number) => {
    try {
      const result = await fetch(await getApiUrl(`/api/documents/${documentId}`), { headers: await getAuthHeaders() });
      const document: unknown = await result.json();
      if (result.ok && isMobileDocument(document) && navigationRef.isReady()) {
        navigationRef.navigate("DocumentViewer", { document });
      }
    } catch {
      // The notification remains visible even when the computer is offline.
    }
  }, []);
  useEffect(() => {
    NavigationBar.setHidden(true);
  }, []);
  const checkVault = useCallback(() => {
    let mounted = true;
    setVaultInitializationError(null);
    void (async () => {
      try {
        const active = await hasVault();
        const mode = active ? await vaultMode() : null;
        if (!mounted) return;
        setInitialTab(mode === "biometric" ? "Kartoteki" : "Ustawienia");
        setVaultUnlocked(!active);
      } catch {
        if (!mounted) return;
        setVaultInitializationError("Nie można odczytać lokalnego sejfu. Spróbuj ponownie uruchomić aplikację.");
      } finally {
        if (mounted) setVaultChecked(true);
      }
    })();
    return () => { mounted = false; };
  }, []);
  useEffect(() => checkVault(), [checkVault]);
  useEffect(() => { const subscription = AppState.addEventListener("change", (state) => { if (state !== "active") { backgroundAt.current = Date.now(); return; } const returnedAt = backgroundAt.current; backgroundAt.current = null; if (returnedAt) getAutoLockMinutes().then((minutes) => { if (Date.now() - returnedAt >= minutes * 60_000) setVaultUnlocked(false); }); }); return () => subscription.remove(); }, []);
  // Notification listeners are registered only by a native build that includes
  // expo-notifications. An older development client must still be able to boot.
  useEffect(() => {
    if (!vaultChecked || !vaultUnlocked || !navigationReady || pendingNotificationDocumentId === null) return;
    const documentId = pendingNotificationDocumentId;
    setPendingNotificationDocumentId(null);
    void openNotificationDocument(documentId);
  }, [navigationReady, openNotificationDocument, pendingNotificationDocumentId, vaultChecked, vaultUnlocked]);
  if (!vaultChecked) return <View style={startupStyles.container}><Text style={startupStyles.text}>Uruchamianie E‑Teczki…</Text></View>;
  if (vaultInitializationError) return <View style={startupStyles.container}><Text style={startupStyles.title}>Nie udało się uruchomić sejfu</Text><Text style={startupStyles.text}>{vaultInitializationError}</Text><TouchableOpacity style={startupStyles.button} onPress={() => { setVaultChecked(false); checkVault(); }}><Text style={startupStyles.buttonText}>Spróbuj ponownie</Text></TouchableOpacity></View>;
  if (!vaultUnlocked) return <SafeAreaProvider><StatusBar hidden /><VaultLockScreen onUnlock={() => setVaultUnlocked(true)} /></SafeAreaProvider>;
  return (
    <SafeAreaProvider>
      <NavigationContainer ref={navigationRef} onReady={() => setNavigationReady(true)}>
        <StatusBar hidden />
        <RootStack.Navigator screenOptions={{ headerShown: false }}>
          <RootStack.Screen name="MainTabs">{() => <AppTabs initialTab={initialTab} onLock={() => setVaultUnlocked(false)} />}</RootStack.Screen>
          <RootStack.Screen name="DocumentViewer" component={DocumentViewerScreen} options={{ animation: "slide_from_right" }} />
        </RootStack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const startupStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a", alignItems: "center", justifyContent: "center", padding: 28, gap: 16 },
  title: { color: "white", fontSize: 22, fontWeight: "700", textAlign: "center" },
  text: { color: "#cbd5e1", fontSize: 15, textAlign: "center" },
  button: { backgroundColor: "#2563eb", borderRadius: 10, paddingHorizontal: 22, paddingVertical: 13 },
  buttonText: { color: "white", fontSize: 15, fontWeight: "700" },
});
