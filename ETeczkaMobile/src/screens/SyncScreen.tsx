import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Platform, StatusBar, TextInput, Alert, ActivityIndicator, ScrollView, BackHandler } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import axios from "axios";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { useIsFocused } from '@react-navigation/native';
import { getApiUrl, getAuthHeaders, getLocalConnection, pairLocalComputer } from "../services/localConnection";
import { changeVaultAccess, clearOfflineCopies, createVault, getOfflineFolderIds, getVaultStorageBytes, getViewerCacheBytes, hasVault, setOfflineFolderIds, syncOfflineVault, unlockWithPin, vaultMode as readVaultMode, SecretMode, VaultMode } from "../services/offlineVault";
import { getCatalogStorageBytes } from "../services/offlineCatalog";
import { getSyncInfo, syncNow, syncOfflineCatalog } from "../services/offlineSync";
import * as LocalAuthentication from "expo-local-authentication";
import { isRetentionDocument, retentionExpiresAt, scheduleRetentionNotifications, type RetentionDocument } from "../services/retentionNotifications";
import { getAutoLockMinutes, setAutoLockMinutes } from "../services/appLock";
import type { FolderSummary, MainTabParamList } from "../types/navigation";
import { errorMessage } from "../utils/errors";
import ConnectionSettingsCard from "../components/ConnectionSettingsCard";
import RetentionAlertsCard, { type RetentionAlert } from "../components/RetentionAlertsCard";
import MoreMenu, { type MoreSection } from "../components/MoreMenu";

