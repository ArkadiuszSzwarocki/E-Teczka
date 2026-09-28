import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Platform, StatusBar, TextInput, Alert, ActivityIndicator, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import axios from "axios";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { getApiUrl, getAuthHeaders, getLocalConnection, pairLocalComputer } from "../services/localConnection";
import { changeVaultAccess, createVault, hasVault, syncOfflineVault, unlockWithPin, vaultMode as readVaultMode, SecretMode, VaultMode } from "../services/offlineVault";
import * as LocalAuthentication from "expo-local-authentication";
import { isRetentionDocument, retentionExpiresAt, scheduleRetentionNotifications, type RetentionDocument } from "../services/retentionNotifications";
import { getAutoLockMinutes, setAutoLockMinutes } from "../services/appLock";
import type { MainTabParamList } from "../types/navigation";
import { errorMessage } from "../utils/errors";
import ConnectionSettingsCard from "../components/ConnectionSettingsCard";
import RetentionAlertsCard, { type RetentionAlert } from "../components/RetentionAlertsCard";

type SyncScreenProps = BottomTabScreenProps<MainTabParamList, "Ustawienia"> & {
  onPaired: () => void;
  onLock: () => void;
};

function lifeAlert(document: RetentionDocument): RetentionAlert | null {
  if (!document.retentionEnabled || document.isDeleted || document.isArchived) return null;
  const expiry = retentionExpiresAt(document);
  if (!expiry) return null;
  const minutes = Math.ceil((expiry.getTime() - Date.now()) / 60_000);
  if (minutes <= 0) return null;
  if (minutes <= 24 * 60) return { id: document.id, title: document.title, text: `kończy się za ${minutes} min.`, level: "urgent" };
  const days = Math.ceil(minutes / (24 * 60));
  if (days <= 15) return { id: document.id, title: document.title, text: `kończy się za ${days} dni`, level: "urgent" };
  if (days <= 183) return { id: document.id, title: document.title, text: `kończy się za około ${Math.ceil(days / 30)} mies.`, level: "soon" };
  return null;
}

