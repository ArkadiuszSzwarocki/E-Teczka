import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Animated, FlatList, Image, PanResponder, Platform, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import * as MailComposer from "expo-mail-composer";
import { useNavigation, useRoute, useIsFocused, type RouteProp } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { getApiUrl, getAuthHeaders } from "../services/localConnection";
import { isRetentionDocument, type RetentionDocument } from "../services/retentionNotifications";
import type { FolderStackParamList, MainTabParamList, RootStackParamList } from "../types/navigation";

type FolderDocument = RetentionDocument;

const retentionLabel = (doc: FolderDocument) => !doc.retentionEnabled ? "Bez terminu" : `${doc.retentionValue} ${doc.retentionUnit === "years" ? "lat" : doc.retentionUnit === "months" ? "mies." : doc.retentionUnit === "minutes" ? "min." : "dni"}`;

function DocumentCard({ item, onArchive, onTrash, onOpen, onSelect, selected }: { item: FolderDocument; onArchive: () => void; onTrash: () => void; onOpen: () => void; onSelect: () => void; selected: boolean }) {
  const position = useRef(new Animated.Value(0)).current;
  const responder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderMove: (_, g) => position.setValue(Math.max(-120, Math.min(120, g.dx))),
    onPanResponderRelease: (_, g) => {
      Animated.spring(position, { toValue: 0, useNativeDriver: true }).start();
      if (g.dx <= -80) onArchive();
      if (g.dx >= 80) onTrash();
    },
  }), [item.title, onArchive, onTrash, position]);
  return <View style={styles.swipeShell}>
    <View style={[styles.swipeHint, styles.trashHint]}><Text style={styles.swipeHintText}>Kosz →</Text><Ionicons name="trash-outline" size={21} color="white" /></View>
    <View style={[styles.swipeHint, styles.archiveHint]}><Ionicons name="archive-outline" size={21} color="white" /><Text style={styles.swipeHintText}>← Archiwum</Text></View>
    <Animated.View {...responder.panHandlers} style={[styles.card, selected && styles.cardSelected, { transform: [{ translateX: position }] }]}><TouchableOpacity activeOpacity={0.82} onPress={onOpen} onLongPress={onSelect} style={styles.cardPress}>
      <View style={styles.thumbnail}>{item.thumbnail ? <Image source={{ uri: item.thumbnail }} style={styles.thumbnailImage} /> : <Ionicons name="document-text" size={27} color="#60a5fa" />}</View>
      <View style={styles.documentInfo}><Text style={styles.docTitle} numberOfLines={2}>{item.title}</Text><Text style={styles.docDate}>Dodano: {new Date(item.createdAt).toLocaleDateString("pl-PL")}</Text><Text style={styles.openHint}>Dotknij, aby otworzyć</Text><View style={styles.retentionBadge}><Ionicons name="time-outline" size={12} color="#bae6fd" /><Text style={styles.retentionText}>{retentionLabel(item)}</Text></View></View>
      {selected && <Ionicons name="checkmark-circle" size={22} color="#60a5fa" />}
    </TouchableOpacity></Animated.View>
  </View>;
}

