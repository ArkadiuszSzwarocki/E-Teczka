import React, { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, Platform, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { getApiUrl, getAuthHeaders } from "../services/localConnection";
import { fetchWithTimeout } from "../services/networkRequest";
import { isRetentionDocument, type RetentionDocument } from "../services/retentionNotifications";
import type { FolderSummary, MainTabParamList, RootStackParamList } from "../types/navigation";
import RestoreDestinationPicker, { type RestoreUnit } from "../components/RestoreDestinationPicker";
import EmptyTrashConfirmation from "../components/EmptyTrashConfirmation";

type Mode = "archive" | "trash";
export default function DocumentListScreen({ mode }: { mode: Mode }) {
  const isFocused = useIsFocused();
  const navigation = useNavigation<BottomTabNavigationProp<MainTabParamList>>();
  const rootNavigation = navigation.getParent<NativeStackNavigationProp<RootStackParamList>>();
  const [documents, setDocuments] = useState<RetentionDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [customValue, setCustomValue] = useState("");
  const [customUnit, setCustomUnit] = useState<RestoreUnit>("years");
  const [restoreRetentionEnabled, setRestoreRetentionEnabled] = useState<boolean | null>(null);
  const [restoreIds, setRestoreIds] = useState<number[] | null>(null);
  const [restoreFolders, setRestoreFolders] = useState<FolderSummary[]>([]);
  const [destinationId, setDestinationId] = useState<number | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [emptyVisible, setEmptyVisible] = useState(false);
  const [emptying, setEmptying] = useState(false);
  const isArchive = mode === "archive";

  const load = useCallback(async () => {
    try {
      const response = await fetchWithTimeout(await getApiUrl("/api/documents"), { headers: await getAuthHeaders() }, 10000, "Pobieranie dokumentów");
      if (!response.ok) throw new Error("Komputer nie udostępnił listy dokumentów.");
      const payload: unknown = await response.json();
      if (!Array.isArray(payload)) throw new Error("Nieprawidłowa lista dokumentów.");
      const all = payload.filter(isRetentionDocument);
      setDocuments(all.filter(document => mode === "archive" ? document.isArchived && !document.isDeleted : document.isDeleted));
    } finally { setLoading(false); }
  }, [mode]);
  const refresh = useCallback(() => { setLoading(true); void load().catch(error => Alert.alert("Nie udało się pobrać dokumentów", error instanceof Error ? error.message : "Sprawdź połączenie z komputerem.")); }, [load]);
  useEffect(() => { if (isFocused) refresh(); }, [isFocused, refresh]);
  useEffect(() => { setSelectedIds([]); }, [mode]);
  const patch = async (id: number, data: Record<string, unknown>) => {
    const response = await fetchWithTimeout(await getApiUrl(`/api/documents/${id}`), { method: "PATCH", headers: { "Content-Type": "application/json", ...await getAuthHeaders() }, body: JSON.stringify(data) }, 15000, "Zapisywanie dokumentu");
    if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.error || "Komputer odrzucił zmianę dokumentu."); }
  };
  const chooseDestination = async (ids: number[]) => {
    if (!ids.length || restoring) return;
    try {
      const response = await fetchWithTimeout(await getApiUrl('/api/folders'), { headers: await getAuthHeaders() }, 10000, 'Pobieranie kartotek');
      if (!response.ok) throw new Error('Nie udało się pobrać kartotek z komputera.');
      const payload: unknown = await response.json(); if (!Array.isArray(payload)) throw new Error('Nieprawidłowa lista kartotek.');
      setRestoreFolders(payload.filter((folder): folder is FolderSummary => Boolean(folder) && typeof folder === 'object' && Number.isInteger((folder as FolderSummary).id) && typeof (folder as FolderSummary).name === 'string'));
      setDestinationId(null); setCustomValue(''); setCustomUnit('years'); setRestoreRetentionEnabled(null); setRestoreIds(ids);
    } catch (error) { Alert.alert('Nie udało się wybrać kartoteki', error instanceof Error ? error.message : 'Sprawdź połączenie z komputerem.'); }
  };
  const confirmDestination = async () => {
    if (!restoreIds || destinationId === null || restoring || restoreRetentionEnabled === null) return;
    const value = Number(customValue);
    if (restoreRetentionEnabled && (!Number.isSafeInteger(value) || value < 1)) { Alert.alert('Nieprawidłowy termin', 'Wpisz liczbę całkowitą większą od zera.'); return; }
    setRestoring(true);
    const data = { retentionEnabled: restoreRetentionEnabled, ...(restoreRetentionEnabled ? { retentionValue: value, retentionUnit: customUnit } : {}), folderId: destinationId, isArchived: false, isDeleted: false, deletedAt: null, createdAt: new Date().toISOString() };
    try {
      const results = await Promise.allSettled(restoreIds.map(id => patch(id, data)));
      const failed = restoreIds.filter((_, index) => results[index].status === 'rejected');
      setSelectedIds(failed); setRestoreIds(failed.length ? failed : null);
      await load().catch(() => Alert.alert('Zapisano zmiany', 'Nie udało się odświeżyć listy.'));
      if (failed.length) Alert.alert('Nie wszystkie dokumenty przywrócono', `Nie udało się przywrócić ${failed.length} dokumentów. Pozostały zaznaczone; sprawdź listę przed ponowną próbą.`);
      else Alert.alert('Przywrócono', 'Dokumenty są dostępne w wybranej podkartotece.');
    } finally { setRestoring(false); }
  };
  const deletePermanently = (id: number) => Alert.alert("Usunąć dokument trwale?", "Dokument i jego plik zostaną trwale usunięte z komputera.", [
    { text: "Anuluj", style: "cancel" }, { text: "Usuń", style: "destructive", onPress: () => void (async () => { try { const response = await fetchWithTimeout(await getApiUrl(`/api/documents/${id}`), { method: "DELETE", headers: await getAuthHeaders() }, 15000, 'Usuwanie dokumentu'); const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error || 'Nie udało się usunąć dokumentu.'); setSelectedIds(current => current.filter(item => item !== id)); await load(); if (result.failedFiles) Alert.alert('Niepełne usunięcie', 'Nie udało się usunąć pliku z dysku komputera.'); } catch (error) { Alert.alert('Nie udało się usunąć', error instanceof Error ? error.message : 'Sprawdź połączenie z komputerem.'); } })() },
  ]);
  const emptyTrash = async () => {
    if (emptying) return;
    setEmptying(true);
    try {
      const response = await fetch(await getApiUrl('/api/documents/empty-trash'), { method: 'POST', headers: await getAuthHeaders() });
      const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error || 'Nie udało się opróżnić kosza.');
      setEmptyVisible(false); setSelectedIds([]); await load().catch(() => Alert.alert('Kosz opróżniono', 'Nie udało się odświeżyć listy.'));
      Alert.alert(result.failedFiles ? 'Niepełne usunięcie' : 'Kosz opróżniony', result.failedFiles ? `Usunięto ${result.deleted} dokumentów, ale ${result.failedFiles} plików pozostało na dysku komputera.` : `Usunięto ${result.deleted} dokumentów.`);
    } catch (error) { setEmptyVisible(false); Alert.alert('Nie udało się potwierdzić wyniku', `${error instanceof Error ? error.message : 'Sprawdź połączenie z komputerem.'} Odśwież kosz przed kolejną próbą.`); }
    finally { setEmptying(false); }
  };
  const toggleSelected = (id: number) => setSelectedIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  const openDocument = (document: RetentionDocument) => rootNavigation?.navigate("DocumentViewer", { document });
  return <View style={styles.container}>
    <RestoreDestinationPicker visible={restoreIds !== null} count={restoreIds?.length || 0} folders={restoreFolders} selected={destinationId} busy={restoring} retentionEnabled={restoreRetentionEnabled} retentionValue={customValue} retentionUnit={customUnit} onEnabledChange={setRestoreRetentionEnabled} onValueChange={setCustomValue} onUnitChange={setCustomUnit} onSelect={setDestinationId} onCancel={() => { if (!restoring) setRestoreIds(null); }} onConfirm={() => void confirmDestination()} />
    <EmptyTrashConfirmation visible={emptyVisible} count={documents.length} busy={emptying} onCancel={() => { if (!emptying) setEmptyVisible(false); }} onConfirm={() => void emptyTrash()} />
    <View style={styles.header}><View><Text style={styles.title}>{isArchive ? "Archiwum dokumentów" : "Kosz"}</Text><Text style={styles.subtitle}>{isArchive ? "Dokumenty odłożone do archiwum" : "Dokumenty oczekujące na usunięcie"}</Text></View><Ionicons name={isArchive ? "archive-outline" : "trash-outline"} size={30} color={isArchive ? "#f59e0b" : "#ef4444"} /></View>
    {documents.length > 0 && <View style={styles.toolbar}><TouchableOpacity onPress={() => setSelectedIds(selectedIds.length === documents.length ? [] : documents.map(doc => doc.id))} style={styles.toolbarButton}><Text style={styles.actionText}>{selectedIds.length === documents.length ? 'Odznacz wszystkie' : 'Zaznacz wszystkie'}</Text></TouchableOpacity>{selectedIds.length > 0 && <TouchableOpacity onPress={() => void chooseDestination(selectedIds)} style={styles.restore}><Text style={styles.actionText}>Przywróć ({selectedIds.length})</Text></TouchableOpacity>}{!isArchive && <TouchableOpacity onPress={() => setEmptyVisible(true)} style={styles.delete}><Text style={styles.actionText}>Opróżnij kosz</Text></TouchableOpacity>}</View>}
    <FlatList data={documents} keyExtractor={item => String(item.id)} contentContainerStyle={styles.list} refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor="#3b82f6" />} ListEmptyComponent={<View style={styles.empty}><Ionicons name={isArchive ? "archive-outline" : "trash-outline"} size={42} color="#475569" /><Text style={styles.emptyText}>{isArchive ? "Archiwum jest puste" : "Kosz jest pusty"}</Text></View>} renderItem={({ item }) => <View style={styles.card}><TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: selectedIds.includes(item.id) }} accessibilityLabel={`Zaznacz ${item.title}`} onPress={() => toggleSelected(item.id)} style={styles.checkbox}><Ionicons name={selectedIds.includes(item.id) ? 'checkbox' : 'square-outline'} size={23} color="#60a5fa" /></TouchableOpacity><TouchableOpacity activeOpacity={0.8} onPress={() => openDocument(item)} style={styles.details}><Text style={styles.documentTitle} numberOfLines={1}>{item.title}</Text><Text style={styles.date}>Data życia od: {new Date(item.createdAt).toLocaleDateString("pl-PL")}</Text></TouchableOpacity><View style={styles.actions}><TouchableOpacity onPress={() => void chooseDestination([item.id])} style={styles.restore}><Text style={styles.actionText}>Przywróć</Text></TouchableOpacity>{isArchive ? <TouchableOpacity onPress={() => void patch(item.id, { isDeleted: true }).then(load).catch(() => Alert.alert('Nie udało się przenieść do kosza', 'Sprawdź połączenie z komputerem.'))} style={styles.trash}><Ionicons name="trash-outline" size={15} color="white" /></TouchableOpacity> : <TouchableOpacity onPress={() => deletePermanently(item.id)} style={styles.delete}><Text style={styles.actionText}>Usuń</Text></TouchableOpacity>}</View></View>} />
  </View>;
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 13, paddingTop: 12 }, toolbarButton: { backgroundColor: "#334155", borderRadius: 6, padding: 7 }, checkbox: { padding: 4 },
  container: { flex: 1, backgroundColor: "#0f172a", paddingTop: Platform.OS === "android" ? 30 : 13 }, header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingBottom: 13, borderBottomWidth: 1, borderBottomColor: "#1e293b" }, title: { color: "white", fontSize: 18, fontWeight: "bold" }, subtitle: { color: "#94a3b8", marginTop: 2, fontSize: 10 }, list: { padding: 13, gap: 8, flexGrow: 1 }, empty: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 300 }, emptyText: { color: "#94a3b8", marginTop: 10, fontSize: 13 }, card: { backgroundColor: "#1e293b", borderColor: "#334155", borderWidth: 1, borderRadius: 10, padding: 10, flexDirection: "row", alignItems: "center", gap: 9 }, details: { flex: 1, minWidth: 0 }, documentTitle: { color: "white", fontWeight: "700", fontSize: 12 }, date: { color: "#94a3b8", fontSize: 10, marginTop: 2 }, actions: { flexDirection: "row", alignItems: "center", gap: 5 }, restore: { backgroundColor: "#2563eb", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 6 }, trash: { backgroundColor: "#b45309", borderRadius: 6, padding: 6 }, delete: { backgroundColor: "#b91c1c", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 6 }, actionText: { color: "white", fontWeight: "700", fontSize: 10 }, modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", alignItems: "center", justifyContent: "center", padding: 24 }, modalCard: { width: "100%", maxWidth: 390, backgroundColor: "#1e293b", borderRadius: 14, padding: 18, borderWidth: 1, borderColor: "#475569" }, modalTitle: { color: "white", fontSize: 18, fontWeight: "800" }, modalHint: { color: "#cbd5e1", fontSize: 12, marginTop: 6, marginBottom: 15 }, customRow: { flexDirection: "row", gap: 8 }, customInput: { flex: 1, minHeight: 46, borderRadius: 8, borderWidth: 1, borderColor: "#64748b", color: "white", backgroundColor: "#0f172a", paddingHorizontal: 12, fontSize: 17 }, unitRow: { flex: 1.5, flexDirection: "row", gap: 4 }, unitButton: { flex: 1, borderRadius: 8, borderWidth: 1, borderColor: "#475569", alignItems: "center", justifyContent: "center", paddingHorizontal: 4 }, unitButtonActive: { backgroundColor: "#2563eb", borderColor: "#60a5fa" }, unitText: { color: "white", fontSize: 11, fontWeight: "700" }, modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 9, marginTop: 18 }, modalCancel: { paddingVertical: 10, paddingHorizontal: 14 }, modalCancelText: { color: "#cbd5e1", fontWeight: "700" }, modalSave: { backgroundColor: "#16a34a", borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16 }, modalSaveText: { color: "white", fontWeight: "800" },
});
