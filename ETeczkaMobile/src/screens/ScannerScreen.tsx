import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Alert, TextInput, Image, ActivityIndicator, ScrollView, Switch, Modal } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { Ionicons } from "@expo/vector-icons";
import DocumentScanner, { ResponseType, ScanDocumentResponseStatus } from "react-native-document-scanner-plugin";
import { useRoute, useNavigation, type RouteProp } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { getApiUrl, getAuthHeaders } from "../services/localConnection";
import { clearScanDraft, loadScanDraft, saveScanDraft } from "../services/scanDraft";
import { fetchPrinterDevices, scanPrinterPage, type PrinterDevice } from "../services/printerScan";
import { uploadScanDocument } from "../services/mobileScanUpload";
import PrinterPickerModal from "../components/PrinterPickerModal";
import type { RetentionUnit } from "../types/domain";
import type { FolderSummary, MainTabParamList } from "../types/navigation";
import { errorMessage } from "../utils/errors";

const retentionUnitOptions: { value: RetentionUnit; label: string }[] = [
  { value: "minutes", label: "Minuty" },
  { value: "days", label: "Dni" },
  { value: "months", label: "Miesiące" },
  { value: "years", label: "Lata" },
];

export default function ScannerScreen() {
  const navigation = useNavigation<BottomTabNavigationProp<MainTabParamList, "Skaner">>();
  const route = useRoute<RouteProp<MainTabParamList, "Skaner">>();
  const routeFolderId = route.params?.targetFolderId ?? null;
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [pickerParentId, setPickerParentId] = useState<number | null>(null);
  const targetFolderId = routeFolderId || selectedFolderId;
  const [folderChoices, setFolderChoices] = useState<FolderSummary[]>([]);
  const [pages, setPages] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [retentionValue, setRetentionValue] = useState("5");
  const [retentionUnit, setRetentionUnit] = useState<RetentionUnit>("years");
  const [retentionEnabled, setRetentionEnabled] = useState(false);
  const [unitPickerOpen, setUnitPickerOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingLabel, setProcessingLabel] = useState("");
  const [printerPickerOpen, setPrinterPickerOpen] = useState(false);
  const [printerDevices, setPrinterDevices] = useState<PrinterDevice[]>([]);
  const [isLoadingPrinters, setIsLoadingPrinters] = useState(false);

  const persistDraft = async (nextPages: string[], nextTitle = title, nextRetentionValue = retentionValue, nextRetentionUnit = retentionUnit, nextRetentionEnabled = retentionEnabled) => {
    if (!targetFolderId || nextPages.length === 0) return;
    await saveScanDraft({ folderId: targetFolderId, pages: nextPages, title: nextTitle, retentionValue: nextRetentionValue, retentionUnit: nextRetentionUnit, retentionEnabled: nextRetentionEnabled });
  };

  useEffect(() => {
    void (async () => {
      const draft = await loadScanDraft(targetFolderId);
      if (!draft) return;
      setPages(draft.pages); setTitle(draft.title); setRetentionValue(draft.retentionValue); setRetentionUnit(draft.retentionUnit); setRetentionEnabled(Boolean(draft.retentionEnabled));
    })();
  }, [targetFolderId]);

  useEffect(() => {
    if (targetFolderId) return;
    void (async () => {
      try {
        const response = await fetch(await getApiUrl("/api/folders"), { headers: await getAuthHeaders() });
        const data: unknown = await response.json();
        setFolderChoices(Array.isArray(data) ? data.filter((folder): folder is FolderSummary => Boolean(folder) && typeof folder === "object" && typeof (folder as FolderSummary).id === "number" && typeof (folder as FolderSummary).name === "string") : []);
      } catch { Alert.alert("Nie udało się pobrać kartotek", "Sprawdź połączenie z komputerem E‑Teczka."); }
    })();
  }, [targetFolderId]);

  const startDocumentScan = async () => {
    if (!targetFolderId) {
      Alert.alert("Wybierz kartotekę", "Otwórz kartotekę w zakładce Kartoteki i wybierz Skanuj.");
      return;
    }
    try {
      setIsProcessing(true);
      setProcessingLabel("Otwieranie aparatu…");
      const result = await DocumentScanner.scanDocument({
        maxNumDocuments: 1,
        croppedImageQuality: 70,
        responseType: ResponseType.ImageFilePath,
      });
      if (result.status !== ScanDocumentResponseStatus.Success || !result.scannedImages?.[0]) return;
      setProcessingLabel("Zapisywanie strony roboczej…");
      const localUri = `${FileSystem.documentDirectory}scan_draft_${Date.now()}.jpg`;
      await FileSystem.copyAsync({ from: result.scannedImages[0], to: localUri });
      const nextPages = [...pages, localUri];
      setPages(nextPages);
      const nextTitle = title || `Skan ${new Date().toLocaleDateString("pl-PL")}`;
      if (!title) setTitle(nextTitle);
      await persistDraft(nextPages, nextTitle);
    } catch (error: unknown) {
      Alert.alert("Nie udało się zeskanować dokumentu", errorMessage(error, "Spróbuj ponownie."));
    } finally {
      setIsProcessing(false);
      setProcessingLabel("");
    }
  };

  const openPrinterScan = async () => {
    if (!targetFolderId) return Alert.alert("Wybierz kartotekę", "Otwórz podkartotekę w zakładce Kartoteki i wybierz Skanuj.");
    setPrinterPickerOpen(true); setIsLoadingPrinters(true); setPrinterDevices([]);
    try {
      setPrinterDevices(await fetchPrinterDevices());
    } catch (error: unknown) { Alert.alert("Brak skanerów", errorMessage(error, "Sprawdź komputer E‑Teczka i drukarkę.")); setPrinterPickerOpen(false); }
    finally { setIsLoadingPrinters(false); }
  };

  const startPrinterScan = async (deviceId: string) => {
    setPrinterPickerOpen(false); setIsProcessing(true); setProcessingLabel("Wysyłanie zlecenia do komputera…");
    try {
      if (!targetFolderId) throw new Error("Wybierz podkartotekę przed skanowaniem.");
      const localUri = await scanPrinterPage({ folderId: targetFolderId, deviceId, title: title.trim() || `Skan drukarki ${new Date().toLocaleDateString("pl-PL")}`, retentionEnabled, retentionValue, retentionUnit, onStage: setProcessingLabel });
      const nextPages = [...pages, localUri];
      const nextTitle = title || `Skan drukarki ${new Date().toLocaleDateString("pl-PL")}`;
      setPages(nextPages); if (!title) setTitle(nextTitle);
      await persistDraft(nextPages, nextTitle);
      Alert.alert("Skan dodany", "Strona z drukarki jest w wersji roboczej. Możesz zmienić nazwę i datę życia, dodać kolejne strony lub scalić dokument.");
    } catch (error: unknown) { Alert.alert("Nie udało się zeskanować", errorMessage(error, "Sprawdź połączenie z komputerem.")); }
    finally { setIsProcessing(false); setProcessingLabel(""); }
  };

  const saveDocument = async () => {
    if (pages.length === 0 || !targetFolderId) return;
    if (!title.trim() || (retentionEnabled && (!Number.isInteger(Number(retentionValue)) || Number(retentionValue) < 1))) {
      Alert.alert("Uzupełnij dane", "Podaj nazwę dokumentu oraz prawidłową datę życia, jeśli jest włączona.");
      return;
    }
    try {
      setIsProcessing(true);
      await uploadScanDocument({ pages, folderId: targetFolderId, title: title.trim(), retentionEnabled, retentionValue, retentionUnit, onStage: setProcessingLabel });
      await Promise.all(pages.map((uri) => FileSystem.deleteAsync(uri, { idempotent: true })));
      await clearScanDraft();
      Alert.alert("Dokument zapisany", `Scalono ${pages.length} ${pages.length === 1 ? "stronę" : "stron"} do jednego PDF i zapisano w kartotece.`, [
        { text: "OK", onPress: () => navigation.navigate("Kartoteki") },
      ]);
      setPages([]);
    } catch (error: unknown) {
      Alert.alert("Nie udało się zapisać", errorMessage(error, "Spróbuj ponownie."));
    } finally {
      setIsProcessing(false);
      setProcessingLabel("");
    }
  };

  const removePage = async (pageIndex: number) => {
    const removed = pages[pageIndex]; const nextPages = pages.filter((_, index) => index !== pageIndex);
    if (removed) await FileSystem.deleteAsync(removed, { idempotent: true });
    setPages(nextPages);
    if (nextPages.length) await persistDraft(nextPages); else await clearScanDraft();
  };

  if (pages.length) return (
    <ScrollView contentContainerStyle={styles.previewContainer} keyboardShouldPersistTaps="handled">
      <Text style={styles.previewTitle}>Wersja robocza: {pages.length} {pages.length === 1 ? "strona" : "stron"}</Text>
      <Image source={{ uri: pages.at(-1) }} style={styles.previewImage} resizeMode="contain" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbnailRow}>
        {pages.map((uri, index) => <View key={uri} style={styles.thumbnail}><Image source={{ uri }} style={styles.thumbnailImage} /><TouchableOpacity style={styles.removePageButton} onPress={() => void removePage(index)} disabled={isProcessing} accessibilityLabel={`Usuń stronę ${index + 1}`}><Ionicons name="close" size={12} color="white" /></TouchableOpacity><Text style={styles.thumbnailText}>Strona {index + 1}</Text></View>)}
      </ScrollView>
      <Text style={styles.label}>Nazwa dokumentu</Text>
      <TextInput value={title} onChangeText={setTitle} style={styles.input} placeholder="np. Faktura 12/2026" placeholderTextColor="#64748b" />
      <View style={styles.lifeHeader}><Text style={styles.label}>Data życia dokumentu</Text><TouchableOpacity onPress={() => Alert.alert("Czym jest data życia dokumentu?", "To czas, po którym dokument zostanie automatycznie przeniesiony do Kosza. Gdy jest wyłączona, dokument pozostaje w kartotece, dopóki nie przeniesiesz go ręcznie.")}><Ionicons name="information-circle-outline" size={21} color="#60a5fa" /></TouchableOpacity></View>
      <View style={styles.lifeToggle}><View><Text style={styles.lifeToggleTitle}>{retentionEnabled ? "Włączona" : "Wyłączona"}</Text><Text style={styles.lifeToggleText}>{retentionEnabled ? "Dokument będzie przeniesiony do Kosza po upływie czasu." : "Dokument nie ma automatycznej daty usunięcia."}</Text></View><Switch value={retentionEnabled} onValueChange={setRetentionEnabled} trackColor={{ false: "#475569", true: "#16a34a" }} thumbColor="white" /></View>
      {retentionEnabled && <View style={styles.retentionRow}>
        <TextInput value={retentionValue} onChangeText={setRetentionValue} keyboardType="number-pad" style={[styles.input, styles.retentionInput]} />
        <TouchableOpacity style={styles.unitSelect} onPress={() => setUnitPickerOpen(true)}><Text style={styles.unitText}>{({ years: "lata", months: "miesiące", days: "dni", minutes: "minuty" } satisfies Record<RetentionUnit, string>)[retentionUnit]}</Text><Ionicons name="chevron-down" size={18} color="#cbd5e1" /></TouchableOpacity>
      </View>}
      <View style={styles.draftActions}>
        <TouchableOpacity style={styles.secondaryButton} onPress={startDocumentScan} disabled={isProcessing}><Text style={styles.buttonText}>Dodaj stronę</Text></TouchableOpacity>
        <TouchableOpacity style={styles.secondaryButton} onPress={() => void openPrinterScan()} disabled={isProcessing}><Text style={styles.buttonText}>Strona z drukarki</Text></TouchableOpacity>
      </View>
      <View style={styles.previewActions}>
        <TouchableOpacity style={styles.saveButton} onPress={saveDocument} disabled={isProcessing}>{isProcessing ? <View style={styles.processingRow}><ActivityIndicator color="white" /><Text style={styles.buttonText}>{processingLabel || "Przetwarzanie…"}</Text></View> : <Text style={styles.buttonText}>Zakończ i scal PDF</Text>}</TouchableOpacity>
      </View>
      <Modal visible={unitPickerOpen} transparent animationType="fade" onRequestClose={() => setUnitPickerOpen(false)}><TouchableOpacity activeOpacity={1} style={styles.modalBackdrop} onPress={() => setUnitPickerOpen(false)}><View style={styles.unitModal} onStartShouldSetResponder={() => true}>{retentionUnitOptions.map(({ value, label }) => <TouchableOpacity key={value} style={styles.unitOption} onPress={() => { setRetentionUnit(value); setUnitPickerOpen(false); }}><Text style={styles.unitOptionText}>{label}</Text>{retentionUnit === value && <Ionicons name="checkmark" size={20} color="#60a5fa" />}</TouchableOpacity>)}</View></TouchableOpacity></Modal>
      <PrinterPickerModal visible={printerPickerOpen} loading={isLoadingPrinters} devices={printerDevices} mode="new-page" onSelect={(deviceId) => void startPrinterScan(deviceId)} onClose={() => setPrinterPickerOpen(false)} />
    </ScrollView>
  );

  if (!targetFolderId) return (
    <View style={styles.startContainer}>
      <Text style={styles.startTitle}>Wybierz kartotekę</Text>
      <Text style={styles.startText}>Dokument musi od razu trafić do właściwej kartoteki. Wybierz miejsce zapisu przed skanowaniem.</Text>
      {pickerParentId !== null && <TouchableOpacity style={styles.pickerBack} onPress={() => setPickerParentId(folderChoices.find((folder) => folder.id === pickerParentId)?.parentId ?? null)}><Ionicons name="arrow-back" size={17} color="#bfdbfe" /><Text style={styles.pickerBackText}>Wróć poziom wyżej</Text></TouchableOpacity>}
      <ScrollView style={styles.folderPicker} contentContainerStyle={{ gap: 10 }}>
        {folderChoices.filter((folder) => (folder.parentId ?? null) === pickerParentId).map((folder) => { const hasChildren = folderChoices.some((candidate) => candidate.parentId === folder.id); return <TouchableOpacity key={folder.id} style={styles.folderChoice} onPress={() => hasChildren ? setPickerParentId(folder.id) : folder.parentId ? setSelectedFolderId(folder.id) : Alert.alert("Wybierz podkartotekę", "Do kartoteki głównej nie zapisujemy dokumentów. Utwórz lub wybierz podkartotekę.")}><Ionicons name={hasChildren ? "folder-open" : "folder"} size={24} color="#60a5fa" /><View style={{ flex: 1 }}><Text style={styles.folderChoiceTitle}>{folder.name}</Text><Text style={styles.folderChoiceMeta}>{hasChildren ? "Otwórz podkartoteki" : "Wybierz jako miejsce zapisu"}</Text></View><Ionicons name="chevron-forward" size={21} color="#64748b" /></TouchableOpacity>})}
      </ScrollView>
      {folderChoices.length === 0 && <Text style={styles.warning}>Nie znaleziono kartotek. Utwórz kartotekę w E‑Teczce na komputerze.</Text>}
    </View>
  );

  return (
    <View style={styles.startContainer}>
      <Text style={styles.startTitle}>Skan dokumentu</Text>
      <Text style={styles.startText}>Dodawaj strony kolejno do wersji roboczej. Na końcu aplikacja scali je do jednego PDF.</Text>
      <View style={styles.featureBox}>
        <Text style={styles.featureText}>• automatyczne wykrywanie rogów</Text>
        <Text style={styles.featureText}>• przycięcie tła i korekcja perspektywy</Text>
        <Text style={styles.featureText}>• kompresja obrazu do 70% jakości</Text>
      </View>
      <TouchableOpacity style={styles.startButton} onPress={startDocumentScan} disabled={isProcessing}>{isProcessing ? <View style={styles.processingRow}><ActivityIndicator color="white" /><Text style={styles.buttonText}>{processingLabel || "Przetwarzanie…"}</Text></View> : <Text style={styles.buttonText}>Skanuj telefonem</Text>}</TouchableOpacity>
      <TouchableOpacity style={styles.printerButton} onPress={() => void openPrinterScan()} disabled={isProcessing}><Ionicons name="print-outline" size={20} color="#bfdbfe" /><Text style={styles.printerButtonText}>Skanuj z drukarki</Text></TouchableOpacity>
      <PrinterPickerModal visible={printerPickerOpen} loading={isLoadingPrinters} devices={printerDevices} mode="new-document" onSelect={(deviceId) => void startPrinterScan(deviceId)} onClose={() => setPrinterPickerOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  startContainer: { flex: 1, backgroundColor: "#0f172a", justifyContent: "center", padding: 24 },
  startTitle: { color: "white", fontSize: 28, fontWeight: "bold", marginBottom: 12 }, startText: { color: "#cbd5e1", fontSize: 16, lineHeight: 23 },
  featureBox: { backgroundColor: "#1e293b", borderColor: "#334155", borderWidth: 1, borderRadius: 12, padding: 16, marginTop: 24, gap: 8 }, featureText: { color: "#bfdbfe", fontSize: 14 },
  startButton: { backgroundColor: "#16a34a", padding: 16, borderRadius: 10, alignItems: "center", marginTop: 28 }, warning: { color: "#fbbf24", fontSize: 13, textAlign: "center", marginTop: 16 }, folderPicker: { marginTop: 12, maxHeight: "55%" }, pickerBack: { marginTop: 20, flexDirection: "row", gap: 7, alignItems: "center", alignSelf: "flex-start" }, pickerBackText: { color: "#bfdbfe", fontWeight: "700", fontSize: 13 }, folderChoice: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#1e293b", borderColor: "#334155", borderWidth: 1, borderRadius: 10, padding: 14 }, folderChoiceTitle: { color: "white", fontWeight: "700", fontSize: 16 }, folderChoiceMeta: { color: "#94a3b8", marginTop: 3, fontSize: 12 },
  printerButton: { marginTop: 12, borderWidth: 1, borderColor: "#3b82f6", backgroundColor: "#172554", padding: 15, borderRadius: 10, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 9 }, printerButtonText: { color: "#dbeafe", fontWeight: "bold" }, printerModal: { margin: 18, borderRadius: 16, backgroundColor: "#1e293b", borderWidth: 1, borderColor: "#475569", padding: 18 }, printerTitle: { color: "white", fontSize: 19, fontWeight: "800" }, printerIntro: { color: "#94a3b8", fontSize: 13, lineHeight: 19, marginTop: 7, marginBottom: 16 }, printerChoice: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#0f172a", borderColor: "#334155", borderWidth: 1, borderRadius: 10, padding: 13, marginBottom: 9 }, printerName: { color: "white", fontWeight: "700", fontSize: 14 }, printerManufacturer: { color: "#94a3b8", fontSize: 11, marginTop: 2 }, cancelPrinterButton: { alignItems: "center", padding: 13, marginTop: 5 }, cancelPrinterText: { color: "#cbd5e1", fontWeight: "700" },
  previewContainer: { flexGrow: 1, backgroundColor: "#0f172a", padding: 20, paddingTop: 56, paddingBottom: 42 }, previewTitle: { color: "white", fontSize: 22, fontWeight: "bold", marginBottom: 14 },
  previewImage: { width: "100%", height: "31%", backgroundColor: "#020617", borderRadius: 12, marginBottom: 10 }, thumbnailRow: { gap: 10, marginBottom: 14 }, thumbnail: { width: 64, alignItems: "center", gap: 3, position: "relative" }, thumbnailImage: { width: 60, height: 76, borderRadius: 5, backgroundColor: "#1e293b" }, removePageButton: { position: "absolute", top: -5, right: -2, width: 20, height: 20, borderRadius: 10, backgroundColor: "#b91c1c", alignItems: "center", justifyContent: "center", zIndex: 2 }, thumbnailText: { color: "#cbd5e1", fontSize: 10 }, label: { color: "#cbd5e1", fontSize: 13, fontWeight: "600", marginBottom: 7 },
  input: { color: "white", backgroundColor: "#1e293b", borderColor: "#475569", borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 11, fontSize: 16, marginBottom: 16 },
  lifeHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, lifeToggle: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#1e293b", borderColor: "#475569", borderWidth: 1, borderRadius: 9, padding: 11, marginBottom: 12 }, lifeToggleTitle: { color: "white", fontWeight: "700" }, lifeToggleText: { color: "#94a3b8", fontSize: 11, marginTop: 3, maxWidth: 245 }, retentionRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 }, retentionInput: { width: 72 }, unitSelect: { flex: 1, minHeight: 47, backgroundColor: "#1e293b", borderColor: "#475569", borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, unitText: { color: "#e2e8f0", fontSize: 14, fontWeight: "600" }, modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(2,6,23,0.72)" }, unitModal: { backgroundColor: "#1e293b", borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 14 }, unitOption: { flexDirection: "row", justifyContent: "space-between", padding: 16, borderBottomWidth: 1, borderBottomColor: "#334155" }, unitOptionText: { color: "white", fontSize: 17, fontWeight: "600" },
  draftActions: { flexDirection: "row", gap: 10, marginTop: 4 }, previewActions: { marginTop: 12, marginBottom: 16 }, secondaryButton: { flex: 1, backgroundColor: "#334155", padding: 14, borderRadius: 10, alignItems: "center" }, removeButton: { flex: 1, backgroundColor: "#7f1d1d", padding: 14, borderRadius: 10, alignItems: "center" }, saveButton: { backgroundColor: "#16a34a", minHeight: 54, padding: 14, borderRadius: 10, alignItems: "center", justifyContent: "center" }, processingRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 }, buttonText: { color: "white", fontWeight: "bold", textAlign: "center" },
});