export default function FolderScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<FolderStackParamList, "FolderDetails">>();
  const route = useRoute<RouteProp<FolderStackParamList, "FolderDetails">>();
  const folder = route.params.folder;
  const tabNavigation = navigation.getParent<BottomTabNavigationProp<MainTabParamList>>();
  const rootNavigation = tabNavigation?.getParent<NativeStackNavigationProp<RootStackParamList>>();
  const isFocused = useIsFocused();
  const isMainFolder = !folder.parentId;
  const [documents, setDocuments] = useState<FolderDocument[]>([]); const [loading, setLoading] = useState(true); const [refreshing, setRefreshing] = useState(false); const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const fetchDocuments = async () => { try { const res = await fetch(await getApiUrl(`/api/documents?folderId=${folder.id}`), { headers: await getAuthHeaders() }); const data: unknown = await res.json(); const active = Array.isArray(data) ? data.filter(isRetentionDocument) : []; setDocuments(active.filter((doc) => !doc.isArchived && !doc.isDeleted)); } catch { Alert.alert("Brak połączenia", "Nie udało się pobrać dokumentów z komputera."); } finally { setLoading(false); setRefreshing(false); } };
  useEffect(() => { if (isFocused) void fetchDocuments(); }, [isFocused]);
  const updateDocument = async (id: number, data: Record<string, unknown>) => { await fetch(await getApiUrl(`/api/documents/${id}`), { method: "PATCH", headers: { "Content-Type": "application/json", ...await getAuthHeaders() }, body: JSON.stringify(data) }); await fetchDocuments(); };
  const openDocument = (doc: FolderDocument) => rootNavigation?.navigate("DocumentViewer", { document: doc });
  const toggleSelection = (id: number) => setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const emailSelected = async () => {
    const selected = documents.filter((document) => selectedIds.includes(document.id));
    if (!selected.length) return;
    try {
      if (!await MailComposer.isAvailableAsync()) return Alert.alert("Brak aplikacji e-mail", "Zainstaluj lub skonfiguruj pocztę w telefonie.");
      const attachments = await Promise.all(selected.map(async (document) => {
        const extension = document.filePath?.split(".").pop() || "pdf";
        const result = await FileSystem.downloadAsync(await getApiUrl(`/uploads/${document.filePath}`), `${FileSystem.cacheDirectory}eteczka_mail_${document.id}.${extension}`, { headers: await getAuthHeaders() });
        return result.uri;
      }));
      await MailComposer.composeAsync({ subject: `Dokumenty E‑Teczka (${selected.length})`, body: "Pakiet dokumentów z E‑Teczki w załącznikach.", attachments });
      setSelectedIds([]);
    } catch { Alert.alert("Nie udało się przygotować pakietu", "Sprawdź połączenie z komputerem i spróbuj ponownie."); }
  };
  const openScanner = () => { if (!isMainFolder) tabNavigation?.navigate("Skaner", { targetFolderId: folder.id }); };
  return <View style={styles.container}><View style={styles.header}><TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()} accessibilityLabel="Wróć do kartotek"><Ionicons name="arrow-back" size={20} color="white" /></TouchableOpacity><View style={{ flex: 1 }}><Text style={styles.title} numberOfLines={1}>{folder.name}</Text><Text style={styles.subtitle}>{selectedIds.length ? `Wybrano: ${selectedIds.length}` : isMainFolder ? "Kartoteka główna — pliki dodawaj do podkartoteki" : "Przesuń ← archiwum, → kosz"}</Text></View>{selectedIds.length ? <TouchableOpacity style={styles.emailBtnHeader} onPress={() => void emailSelected()}><Ionicons name="mail" size={17} color="white" /><Text style={styles.scanBtnText}>Wyślij</Text></TouchableOpacity> : !isMainFolder && <TouchableOpacity style={styles.scanBtnHeader} onPress={openScanner}><Ionicons name="camera" size={17} color="white" /><Text style={styles.scanBtnText}>Skanuj</Text></TouchableOpacity>}</View>
    <FlatList data={documents} keyExtractor={(item) => String(item.id)} contentContainerStyle={styles.listContent} refreshControl={<RefreshControl refreshing={refreshing || loading} onRefresh={() => { setRefreshing(true); void fetchDocuments(); }} tintColor="#3b82f6" />} ListEmptyComponent={<View style={styles.emptyBox}><Ionicons name="folder-open-outline" size={54} color="#475569" /><Text style={styles.emptyText}>{isMainFolder ? "Do kartoteki głównej nie dodajemy plików. Wybierz podkartotekę." : "Brak dokumentów w tej kartotece"}</Text>{!isMainFolder && <TouchableOpacity style={styles.emptyScanBtn} onPress={openScanner}><Text style={styles.emptyScanText}>Zrób pierwszy skan</Text></TouchableOpacity>}</View>} renderItem={({ item }) => <DocumentCard item={item} selected={selectedIds.includes(item.id)} onSelect={() => toggleSelection(item.id)} onOpen={() => selectedIds.length ? toggleSelection(item.id) : openDocument(item)} onArchive={() => void updateDocument(item.id, { isArchived: true })} onTrash={() => void updateDocument(item.id, { isDeleted: true })} />} />
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a", paddingTop: Platform.OS === "android" ? 30 : 13 }, header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 13, borderBottomWidth: 1, borderBottomColor: "#1e293b", gap: 8 }, backButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#1e293b", alignItems: "center", justifyContent: "center" }, title: { color: "white", fontSize: 18, fontWeight: "bold" }, subtitle: { color: "#94a3b8", fontSize: 10, marginTop: 2 }, scanBtnHeader: { backgroundColor: "#22c55e", flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 7, borderRadius: 7, gap: 5 }, emailBtnHeader: { backgroundColor: "#16a34a", flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 7, borderRadius: 7, gap: 5 }, scanBtnText: { color: "white", fontWeight: "bold", fontSize: 12 }, listContent: { padding: 13, gap: 10, paddingBottom: 96, flexGrow: 1 }, emptyBox: { alignItems: "center", justifyContent: "center", marginTop: 64 }, emptyText: { color: "#94a3b8", fontSize: 13, marginTop: 10, marginBottom: 16 }, emptyScanBtn: { backgroundColor: "#3b82f6", paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 }, emptyScanText: { color: "white", fontWeight: "bold", fontSize: 12 }, swipeShell: { minHeight: 72, justifyContent: "center" }, swipeHint: { position: "absolute", top: 0, bottom: 0, width: "42%", flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 13, borderRadius: 10 }, trashHint: { left: 0, backgroundColor: "#b91c1c", justifyContent: "flex-start" }, archiveHint: { right: 0, backgroundColor: "#b45309", justifyContent: "flex-end" }, swipeHintText: { color: "white", fontWeight: "800", fontSize: 10 }, card: { backgroundColor: "#1e293b", borderRadius: 10, borderWidth: 1, borderColor: "#334155" }, cardSelected: { borderColor: "#60a5fa", borderWidth: 2 }, cardPress: { minHeight: 72, flexDirection: "row", alignItems: "center", padding: 10, gap: 9 }, thumbnail: { width: 44, height: 50, backgroundColor: "#0f172a", borderRadius: 6, alignItems: "center", justifyContent: "center", overflow: "hidden" }, thumbnailImage: { width: "100%", height: "100%", resizeMode: "cover" }, documentInfo: { flex: 1, minWidth: 0 }, docTitle: { color: "white", fontSize: 12, fontWeight: "bold" }, docDate: { color: "#94a3b8", fontSize: 10, marginTop: 2 }, openHint: { color: "#60a5fa", fontSize: 9, marginTop: 2 }, retentionBadge: { alignSelf: "flex-start", marginTop: 4, backgroundColor: "#0c4a6e", borderRadius: 999, paddingHorizontal: 6, paddingVertical: 3, flexDirection: "row", gap: 3, alignItems: "center" }, retentionText: { color: "#e0f2fe", fontSize: 9, fontWeight: "700" },
});
