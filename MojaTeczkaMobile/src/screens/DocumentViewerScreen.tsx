import { profileCacheDirectory, profileOperation } from '../services/mobileProfile';
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Pdf from "react-native-pdf";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as MailComposer from "expo-mail-composer";
import * as NavigationBar from "expo-navigation-bar";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { getApiUrl, getAuthHeaders } from "../services/localConnection";
import { offlineFile } from "../services/offlineVault";
import { downloadSecureFile } from "../services/secureFileTransfer";
import OcrViewer from "../components/OcrViewer";
import type { RootStackParamList } from "../types/navigation";

export default function DocumentViewerScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, "DocumentViewer">>();
  const { document } = useRoute<RouteProp<RootStackParamList, "DocumentViewer">>().params;
  const [fileUri, setFileUri] = useState<string | null>(null);
  const [textPreview, setTextPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showOcr, setShowOcr] = useState(false);

  const extension = (document.filePath?.split(".").pop() || "pdf").toLowerCase();
  const isImage = Boolean(document.mimeType?.startsWith("image/"));
  const isStructuredText = extension === "xml" || extension === "json"
    || Boolean(document.mimeType?.includes("xml") || document.mimeType?.includes("json"));

  const documentDownloadPath = (filePath: string) => {
    const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
    return normalized.toLowerCase().startsWith("uploads/") ? `/${normalized}` : `/uploads/${normalized}`;
  };

  const downloadDocument = profileOperation(async () => {
    const target = `${profileCacheDirectory()}mojateczka_v2_${document.id}.${extension}`;
    const cached = await FileSystem.getInfoAsync(target);
    const updatedMs = document.updatedAt ? Date.parse(document.updatedAt) : NaN;
    const rawMtime = cached.exists && 'modificationTime' in cached ? Number(cached.modificationTime || 0) : 0;
    const cachedMtimeMs = rawMtime > 1e12 ? rawMtime : rawMtime * 1000;
    const cacheFresh = cached.exists && (!Number.isFinite(updatedMs) || (cachedMtimeMs > 0 && cachedMtimeMs >= updatedMs));
    if (cacheFresh) return { uri: target };
    const temporary = `${target}.${Date.now()}-${Math.random().toString(36).slice(2)}.download`;
    const download = downloadSecureFile(await getApiUrl(documentDownloadPath(document.filePath)), temporary, await getAuthHeaders())
      .then(async (result) => {
        if (result.status !== 200) {
          await FileSystem.deleteAsync(temporary, { idempotent: true });
          throw new Error(`Serwer zwrócił kod ${result.status}.`);
        }
        await FileSystem.moveAsync({ from: temporary, to: target });
        return { ...result, uri: target };
      }).catch(async error => {
        await FileSystem.deleteAsync(temporary, { idempotent: true }).catch(() => undefined);
        throw error;
      });
    return Promise.race([
      download,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Pobieranie dokumentu trwa zbyt długo.")), 15_000)),
    ]);
  });

  useEffect(() => {
    let active = true;
    const load = async () => {
      let resolvedUri: string;
      try {
        resolvedUri = (await downloadDocument()).uri;
      } catch {
        try {
          resolvedUri = await offlineFile(document);
        } catch {
          if (active) {
            Alert.alert("Nie udało się pobrać dokumentu", "Połączenie z komputerem nie odpowiada. Sprawdź połączenie albo pobierz dokument do sejfu offline.");
            navigation.goBack();
          }
          return;
        }
      }
      if (!active) return;
      setFileUri(resolvedUri);
      if (isStructuredText) {
        try {
          const raw = await FileSystem.readAsStringAsync(resolvedUri);
          if (!active) return;
          if (extension === "json" || document.mimeType?.includes("json")) {
            try { setTextPreview(JSON.stringify(JSON.parse(raw), null, 2)); }
            catch { setTextPreview(raw); }
          } else {
            setTextPreview(raw);
          }
        } catch {
          if (active) setTextPreview("Nie udało się odczytać zawartości pliku.");
        } finally {
          if (active) setLoading(false);
        }
      }
    };
    void load();
    return () => { active = false; };
  }, [document.filePath, document.updatedAt, extension, isStructuredText, navigation]);
  useEffect(() => { void NavigationBar.setVisibilityAsync("hidden"); return () => { void NavigationBar.setVisibilityAsync("visible"); }; }, []);

  const share = async () => { try { const saved = fileUri ? { uri: fileUri } : await downloadDocument(); if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(saved.uri, { mimeType: document.mimeType, dialogTitle: document.title }); } catch { Alert.alert("Nie udało się udostępnić", "Spróbuj ponownie po sprawdzeniu połączenia."); } };
  const email = async () => { try { if (!await MailComposer.isAvailableAsync()) return Alert.alert("Brak aplikacji e-mail", "Zainstaluj lub skonfiguruj aplikację pocztową w telefonie."); const saved = fileUri ? { uri: fileUri } : await downloadDocument(); await MailComposer.composeAsync({ subject: document.title, body: "Dokument z MojejTeczki w załączniku.", attachments: [saved.uri] }); } catch { Alert.alert("Nie udało się przygotować e-maila", "Spróbuj ponownie po sprawdzeniu połączenia."); } };
  return <View style={styles.container}>
    <View style={styles.header}><TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}><Ionicons name="arrow-back" size={22} color="white" /></TouchableOpacity><Text style={styles.title} numberOfLines={1}>{document.title}</Text></View>
    <View style={styles.viewer}>
      {fileUri && (
        isImage ? (
          <Image source={{ uri: fileUri }} style={styles.image} resizeMode="contain" onLoadEnd={() => setLoading(false)} onError={() => { setLoading(false); Alert.alert("Nie udało się wyświetlić obrazu", "Możesz nadal użyć udostępniania lub e-maila."); }} />
        ) : isStructuredText ? (
          <ScrollView style={styles.textScroll} contentContainerStyle={styles.textContent}>
            <Text selectable style={styles.codeText}>{textPreview ?? ""}</Text>
          </ScrollView>
        ) : (
          <Pdf source={{ uri: fileUri, cache: true }} style={styles.pdf} onLoadComplete={() => setLoading(false)} onError={() => { setLoading(false); Alert.alert("Nie udało się wyświetlić PDF", "Możesz nadal użyć udostępniania lub e-maila."); }} />
        )
      )}
      {loading && <View style={styles.loading}><ActivityIndicator size="large" color="#60a5fa" /><Text style={styles.loadingText}>Pobieranie dokumentu…</Text></View>}
    </View>
    <View style={styles.actions}><TouchableOpacity style={styles.share} onPress={() => setShowOcr(true)}><Text style={styles.actionText}>Tekst OCR</Text></TouchableOpacity><TouchableOpacity style={styles.share} onPress={() => void share()}><Ionicons name="share-social-outline" size={19} color="white" /><Text style={styles.actionText}>Udostępnij</Text></TouchableOpacity><TouchableOpacity style={styles.email} onPress={() => void email()}><Ionicons name="mail-outline" size={19} color="white" /><Text style={styles.actionText}>Wyślij e‑mailem</Text></TouchableOpacity></View>
    {showOcr && <OcrViewer documentId={document.id} onClose={() => setShowOcr(false)} />}
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" }, header: { height: 52, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, gap: 11, borderBottomWidth: 1, borderBottomColor: "#1e293b" }, back: { width: 35, height: 35, borderRadius: 18, backgroundColor: "#1e293b", justifyContent: "center", alignItems: "center" }, title: { color: "white", flex: 1, fontSize: 15, fontWeight: "700" }, viewer: { flex: 1, margin: 10, borderRadius: 10, overflow: "hidden", backgroundColor: "#020617" }, pdf: { flex: 1, backgroundColor: "#020617" }, image: { flex: 1, width: "100%", height: "100%" }, textScroll: { flex: 1, backgroundColor: "#020617" }, textContent: { padding: 14 }, codeText: { color: "#e2e8f0", fontSize: 12, lineHeight: 18, fontFamily: "monospace" }, loading: { ...StyleSheet.absoluteFill, zIndex: 2, alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: "#0f172a" }, loadingText: { color: "#cbd5e1", fontSize: 13 }, actions: { flexDirection: "row", gap: 9, padding: 13, paddingBottom: 30 }, share: { flex: 1, backgroundColor: "#2563eb", borderRadius: 9, paddingVertical: 11, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 }, email: { flex: 1.25, backgroundColor: "#16a34a", borderRadius: 9, paddingVertical: 11, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 }, actionText: { color: "white", fontSize: 12, fontWeight: "800" },
});