export default function SyncScreen({ navigation, onPaired, onLock }: SyncScreenProps) {
  const [status, setStatus] = useState("Sprawdzanie...");
  const [statusColor, setStatusColor] = useState("#eab308");
  const [serverUrl, setServerUrl] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [isPairing, setIsPairing] = useState(false);
  const [vaultPin, setVaultPin] = useState(""); const [vaultMode, setVaultMode] = useState<VaultMode>("pin"); const [savedVaultMode, setSavedVaultMode] = useState<VaultMode>("pin"); const [backupMode, setBackupMode] = useState<SecretMode>("pin"); const [backupSecret, setBackupSecret] = useState(""); const [currentSecret, setCurrentSecret] = useState(""); const [vaultReady, setVaultReady] = useState(false); const [vaultProgress, setVaultProgress] = useState(""); const [vaultSyncing, setVaultSyncing] = useState(false); const [changingAccess, setChangingAccess] = useState(false);
  const [lifeAlerts, setLifeAlerts] = useState<RetentionAlert[]>([]); const [alertsLoading, setAlertsLoading] = useState(false);
  const [section, setSection] = useState<"connection" | "alerts" | "security">("connection");
  const [autoLockMinutes, setAutoLockMinutesState] = useState(1);

  const loadLifeAlerts = async () => {
    try {
      setAlertsLoading(true);
      const response = await fetch(await getApiUrl("/api/documents"), { headers: await getAuthHeaders() });
      if (!response.ok) throw new Error("Brak dokumentów");
      const payload: unknown = await response.json();
      const alerts = (Array.isArray(payload) ? payload : []).filter(isRetentionDocument).map(lifeAlert).filter((alert): alert is RetentionAlert => alert !== null);
      setLifeAlerts(alerts.sort((a, b) => a.level === b.level ? a.id - b.id : a.level === "urgent" ? -1 : 1));
    } catch { setLifeAlerts([]); } finally { setAlertsLoading(false); }
  };

  const testConnection = async (url?: string) => {
    setStatus("Łączenie z PC...");
    setStatusColor("#eab308");
    try {
      const connection = await getLocalConnection();
      const targetUrl = url || connection?.serverUrl;
      if (!targetUrl) throw new Error("Brak komputera");
      const response = await axios.get(`${targetUrl}/api/folders`, { timeout: 3000, headers: await getAuthHeaders() });
      if (response.status === 200) {
        setStatus("Połączono (Online)");
        setStatusColor("#22c55e");
        void loadLifeAlerts();
      }
    } catch (error) {
      setStatus("Brak połączenia (Offline)");
      setStatusColor("#ef4444");
    }
  };

  useEffect(() => {
    hasVault().then(async (active) => { setVaultReady(active); if (active) { const mode = await readVaultMode(); setVaultMode(mode); setSavedVaultMode(mode); } });
    getAutoLockMinutes().then(setAutoLockMinutesState);
    getLocalConnection().then((connection) => {
      if (connection) {
        setServerUrl(connection.serverUrl);
        testConnection(connection.serverUrl);
      } else {
        setStatus("Dodaj komputer lokalny");
        setStatusColor("#94a3b8");
      }
    });
  }, []);

  const chooseAutoLock = async (minutes: number) => { await setAutoLockMinutes(minutes); setAutoLockMinutesState(minutes); };

  const refreshRetentionNotifications = async () => {
    const response = await fetch(await getApiUrl("/api/documents"), { headers: await getAuthHeaders() });
    if (!response.ok) return;
    const payload: unknown = await response.json();
    await scheduleRetentionNotifications((Array.isArray(payload) ? payload : []).filter(isRetentionDocument).filter((document) => !document.isDeleted && !document.isArchived));
    await loadLifeAlerts();
  };
  const enableVault = async () => { try { setIsPairing(true); if (vaultMode === "biometric" && (!(await LocalAuthentication.hasHardwareAsync()) || !(await LocalAuthentication.isEnrolledAsync()))) throw new Error("Najpierw ustaw odcisk palca lub twarz w ustawieniach telefonu."); await createVault(vaultPin, vaultMode, vaultMode === "biometric" ? { mode: backupMode, secret: backupSecret } : undefined); setVaultReady(true); setSavedVaultMode(vaultMode); setVaultPin(""); setBackupSecret(""); setVaultProgress("Sejf gotowy. Teraz synchronizuję dokumenty…"); const count = await syncOfflineVault((done, total) => setVaultProgress(`Szyfrowanie: ${done}/${total}`)); await refreshRetentionNotifications(); setVaultProgress(`Gotowe: ${count} dokumentów dostępnych offline.`); } catch (error: unknown) { Alert.alert("Nie udało się utworzyć sejfu", errorMessage(error)); } finally { setIsPairing(false); } };
  const refreshVault = async () => { try { setVaultSyncing(true); const count = await syncOfflineVault((done, total) => setVaultProgress(`Synchronizacja: ${done}/${total}`)); await refreshRetentionNotifications(); setVaultProgress(`Gotowe: ${count} dokumentów dostępnych offline.`); } catch { Alert.alert("Brak połączenia", "Aby odświeżyć sejf, połącz telefon z komputerem."); } finally { setVaultSyncing(false); } };
  const saveAccessChange = async () => { try { if (savedVaultMode === "biometric") { const result = await LocalAuthentication.authenticateAsync({ promptMessage: "Potwierdź zmianę zabezpieczenia E‑Teczka", biometricsSecurityLevel: "strong", disableDeviceFallback: true }); if (!result.success) throw new Error("Nie potwierdzono biometrii."); } else if (!(await unlockWithPin(currentSecret))) throw new Error("Nieprawidłowy obecny PIN lub hasło."); if (vaultMode === "biometric" && (!(await LocalAuthentication.hasHardwareAsync()) || !(await LocalAuthentication.isEnrolledAsync()))) throw new Error("Najpierw ustaw biometrię w telefonie."); await changeVaultAccess(vaultPin, vaultMode, vaultMode === "biometric" ? { mode: backupMode, secret: backupSecret } : undefined); setSavedVaultMode(vaultMode); setVaultPin(""); setBackupSecret(""); setCurrentSecret(""); setChangingAccess(false); Alert.alert("Metoda zmieniona", `Aplikacja będzie otwierana przez: ${vaultMode === "pin" ? "PIN" : vaultMode === "password" ? "hasło" : "biometrię z PIN-em lub hasłem awaryjnym"}.`); } catch (error: unknown) { Alert.alert("Nie udało się zmienić metody", errorMessage(error)); } };

  const pairComputer = async () => {
    try {
      setIsPairing(true);
      const connection = await pairLocalComputer(serverUrl, pairingCode, "Telefon użytkownika");
      setServerUrl(connection.serverUrl);
      setPairingCode("");
      setStatus("Połączono (Online)");
      setStatusColor("#22c55e");
      await loadLifeAlerts();
      onPaired?.();
      navigation.navigate("Kartoteki");
    } catch (error: unknown) {
      Alert.alert("Nie udało się połączyć", `${errorMessage(error)}\n\nSprawdź adres IP, kod z aplikacji desktopowej oraz to, czy telefon i komputer są w tej samej sieci.`);
    } finally {
      setIsPairing(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Ustawienia</Text>
      <Text style={styles.intro}>Połączenie, powiadomienia i bezpieczeństwo są w osobnych modułach.</Text>
      <View style={styles.sectionTabs}><TouchableOpacity onPress={() => setSection("connection")} style={[styles.sectionTab, section === "connection" && styles.sectionTabActive]}><Ionicons name="desktop-outline" size={18} color="white" /><Text style={styles.sectionTabText}>Połączenie</Text></TouchableOpacity><TouchableOpacity onPress={() => setSection("alerts")} style={[styles.sectionTab, section === "alerts" && styles.sectionTabActive]}><Ionicons name="notifications-outline" size={18} color="white" /><Text style={styles.sectionTabText}>Terminy</Text></TouchableOpacity><TouchableOpacity onPress={() => setSection("security")} style={[styles.sectionTab, section === "security" && styles.sectionTabActive]}><Ionicons name="shield-checkmark-outline" size={18} color="white" /><Text style={styles.sectionTabText}>Bezpieczeństwo</Text></TouchableOpacity></View>
      
      {section === "connection" && <ConnectionSettingsCard status={status} statusColor={statusColor} serverUrl={serverUrl} pairingCode={pairingCode} isPairing={isPairing} onServerUrlChange={setServerUrl} onPairingCodeChange={setPairingCode} onPair={() => void pairComputer()} onRefresh={() => void testConnection()} />}
      {section === "alerts" && <RetentionAlertsCard alerts={lifeAlerts} loading={alertsLoading} onRefresh={() => void loadLifeAlerts()} />}
      {section === "security" && <View style={styles.vaultCard}>
        <Ionicons name="lock-closed" size={22} color="#60a5fa" />
        <View style={{ flex: 1 }}><Text style={styles.vaultTitle}>Blokada aplikacji i sejf offline</Text><Text style={styles.subText}>{vaultReady ? `Aplikacja będzie otwierana przez: ${vaultMode === "pin" ? "PIN" : vaultMode === "password" ? "hasło" : "biometrię telefonu z metodą awaryjną"}.` : "Wybierz metodę otwierania całej aplikacji."}</Text></View>
        {(!vaultReady || changingAccess) && <>
          {vaultReady && changingAccess && <><Text style={styles.hint}>Najpierw potwierdź obecną metodę. Przy biometrii telefon wyświetli własne okno potwierdzenia po naciśnięciu Zapisz.</Text>{savedVaultMode !== "biometric" && <TextInput value={currentSecret} onChangeText={setCurrentSecret} secureTextEntry keyboardType={savedVaultMode === "pin" ? "number-pad" : "default"} placeholder={savedVaultMode === "pin" ? "Obecny PIN" : "Obecne hasło"} placeholderTextColor="#64748b" style={styles.input} />}</>}
          <Text style={styles.optionLabel}>{vaultReady ? "Nowa metoda otwierania" : "Metoda otwierania"}</Text>
          <View style={styles.modeRow}>{(["pin", "password", "biometric"] as VaultMode[]).map((mode) => <TouchableOpacity key={mode} onPress={() => setVaultMode(mode)} style={[styles.mode, vaultMode === mode && styles.modeActive]}><Text style={styles.btnText}>{mode === "pin" ? "PIN" : mode === "password" ? "Hasło" : "Biometria"}</Text></TouchableOpacity>)}</View>
          {vaultMode !== "biometric" ? <TextInput value={vaultPin} onChangeText={setVaultPin} secureTextEntry keyboardType={vaultMode === "pin" ? "number-pad" : "default"} placeholder={vaultMode === "pin" ? "Nowy PIN: min. 6 cyfr" : "Nowe hasło: min. 8 znaków"} placeholderTextColor="#64748b" style={styles.input} /> : <><Text style={styles.hint}>Biometria będzie metodą główną. Ustaw awaryjny PIN albo hasło, gdy biometrii nie chcesz użyć lub nie zadziała.</Text><View style={styles.modeRow}>{(["pin", "password"] as SecretMode[]).map((mode) => <TouchableOpacity key={mode} onPress={() => setBackupMode(mode)} style={[styles.mode, backupMode === mode && styles.modeActive]}><Text style={styles.btnText}>{mode === "pin" ? "PIN awaryjny" : "Hasło awaryjne"}</Text></TouchableOpacity>)}</View><TextInput value={backupSecret} onChangeText={setBackupSecret} secureTextEntry keyboardType={backupMode === "pin" ? "number-pad" : "default"} placeholder={backupMode === "pin" ? "Ustaw PIN awaryjny" : "Ustaw hasło awaryjne"} placeholderTextColor="#64748b" style={styles.input} /></>}
          <TouchableOpacity style={styles.saveBtn} onPress={vaultReady ? saveAccessChange : enableVault}><Text style={styles.btnText}>{vaultReady ? "Potwierdź i zapisz metodę" : "Włącz blokadę aplikacji"}</Text></TouchableOpacity>
        </>}
        {vaultReady && !changingAccess && <><TouchableOpacity style={styles.mode} onPress={() => { setCurrentSecret(""); setVaultPin(""); setBackupSecret(""); setChangingAccess(true); }}><Text style={styles.btnText}>Zmień metodę otwierania</Text></TouchableOpacity><TouchableOpacity disabled={vaultSyncing} style={[styles.btn, vaultSyncing && styles.disabledBtn]} onPress={refreshVault}>{vaultSyncing ? <ActivityIndicator color="white" /> : <Text style={styles.btnText}>Synchronizuj sejf</Text>}</TouchableOpacity></>}
        {vaultReady && <><Text style={styles.optionLabel}>Automatyczna blokada po opuszczeniu aplikacji</Text><View style={styles.modeRow}>{[1, 5, 15].map((minutes) => <TouchableOpacity key={minutes} onPress={() => void chooseAutoLock(minutes)} style={[styles.mode, autoLockMinutes === minutes && styles.modeActive]}><Text style={styles.btnText}>{minutes} min</Text></TouchableOpacity>)}</View><TouchableOpacity style={styles.lockNowButton} onPress={() => onLock?.()}><Ionicons name="lock-closed" size={17} color="white" /><Text style={styles.btnText}>Zablokuj aplikację teraz</Text></TouchableOpacity></>}
        {Boolean(vaultProgress) && <Text style={styles.hint}>{vaultProgress}</Text>}
      </View>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: "#0f172a", 
  }, content: { padding: 16, paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) + 16 : 16, paddingBottom: 40 },
  title: { color: "white", fontSize: 25, fontWeight: "bold", marginBottom: 8 }, intro: { color: "#cbd5e1", fontSize: 14, lineHeight: 20, marginBottom: 18 },
  sectionTabs: { flexDirection: "row", gap: 7, marginBottom: 16 }, sectionTab: { flex: 1, alignItems: "center", gap: 4, borderRadius: 9, paddingVertical: 10, backgroundColor: "#1e293b", borderWidth: 1, borderColor: "#334155" }, sectionTabActive: { backgroundColor: "#2563eb", borderColor: "#3b82f6" }, sectionTabText: { color: "white", fontSize: 11, fontWeight: "700" },
  card: { backgroundColor: "#1e293b", padding: 20, borderRadius: 12, borderColor: "#334155", borderWidth: 1 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  cardText: { color: "white", fontSize: 16, fontWeight: "bold" },
  subText: { color: "#94a3b8", fontSize: 14, marginBottom: 20, marginLeft: 24 },
  label: { color: "#cbd5e1", fontSize: 13, fontWeight: "600", marginBottom: 8 }, optionLabel: { color: "#cbd5e1", fontSize: 13, fontWeight: "700", marginTop: 5 },
  input: { color: "white", backgroundColor: "#0f172a", borderColor: "#475569", borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15 },
  hint: { color: "#94a3b8", fontSize: 12, marginTop: 8, marginBottom: 16 },
  saveBtn: { backgroundColor: "#16a34a", padding: 13, borderRadius: 8, alignItems: "center", marginBottom: 10 }, disabledBtn: { opacity: 0.55 },
  btn: { backgroundColor: "#3b82f6", padding: 12, borderRadius: 8, alignItems: "center" },
  btnText: { color: "white", fontWeight: "bold" }, alertCard: { backgroundColor: "#422006", padding: 16, borderRadius: 12, borderColor: "#b45309", borderWidth: 1, gap: 10 }, alertHeader: { flexDirection: "row", alignItems: "center", gap: 8 }, alertCount: { marginLeft: "auto", minWidth: 24, height: 24, paddingHorizontal: 7, borderRadius: 12, backgroundColor: "#dc2626", alignItems: "center", justifyContent: "center" }, alertCountText: { color: "white", fontWeight: "800", fontSize: 12 }, alertIntro: { color: "#fde68a", fontSize: 12 }, alertEmpty: { color: "#fde68a", fontSize: 12 }, alertList: { gap: 7 }, alertRow: { flexDirection: "row", alignItems: "center", gap: 8, padding: 9, borderRadius: 7, backgroundColor: "#78350f" }, alertUrgent: { backgroundColor: "#991b1b" }, alertTitle: { color: "white", fontSize: 12, fontWeight: "700" }, alertText: { color: "#fde68a", fontSize: 11, marginTop: 1 }, alertRefresh: { backgroundColor: "#b45309", padding: 10, borderRadius: 7, alignItems: "center" }, vaultCard: { backgroundColor: "#172554", padding: 16, borderRadius: 12, borderColor: "#2563eb", borderWidth: 1, gap: 10 }, vaultTitle: { color: "white", fontSize: 17, fontWeight: "bold" }, modeRow: { flexDirection: "row", gap: 6 }, mode: { flex: 1, backgroundColor: "#334155", padding: 9, borderRadius: 7, alignItems: "center" }, modeActive: { backgroundColor: "#2563eb" }, lockNowButton: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, backgroundColor: "#b91c1c", padding: 12, borderRadius: 8 }
});
