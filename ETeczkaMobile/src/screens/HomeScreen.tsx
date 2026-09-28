import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, Platform, StatusBar, Modal, TextInput, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useIsFocused, type NavigationProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { io } from "socket.io-client";
import { getApiUrl, getAuthHeaders, getLocalConnection } from "../services/localConnection";
import type { FolderStackParamList, FolderSummary, MainTabParamList } from "../types/navigation";
import { errorMessage } from "../utils/errors";

function isFolderSummary(value: unknown): value is FolderSummary {
  if (!value || typeof value !== "object") return false;
  const folder = value as Partial<FolderSummary>;
  return typeof folder.id === "number" && typeof folder.name === "string" && (folder.parentId === null || typeof folder.parentId === "number");
}

export default function HomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<FolderStackParamList, "HomeList">>();
  const isFocused = useIsFocused();
  const [folders, setFolders] = useState<FolderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [needsSetup, setNeedsSetup] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [folderDialog, setFolderDialog] = useState<{ parentId: number; parentName?: string; editFolder?: FolderSummary } | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<{ folder: FolderSummary; documentCount: number } | null>(null);
  const [transferFolderId, setTransferFolderId] = useState<number | null>(null);
  const [deletingFolder, setDeletingFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [editing, setEditing] = useState(false);

  const fetchFolders = async () => {
    setLoadError(null);
    try {
      if (!await getLocalConnection()) {
        setNeedsSetup(true);
        return;
      }
      setNeedsSetup(false);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8_000);
      let res: Response;
      try {
        res = await fetch(await getApiUrl("/api/folders"), { headers: await getAuthHeaders(), signal: controller.signal });
      } catch (error: unknown) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error("Komputer nie odpowiedział w ciągu 8 sekund. Sprawdź, czy E‑Teczka działa i telefon jest w tej samej sieci Wi‑Fi.");
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
      if (!res.ok) throw new Error("Błąd serwera");
      const data: unknown = await res.json();
      setFolders(Array.isArray(data) ? data.filter(isFolderSummary) : []);
    } catch (error: unknown) {
      setLoadError(error instanceof Error ? error.message : "Nie udało się pobrać kartotek z komputera.");
      setNeedsSetup(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!isFocused) return;
    fetchFolders();
  }, [isFocused]);

  useEffect(() => {
    if (!isFocused) return;
    let socket: ReturnType<typeof io> | undefined;
    getLocalConnection().then((connection) => {
      if (!connection) return;
      socket = io(connection.serverUrl);
      socket.on("db_update", () => { fetchFolders(); });
    });
    return () => { socket?.disconnect(); };
  }, [isFocused]);
  
  const onRefresh = () => { setRefreshing(true); fetchFolders(); };
  const toggleExpand = (id: number) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  const openFolderDialog = (parentId: number, parentName?: string, editFolder?: FolderSummary) => {
    setFolderName(editFolder?.name ?? "");
    setFolderDialog({ parentId, parentName, editFolder });
  };
  const closeFolderDialog = () => {
    if (!creatingFolder) setFolderDialog(null);
  };
  const saveFolder = async () => {
    const name = folderName.trim();
    if (!name || !folderDialog) return;
    setCreatingFolder(true);
    try {
      const response = await fetch(await getApiUrl(folderDialog.editFolder ? `/api/folders/${folderDialog.editFolder.id}` : "/api/folders"), {
        method: folderDialog.editFolder ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
        body: JSON.stringify(folderDialog.editFolder ? { name } : { name, parentId: folderDialog.parentId }),
      });
      if (!response.ok) throw new Error();
      const parentId = folderDialog.parentId;
      setFolderDialog(null);
      if (parentId) setExpanded(previous => ({ ...previous, [parentId]: true }));
      await fetchFolders();
    } catch {
      Alert.alert("Nie udało się zapisać kartoteki", "Sprawdź połączenie z komputerem i spróbuj ponownie.");
    } finally {
      setCreatingFolder(false);
    }
  };

  const getFolderBranchIds = (folderId: number): number[] => {
    const ids = [folderId];
    for (const folder of folders.filter((candidate) => candidate.parentId === folderId)) ids.push(...getFolderBranchIds(folder.id));
    return ids;
  };
  const deleteFolder = (folder: FolderSummary) => Alert.alert("Usunąć kartotekę?", `Najpierw sprawdzimy, czy „${folder.name}” zawiera dokumenty.`, [{ text: "Anuluj", style: "cancel" }, { text: "Usuń", style: "destructive", onPress: async () => {
    try {
      const headers = await getAuthHeaders();
      const previewResponse = await fetch(await getApiUrl(`/api/folders/${folder.id}/delete-preview`), { headers });
      const preview: unknown = await previewResponse.json();
      const documentCount = preview && typeof preview === "object" && typeof (preview as { documentCount?: unknown }).documentCount === "number" ? (preview as { documentCount: number }).documentCount : 0;
      if (!previewResponse.ok) throw new Error("Nie udało się sprawdzić zawartości kartoteki.");
      if (documentCount > 0) {
        setTransferFolderId(null);
        setDeleteDialog({ folder, documentCount });
        return;
      }
      const response = await fetch(await getApiUrl(`/api/folders/${folder.id}/delete-safely`), { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({}) });
      if (!response.ok) throw new Error("Nie udało się usunąć kartoteki.");
      await fetchFolders();
    } catch (error: unknown) { Alert.alert("Nie udało się usunąć", errorMessage(error, "Sprawdź połączenie z komputerem.")); }
  } }]);
  const confirmDeleteFolder = async () => {
    if (!deleteDialog || (deleteDialog.documentCount > 0 && !transferFolderId)) return;
    setDeletingFolder(true);
    try {
      const response = await fetch(await getApiUrl(`/api/folders/${deleteDialog.folder.id}/delete-safely`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
        body: JSON.stringify({ transferFolderId }),
      });
      if (!response.ok) throw new Error("Nie udało się usunąć kartoteki.");
      setDeleteDialog(null);
      await fetchFolders();
    } catch (error: unknown) { Alert.alert("Nie udało się usunąć", errorMessage(error, "Sprawdź połączenie z komputerem.")); }
    finally { setDeletingFolder(false); }
  };

  const mainFolders = folders.filter(f => !f.parentId);
  const getSubfolders = (parentId: number) => folders.filter(f => f.parentId === parentId);
  const renderFolder = (item: FolderSummary, depth = 0): React.ReactNode => {
    const children = getSubfolders(item.id); const isExpanded = expanded[item.id]; const docCount = Number(item._count?.documents ?? 0);
    return <View key={item.id} style={[styles.folderGroup, depth > 0 && styles.nestedFolderGroup]}><View style={styles.card}><TouchableOpacity style={styles.infoWrapper} activeOpacity={0.7} onPress={() => children.length ? toggleExpand(item.id) : navigation.navigate("FolderDetails", { folder: item })}><View style={styles.iconWrapper}><Ionicons name="document-text-outline" size={28} color="#dbeafe" /><Text style={styles.iconCount}>{docCount}</Text></View><View style={{ flex: 1 }}><Text style={styles.folderTitle}>{item.name}</Text><Text style={styles.folderHint}>{children.length ? `${children.length} ${children.length === 1 ? "podkartoteka" : "podkartoteki"}` : "Otwórz dokumenty"}</Text></View></TouchableOpacity>{children.length > 0 ? <TouchableOpacity style={styles.expandBtn} onPress={() => toggleExpand(item.id)}><Ionicons name={isExpanded ? "chevron-down" : "chevron-forward"} size={28} color="#94a3b8" /></TouchableOpacity> : <View style={styles.expandBtnPlaceholder} />}{editing && <View style={styles.editActions}><TouchableOpacity onPress={() => openFolderDialog(item.id, item.name)}><Ionicons name="add-circle-outline" size={24} color="#60a5fa" /></TouchableOpacity><TouchableOpacity onPress={() => openFolderDialog(item.parentId ?? item.id, undefined, item)}><Ionicons name="pencil-outline" size={22} color="#fbbf24" /></TouchableOpacity><TouchableOpacity onPress={() => deleteFolder(item)}><Ionicons name="trash-outline" size={22} color="#f87171" /></TouchableOpacity></View>}</View>{isExpanded && children.map(child => renderFolder(child, depth + 1))}</View>;
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Kartoteki</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => setEditing(value => !value)} style={[styles.editBtn, editing && styles.editBtnActive]} accessibilityLabel={editing ? "Zakończ edycję kartotek" : "Edytuj kartoteki"}><Ionicons name={editing ? "checkmark" : "pencil"} size={22} color="#ffffff" /></TouchableOpacity>
          <TouchableOpacity onPress={onRefresh} style={styles.refreshBtn} accessibilityLabel="Odśwież kartoteki">
            <Ionicons name="refresh" size={20} color="#3b82f6" />
          </TouchableOpacity>
        </View>
      </View>

      {needsSetup ? (
        <View style={styles.centerBox}>
          <Ionicons name="desktop-outline" size={54} color="#64748b" />
          <Text style={styles.setupTitle}>Najpierw połącz komputer</Text>
          <Text style={styles.setupText}>{loadError ?? "W Ustawieniach wpisz adres IP komputera E‑Teczka oraz jednorazowy kod parowania."}</Text>
          <TouchableOpacity style={styles.setupButton} onPress={() => navigation.getParent<NavigationProp<MainTabParamList>>()?.navigate("Ustawienia")}><Text style={styles.setupButtonText}>Przejdź do Ustawień</Text></TouchableOpacity>
        </View>
      ) : loading ? (
        <View style={styles.centerBox}><ActivityIndicator size="large" color="#3b82f6" /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.listContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b82f6" />}>
          {editing && <TouchableOpacity style={styles.addMainFolderButton} onPress={() => openFolderDialog(0)}><Ionicons name="add-circle-outline" size={20} color="#bbf7d0" /><Text style={styles.addMainFolderButtonText}>Dodaj kartotekę główną</Text></TouchableOpacity>}
          {mainFolders.map(folder => renderFolder(folder))}
        </ScrollView>
      )}

      <Modal visible={folderDialog !== null} transparent animationType="fade" onRequestClose={closeFolderDialog}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalIcon}><Ionicons name="folder-outline" size={28} color="#60a5fa" /></View>
            <Text style={styles.modalTitle}>{folderDialog?.editFolder ? "Zmień nazwę kartoteki" : folderDialog?.parentId === 0 ? "Nowa kartoteka główna" : "Nowa podkartoteka"}</Text>
            <Text style={styles.modalText}>{folderDialog?.editFolder ? `Edytujesz: ${folderDialog.editFolder.name}` : folderDialog?.parentId === 0 ? "Kartoteka zostanie dodana do poziomu głównego." : `Zostanie dodana do: ${folderDialog?.parentName}`}</Text>
            <TextInput
              autoFocus
              value={folderName}
              onChangeText={setFolderName}
              placeholder={folderDialog?.editFolder ? "Nowa nazwa" : "Nazwa podkartoteki"}
              placeholderTextColor="#64748b"
              style={styles.folderInput}
              editable={!creatingFolder}
              onSubmitEditing={saveFolder}
              returnKeyType="done"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelButton} onPress={closeFolderDialog} disabled={creatingFolder}><Text style={styles.cancelButtonText}>Anuluj</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.createButton, (!folderName.trim() || creatingFolder) && styles.createButtonDisabled]} onPress={saveFolder} disabled={!folderName.trim() || creatingFolder}>
                {creatingFolder ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.createButtonText}>{folderDialog?.editFolder ? "Zapisz" : "Utwórz"}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      <Modal visible={deleteDialog !== null} transparent animationType="fade" onRequestClose={() => !deletingFolder && setDeleteDialog(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalIcon}><Ionicons name="swap-horizontal-outline" size={28} color="#fbbf24" /></View>
            <Text style={styles.modalTitle}>Przenieś dokumenty</Text>
            <Text style={styles.modalText}>„{deleteDialog?.folder.name}” zawiera {deleteDialog?.documentCount} dokumentów. Wskaż podkartotekę, do której mają zostać przeniesione przed usunięciem.</Text>
            <ScrollView style={styles.transferList} contentContainerStyle={styles.transferListContent}>
              {deleteDialog && folders.filter((folder) => folder.parentId !== null && !getFolderBranchIds(deleteDialog.folder.id).includes(folder.id)).map((folder) => <TouchableOpacity key={folder.id} style={[styles.transferOption, transferFolderId === folder.id && styles.transferOptionActive]} onPress={() => setTransferFolderId(folder.id)} disabled={deletingFolder}><Ionicons name="folder-outline" size={19} color={transferFolderId === folder.id ? "#bfdbfe" : "#94a3b8"} /><Text style={styles.transferOptionText}>{folder.name}</Text>{transferFolderId === folder.id && <Ionicons name="checkmark" size={19} color="#60a5fa" />}</TouchableOpacity>)}
            </ScrollView>
            <View style={styles.modalActions}><TouchableOpacity style={styles.cancelButton} onPress={() => setDeleteDialog(null)} disabled={deletingFolder}><Text style={styles.cancelButtonText}>Anuluj</Text></TouchableOpacity><TouchableOpacity style={[styles.deleteButton, (!transferFolderId || deletingFolder) && styles.createButtonDisabled]} onPress={() => void confirmDeleteFolder()} disabled={!transferFolderId || deletingFolder}>{deletingFolder ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.createButtonText}>Przenieś i usuń</Text>}</TouchableOpacity></View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a", paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) + 10 : 16 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingBottom: 22, borderBottomWidth: 1, borderBottomColor: "#334155" },
  title: { color: "white", fontSize: 26, fontWeight: "800", letterSpacing: -0.5 },
  headerActions: { flexDirection: "row", gap: 10, alignItems: "center" },
  refreshBtn: { backgroundColor: "#1e293b", padding: 14, borderRadius: 11, borderWidth: 1, borderColor: "#475569" },
  editBtn: { alignItems: "center", justifyContent: "center", backgroundColor: "#475569", width: 48, height: 48, borderRadius: 11 }, editBtnActive: { backgroundColor: "#2563eb" },
  centerBox: { flex: 1, alignItems: "center", justifyContent: "center" },
  setupTitle: { color: "white", fontSize: 19, fontWeight: "bold", marginTop: 14 }, setupText: { color: "#94a3b8", fontSize: 14, textAlign: "center", lineHeight: 20, marginTop: 8, paddingHorizontal: 32 }, setupButton: { marginTop: 18, backgroundColor: "#3b82f6", paddingHorizontal: 16, paddingVertical: 11, borderRadius: 8 }, setupButtonText: { color: "white", fontWeight: "700" },
  listContent: { padding: 12, gap: 11, paddingBottom: 96 },
  addMainFolderButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderStyle: "dashed", borderColor: "#22c55e", backgroundColor: "#14532d", borderRadius: 11, minHeight: 48, marginBottom: 2 }, addMainFolderButtonText: { color: "#dcfce7", fontWeight: "800", fontSize: 14 },
  folderGroup: { marginBottom: 8 }, nestedFolderGroup: { marginLeft: 16, marginTop: 10, borderLeftWidth: 2, borderLeftColor: "#2563eb", paddingLeft: 10 },
  card: { minHeight: 82, backgroundColor: "#1e293b", borderRadius: 12, flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "#475569", overflow: "hidden" },
  infoWrapper: { flex: 1, flexDirection: "row", alignItems: "center", padding: 13 },
  iconWrapper: { width: 46, height: 46, backgroundColor: "#1d4ed8", borderRadius: 9, marginRight: 11, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 3 }, iconCount: { color: "#ffffff", fontSize: 15, fontWeight: "800" },
  folderTitle: { color: "white", fontSize: 18, fontWeight: "800" }, folderHint: { color: "#94a3b8", fontSize: 10, marginTop: 3, fontWeight: "600" },
  expandBtn: { alignSelf: "stretch", justifyContent: "center", paddingHorizontal: 13, borderLeftWidth: 1, borderLeftColor: "#475569" },
  expandBtnPlaceholder: { width: 35 },
  addSubBtn: { paddingVertical: 16, paddingHorizontal: 12, borderLeftWidth: 1, borderLeftColor: "#334155" },
  editActions: { flexDirection: "row", gap: 11, paddingHorizontal: 12, paddingVertical: 14, borderLeftWidth: 1, borderLeftColor: "#334155", alignItems: "center" },
  subCard: { flexDirection: "row", alignItems: "center", backgroundColor: "#0f172a", padding: 12, paddingLeft: 24, borderBottomWidth: 1, borderBottomColor: "#1e293b", borderLeftWidth: 2, borderLeftColor: "#3b82f6", marginLeft: 20, marginTop: 4, borderRadius: 8 },
  subFolderTitle: { color: "#cbd5e1", fontSize: 15, fontWeight: "500", flex: 1 },
  subCountBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#1e40af", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  subCountText: { color: "#dbeafe", fontSize: 12, fontWeight: "700" },
  modalBackdrop: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "rgba(2, 6, 23, 0.78)" },
  modalCard: { backgroundColor: "#1e293b", borderRadius: 16, borderWidth: 1, borderColor: "#334155", padding: 22 },
  modalIcon: { width: 52, height: 52, borderRadius: 12, justifyContent: "center", alignItems: "center", backgroundColor: "#0f172a", marginBottom: 14 },
  modalTitle: { color: "#ffffff", fontSize: 21, fontWeight: "700" },
  modalText: { color: "#94a3b8", fontSize: 14, lineHeight: 20, marginTop: 7 },
  folderInput: { color: "#ffffff", fontSize: 16, backgroundColor: "#0f172a", borderColor: "#475569", borderWidth: 1, borderRadius: 9, paddingHorizontal: 13, paddingVertical: 12, marginTop: 18 },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 18 },
  cancelButton: { paddingHorizontal: 15, paddingVertical: 11, borderRadius: 8 },
  cancelButtonText: { color: "#cbd5e1", fontWeight: "700" },
  createButton: { minWidth: 92, alignItems: "center", backgroundColor: "#2563eb", paddingHorizontal: 17, paddingVertical: 11, borderRadius: 8 },
  deleteButton: { minWidth: 132, alignItems: "center", backgroundColor: "#b91c1c", paddingHorizontal: 17, paddingVertical: 11, borderRadius: 8 },
  createButtonDisabled: { opacity: 0.45 },
  createButtonText: { color: "#ffffff", fontWeight: "700" },
  transferList: { maxHeight: 220, marginTop: 16 }, transferListContent: { gap: 8 }, transferOption: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 9, borderWidth: 1, borderColor: "#475569", backgroundColor: "#0f172a", paddingHorizontal: 12 }, transferOptionActive: { borderColor: "#3b82f6", backgroundColor: "#172554" }, transferOptionText: { flex: 1, color: "#e2e8f0", fontWeight: "600" },
});