type SyncScreenProps = BottomTabScreenProps<MainTabParamList, "Ustawienia"> & {
  computerOnline: boolean;
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

export default function SyncScreen({ navigation, computerOnline, onPaired, onLock }: SyncScreenProps) {
  const isFocused = useIsFocused();
  const [status, setStatus] = useState("Sprawdzanie...");
  const [statusColor, setStatusColor] = useState("#eab308");
  const [serverUrl, setServerUrl] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [isPairing, setIsPairing] = useState(false);
  const [vaultPin, setVaultPin] = useState(""); const [vaultMode, setVaultMode] = useState<VaultMode>("pin"); const [savedVaultMode, setSavedVaultMode] = useState<VaultMode>("pin"); const [backupMode, setBackupMode] = useState<SecretMode>("pin"); const [backupSecret, setBackupSecret] = useState(""); const [currentSecret, setCurrentSecret] = useState(""); const [vaultReady, setVaultReady] = useState(false); const [vaultProgress, setVaultProgress] = useState(""); const [vaultSyncing, setVaultSyncing] = useState(false); const [changingAccess, setChangingAccess] = useState(false);
  const [lifeAlerts, setLifeAlerts] = useState<RetentionAlert[]>([]); const [alertsLoading, setAlertsLoading] = useState(false);
  const [section, setSection] = useState<MoreSection | 'menu'>('menu');
  const [autoLockMinutes, setAutoLockMinutesState] = useState(1);
  const [offlineFolders, setOfflineFolders] = useState<FolderSummary[]>([]); const [offlineFolderIds, setOfflineFolderIdsState] = useState<number[]>([]); const [offlineBytes, setOfflineBytes] = useState(0);
  const [folderLoadError, setFolderLoadError] = useState('');
  const [syncInfo, setSyncInfo] = useState({ pending: 0, conflicts: 0 }); const [syncing, setSyncing] = useState(false);

  useEffect(() => navigation.addListener('tabPress', () => setSection('menu')), [navigation]);
  useEffect(() => {
    if (section === 'menu' || !isFocused) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { setSection('menu'); return true; });
    return () => subscription.remove();
  }, [section, isFocused]);

  useEffect(() => {
    if (!serverUrl || isPairing) return;
    setStatus(computerOnline ? 'Połączono (Online)' : 'Brak połączenia (Offline)');
    setStatusColor(computerOnline ? '#22c55e' : '#ef4444');
  }, [computerOnline, serverUrl, isPairing]);

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
      if (!connection || (url && url !== connection.serverUrl)) throw new Error("Najpierw sparuj wybrany komputer.");
      const response = await axios.get(await getApiUrl('/api/folders'), { timeout: 3000, headers: await getAuthHeaders() });
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
        void loadOfflineFolders();
      } else {
        setStatus("Dodaj komputer lokalny");
        setStatusColor("#94a3b8");
      }
    });
    getOfflineFolderIds().then(setOfflineFolderIdsState); void refreshOfflineBytes();
    getSyncInfo().then(info => setSyncInfo({ pending: info.pending, conflicts: info.conflicts }));
  }, []);

  const refreshOfflineBytes = async () => { const [catalog, vault, cache] = await Promise.all([getCatalogStorageBytes(), getVaultStorageBytes(), getViewerCacheBytes()]); setOfflineBytes(catalog + vault + cache); };
  const loadOfflineFolders = async () => {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(await getApiUrl("/api/folders"), { headers: await getAuthHeaders(), signal: controller.signal });
      if (!response.ok) throw new Error('Komputer odrzucił pobranie listy kartotek.');
      const data = await response.json(); if (!Array.isArray(data)) throw new Error('Nieprawidłowa lista kartotek.');
      setOfflineFolders(data); setFolderLoadError('');
    } catch { setFolderLoadError('Nie udało się pobrać listy. Sprawdź połączenie z komputerem i spróbuj ponownie.'); }
    finally { clearTimeout(timeout); }
  };
  const toggleOfflineFolder = async (id: number) => { const next = offlineFolderIds.includes(id) ? offlineFolderIds.filter(value => value !== id) : [...offlineFolderIds, id]; setOfflineFolderIdsState(next); await setOfflineFolderIds(next); };

  const chooseAutoLock = async (minutes: number) => { await setAutoLockMinutes(minutes); setAutoLockMinutesState(minutes); };

  const refreshRetentionNotifications = async () => {
    const response = await fetch(await getApiUrl("/api/documents"), { headers: await getAuthHeaders() });
    if (!response.ok) return;
    const payload: unknown = await response.json();
    await scheduleRetentionNotifications((Array.isArray(payload) ? payload : []).filter(isRetentionDocument).filter((document) => !document.isDeleted && !document.isArchived));
    await loadLifeAlerts();
  };
  const enableVault = async () => { try { setIsPairing(true); if (vaultMode === "biometric" && (!(await LocalAuthentication.hasHardwareAsync()) || !(await LocalAuthentication.isEnrolledAsync()))) throw new Error("Najpierw ustaw odcisk palca lub twarz w ustawieniach telefonu."); await createVault(vaultPin, vaultMode, vaultMode === "biometric" ? { mode: backupMode, secret: backupSecret } : undefined); setVaultReady(true); setSavedVaultMode(vaultMode); setVaultPin(""); setBackupSecret(""); setVaultProgress("Blokada włączona. Wybierz kartoteki i kliknij „Pobierz na telefon”."); } catch (error: unknown) { Alert.alert("Nie udało się utworzyć sejfu", errorMessage(error)); } finally { setIsPairing(false); } };
  const refreshVault = async () => {
    if (!vaultReady) { Alert.alert("Włącz blokadę aplikacji", "Aby bezpiecznie pobrać dokumenty, najpierw skonfiguruj PIN, hasło lub biometrię poniżej."); return; }
    if (!offlineFolderIds.length) { Alert.alert("Wybierz kartoteki", "Zaznacz przynajmniej jedną podkartotekę do pobrania."); return; }
    try {
      setVaultSyncing(true); setVaultProgress("Synchronizowanie zmian i listy dokumentów…");
      const result = await syncOfflineCatalog(offlineFolderIds); setSyncInfo({ pending: result.pending, conflicts: result.conflicts });
      const count = await syncOfflineVault((done, total, stage) => setVaultProgress(`${stage || 'Pobieranie i szyfrowanie'} (${done}/${total})`));
      await refreshOfflineBytes();
      setVaultProgress(`Gotowe: ${count} dokumentów z wybranych kartotek jest dostępnych offline.`);
      Alert.alert("Pobrano na telefon", `Dokumenty dostępne offline: ${count}.`);
      void refreshRetentionNotifications().catch(() => undefined);
    } catch (error: unknown) { const message = errorMessage(error, "Sprawdź połączenie z komputerem."); setVaultProgress(`Nie zakończono pobierania: ${message}`); Alert.alert("Nie udało się pobrać dokumentów", message); }
    finally { setVaultSyncing(false); }
  };
  const removeOfflineCopies = () => {
    Alert.alert('Usuń pliki offline z telefonu?', 'Pobrane kopie i podglądy zostaną usunięte z tego telefonu. Dokumenty na komputerze oraz oczekujące zmiany pozostaną. Aby mieć dokumenty offline ponownie, pobierz je jeszcze raz.', [
      { text: 'Anuluj', style: 'cancel' },
      { text: 'Usuń z telefonu', style: 'destructive', onPress: () => { void (async () => {
        try {
          setVaultSyncing(true); setVaultProgress('Usuwanie kopii offline…');
          await clearOfflineCopies((done, total) => setVaultProgress(`Usuwanie kopii offline: ${done}/${total}`));
          setOfflineFolderIdsState([]); await refreshOfflineBytes(); setVaultProgress('Kopie offline usunięte z telefonu.');
          Alert.alert('Gotowe', 'Kopie offline i zapisane podglądy usunięto z telefonu.');
        } catch (error: unknown) {
          setOfflineFolderIdsState(await getOfflineFolderIds()); await refreshOfflineBytes();
          setVaultProgress('Nie wszystkie kopie zostały usunięte.'); Alert.alert('Nie udało się usunąć kopii', errorMessage(error));
        } finally { setVaultSyncing(false); }
      })(); } },
    ]);
  };
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
      {section !== 'menu' && <TouchableOpacity accessibilityRole="button" onPress={() => setSection('menu')} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 }}><Ionicons name="arrow-back" size={20} color="#93c5fd" /><Text style={{ color: '#93c5fd', fontWeight: '700' }}>Menu</Text></TouchableOpacity>}
      <Text style={styles.title}>{section === 'menu' ? 'Menu' : section === 'connection' ? 'Połączenie z komputerem' : section === 'sync' ? 'Synchronizacja' : section === 'alerts' ? 'Terminy' : 'Ustawienia'}</Text>
      {section === 'menu' && <MoreMenu onOpen={next => { setSection(next); if (next === 'alerts') void loadLifeAlerts(); if (next === 'sync') { void loadOfflineFolders(); void refreshOfflineBytes(); void getSyncInfo().then(info => setSyncInfo({ pending: info.pending, conflicts: info.conflicts })).catch(() => undefined); } }} onLock={() => { if (vaultReady) onLock(); else Alert.alert('Ustaw blokadę', 'Najpierw ustaw PIN, hasło lub biometrię w menu Ustawienia.'); }} />}
      
      {section === "connection" && <ConnectionSettingsCard status={status} statusColor={statusColor} serverUrl={serverUrl} pairingCode={pairingCode} isPairing={isPairing} onServerUrlChange={setServerUrl} onPairingCodeChange={setPairingCode} onPair={() => void pairComputer()} onRefresh={() => void testConnection()} onQrPairing={(url, code) => { setServerUrl(url); setPairingCode(code); }} />}
      {section === "alerts" && <RetentionAlertsCard alerts={lifeAlerts} loading={alertsLoading} onRefresh={() => void loadLifeAlerts()} />}
      {section === "sync" && <View style={styles.card}><Text style={styles.vaultTitle}>Synchronizacja offline</Text><Text style={styles.subText}>{syncInfo.pending ? `Oczekujące zmiany: ${syncInfo.pending}` : "Brak oczekujących zmian"}{syncInfo.conflicts ? ` · Konflikty: ${syncInfo.conflicts}` : ""}</Text><TouchableOpacity disabled={syncing} style={[styles.btn, syncing && styles.disabledBtn]} onPress={async () => { try { setSyncing(true); const result = await syncNow(); setSyncInfo({ pending: result.pending, conflicts: result.conflicts }); Alert.alert("Synchronizacja zakończona", "Zsynchronizowano zmiany i listę dokumentów. Aby pobrać pliki, wybierz kartoteki i kliknij „Pobierz wybrane na telefon”."); } catch (error: unknown) { Alert.alert("Synchronizacja nie została zakończona", errorMessage(error, "Sprawdź połączenie z komputerem. Zmiany pozostają w kolejce.")); } finally { setSyncing(false); } }}><Text style={styles.btnText}>{syncing ? "Synchronizuję…" : "Synchronizuj teraz"}</Text></TouchableOpacity></View>}
      {section === "sync" && <View style={styles.card}><Text style={styles.vaultTitle}>Dane aplikacyjne offline</Text><Text style={styles.subText}>Zajętość lokalnej kopii: {(offlineBytes / 1024 / 1024).toFixed(1)} MB</Text><TouchableOpacity style={styles.btn} onPress={() => { void loadOfflineFolders(); void refreshOfflineBytes(); }}><Text style={styles.btnText}>Odśwież listę kartotek</Text></TouchableOpacity>{Boolean(folderLoadError) && <Text style={styles.hint}>{folderLoadError}</Text>}{offlineFolders.length > 0 && <><Text style={styles.optionLabel}>Kartoteki pobierane na telefon</Text>{offlineFolders.filter(folder => folder.parentId !== null).map(folder => <TouchableOpacity key={folder.id} style={styles.folderChoice} onPress={() => void toggleOfflineFolder(folder.id)}><Ionicons name={offlineFolderIds.includes(folder.id) ? "checkbox" : "square-outline"} size={22} color={offlineFolderIds.includes(folder.id) ? "#22c55e" : "#94a3b8"} /><Text style={styles.btnText}>{folder.name}</Text></TouchableOpacity>)}<Text style={styles.hint}>Zaznacz podkartoteki, a następnie pobierz ich dokumenty na telefon. Kopie są szyfrowane.</Text></>}<TouchableOpacity disabled={vaultSyncing} style={[styles.saveBtn, vaultSyncing && styles.disabledBtn]} onPress={() => void refreshVault()}>{vaultSyncing ? <ActivityIndicator color="white" /> : <Text style={styles.btnText}>Pobierz wybrane na telefon ({offlineFolderIds.length})</Text>}</TouchableOpacity><TouchableOpacity disabled={vaultSyncing || syncing} style={[styles.lockNowButton, (vaultSyncing || syncing) && styles.disabledBtn]} onPress={removeOfflineCopies}><Ionicons name="trash-outline" size={17} color="white" /><Text style={styles.btnText}>Usuń kopie offline z telefonu</Text></TouchableOpacity>{Boolean(vaultProgress) && <Text style={styles.hint}>{vaultProgress}</Text>}</View>}{section === "settings" && <View style={styles.vaultCard}>
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
  folderChoice: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#0f172a", padding: 10, borderRadius: 7, marginTop: 6 },
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
