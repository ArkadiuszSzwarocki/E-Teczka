import React, { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, Platform, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { getApiUrl, getAuthHeaders } from "../services/localConnection";
import { isRetentionDocument, type RetentionDocument } from "../services/retentionNotifications";
import type { MainTabParamList, RootStackParamList } from "../types/navigation";

type Mode = "archive" | "trash";

export default function DocumentListScreen({ mode }: { mode: Mode }) {
  const isFocused = useIsFocused();
  const navigation = useNavigation<BottomTabNavigationProp<MainTabParamList>>();
  const rootNavigation = navigation.getParent<NativeStackNavigationProp<RootStackParamList>>();
  const [documents, setDocuments] = useState<RetentionDocument[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const response = await fetch(await getApiUrl("/api/documents"), { headers: await getAuthHeaders() });
      const payload: unknown = await response.json();
      const all = Array.isArray(payload) ? payload.filter(isRetentionDocument) : [];
      setDocuments(all.filter((document) => mode === "archive" ? document.isArchived && !document.isDeleted : document.isDeleted));
    } finally { setLoading(false); }
  }, [mode]);

  useEffect(() => { if (isFocused) void load(); }, [isFocused, load]);

  const update = async (id: number, data: Record<string, unknown>) => {
    await fetch(await getApiUrl(`/api/documents/${id}`), { method: "PATCH", headers: { "Content-Type": "application/json", ...await getAuthHeaders() }, body: JSON.stringify(data) });
    await load();
  };
  const restore = (id: number) => Alert.alert("Ustaw nowy termin życia", "Przed przywróceniem wybierz nową retencję dokumentu.", [
    { text: "30 dni", onPress: () => void update(id, { ...(mode === "archive" ? { isArchived: false } : { isDeleted: false }), retentionEnabled: true, retentionValue: 30, retentionUnit: "days", createdAt: new Date().toISOString() }) },
    { text: "1 rok", onPress: () => void update(id, { ...(mode === "archive" ? { isArchived: false } : { isDeleted: false }), retentionEnabled: true, retentionValue: 1, retentionUnit: "years", createdAt: new Date().toISOString() }) },
    { text: "5 lat", onPress: () => void update(id, { ...(mode === "archive" ? { isArchived: false } : { isDeleted: false }), retentionEnabled: true, retentionValue: 5, retentionUnit: "years", createdAt: new Date().toISOString() }) },
    { text: "Bez terminu", onPress: () => void update(id, { ...(mode === "archive" ? { isArchived: false } : { isDeleted: false }), retentionEnabled: false, createdAt: new Date().toISOString() }) },
    { text: "Anuluj", style: "cancel" },
  ]);
  const deletePermanently = (id: number) => Alert.alert("Usunąć dokument trwale?", "Tej operacji nie można cofnąć.", [
    { text: "Anuluj", style: "cancel" }, { text: "Usuń", style: "destructive", onPress: async () => { await fetch(await getApiUrl(`/api/documents/${id}`), { method: "DELETE", headers: await getAuthHeaders() }); await load(); } },
  ]);

  const isArchive = mode === "archive";
  const openDocument = (document: RetentionDocument) => rootNavigation?.navigate("DocumentViewer", { document });

  return <View style={styles.container}>
    <View style={styles.header}><View><Text style={styles.title}>{isArchive ? "Archiwum dokumentów" : "Kosz"}</Text><Text style={styles.subtitle}>{isArchive ? "Dokumenty odłożone do archiwum" : "Dokumenty oczekujące na usunięcie"}</Text></View><Ionicons name={isArchive ? "archive-outline" : "trash-outline"} size={30} color={isArchive ? "#f59e0b" : "#ef4444"} /></View>
    <FlatList data={documents} keyExtractor={(item) => String(item.id)} contentContainerStyle={styles.list} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor="#3b82f6" />} ListEmptyComponent={<View style={styles.empty}><Ionicons name={isArchive ? "archive-outline" : "trash-outline"} size={42} color="#475569" /><Text style={styles.emptyText}>{isArchive ? "Archiwum jest puste" : "Kosz jest pusty"}</Text></View>} renderItem={({ item }) => <TouchableOpacity activeOpacity={0.8} onPress={() => openDocument(item)} style={styles.card}><Ionicons name="document-text-outline" size={22} color="#60a5fa" /><View style={styles.details}><Text style={styles.documentTitle} numberOfLines={1}>{item.title}</Text><Text style={styles.date}>Data życia od: {new Date(item.createdAt).toLocaleDateString("pl-PL")}</Text></View><View style={styles.actions}>{isArchive ? <><TouchableOpacity onPress={() => void restore(item.id)} style={styles.restore}><Text style={styles.actionText}>Przywróć</Text></TouchableOpacity><TouchableOpacity onPress={() => void update(item.id, { isDeleted: true })} style={styles.trash}><Ionicons name="trash-outline" size={15} color="white" /></TouchableOpacity></> : <><TouchableOpacity onPress={() => void restore(item.id)} style={styles.restore}><Text style={styles.actionText}>Przywróć</Text></TouchableOpacity><TouchableOpacity onPress={() => deletePermanently(item.id)} style={styles.delete}><Text style={styles.actionText}>Usuń</Text></TouchableOpacity></>}</View></TouchableOpacity>} />
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a", paddingTop: Platform.OS === "android" ? 30 : 13 }, header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingBottom: 13, borderBottomWidth: 1, borderBottomColor: "#1e293b" }, title: { color: "white", fontSize: 18, fontWeight: "bold" }, subtitle: { color: "#94a3b8", marginTop: 2, fontSize: 10 }, list: { padding: 13, gap: 8, flexGrow: 1 }, empty: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 300 }, emptyText: { color: "#94a3b8", marginTop: 10, fontSize: 13 }, card: { backgroundColor: "#1e293b", borderColor: "#334155", borderWidth: 1, borderRadius: 10, padding: 10, flexDirection: "row", alignItems: "center", gap: 9 }, details: { flex: 1, minWidth: 0 }, documentTitle: { color: "white", fontWeight: "700", fontSize: 12 }, date: { color: "#94a3b8", fontSize: 10, marginTop: 2 }, actions: { flexDirection: "row", alignItems: "center", gap: 5 }, restore: { backgroundColor: "#2563eb", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 6 }, trash: { backgroundColor: "#b45309", borderRadius: 6, padding: 6 }, delete: { backgroundColor: "#b91c1c", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 6 }, actionText: { color: "white", fontWeight: "700", fontSize: 10 },
});
