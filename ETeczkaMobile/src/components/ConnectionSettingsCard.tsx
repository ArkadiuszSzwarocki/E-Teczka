import React from "react";
import { ActivityIndicator, Alert, Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { fetchVerifiedPairingCertificate } from "../services/downloadPairingCertificate";
import { setPendingComputerCertificate } from "../services/localTls";
import { normalizeServerUrl } from "../services/localConnection";

type ConnectionSettingsCardProps = {
  status: string;
  statusColor: string;
  serverUrl: string;
  pairingCode: string;
  isPairing: boolean;
  onServerUrlChange: (value: string) => void;
  onPairingCodeChange: (value: string) => void;
  onPair: () => void;
  onRefresh: () => void;
  onQrPairing: (serverUrl: string, pairingCode: string) => void;
};

export default function ConnectionSettingsCard({
  status, statusColor, serverUrl, pairingCode, isPairing, onServerUrlChange, onPairingCodeChange, onPair, onRefresh, onQrPairing,
}: ConnectionSettingsCardProps) {
  const [scannerOpen, setScannerOpen] = React.useState(false);
  const scanned = React.useRef(false);
  const [fingerprint, setFingerprint] = React.useState('');
  const [downloaded, setDownloaded] = React.useState(false);
  const [downloading, setDownloading] = React.useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const openScanner = async () => { scanned.current = false; if (!permission?.granted) { const result = await requestPermission(); if (!result.granted) return; } setScannerOpen(true); };
  const handleQr = (data: string) => {
    if (scanned.current) return; scanned.current = true;
    try {
      const parsed = JSON.parse(data) as { serverUrl?: unknown; pairingCode?: unknown; caFingerprint?: unknown };
      if (typeof parsed.serverUrl !== 'string' || typeof parsed.pairingCode !== 'string' || !/^\d{8}$/.test(parsed.pairingCode) || typeof parsed.caFingerprint !== 'string' || !/^(?:[0-9a-f]{2}:){31}[0-9a-f]{2}$/i.test(parsed.caFingerprint)) throw new Error('Nieprawidłowy kod QR E‑Teczki.');
      const url = normalizeServerUrl(parsed.serverUrl); if (!url.startsWith('https://')) throw new Error('Kod QR nie zawiera adresu HTTPS.');
      setFingerprint(parsed.caFingerprint); setDownloaded(false); setScannerOpen(false); onQrPairing(url, parsed.pairingCode); void prepare(url, parsed.caFingerprint);
    } catch { setScannerOpen(false); Alert.alert('Nieprawidłowy kod QR', 'Otwórz aktualne okno parowania w E‑Teczce na komputerze i zeskanuj jego kod.'); }
  };
  const prepare = async (url: string, expected: string) => {
    try { setDownloading(true); const pem = await fetchVerifiedPairingCertificate(url, expected); await setPendingComputerCertificate(url, pem); setDownloaded(true); }
    catch (error) { setDownloaded(false); Alert.alert('Nie udało się zweryfikować komputera', error instanceof Error ? error.message : 'Sprawdź połączenie Wi-Fi.'); }
    finally { setDownloading(false); }
  };
  return <View style={styles.card}>
    <View style={styles.statusRow}>
      <Ionicons name="ellipse" size={14} color={statusColor} />
      <Text style={styles.cardText}>Stan: {status}</Text>
    </View>
    <Text style={styles.subText}>1. Na komputerze otwórz E‑Teczkę i kliknij adres w górnym pasku. Telefon i komputer muszą być w tej samej sieci Wi‑Fi.</Text>
    <TouchableOpacity style={[styles.qrBtn, (downloading || isPairing) && styles.disabledBtn]} disabled={downloading || isPairing} onPress={() => void openScanner()}><Ionicons name="qr-code-outline" size={19} color="#bae6fd" /><Text style={styles.btnText}>1. Skanuj kod QR z komputera</Text></TouchableOpacity>
    {!!fingerprint && <Text style={styles.hint}>Komputer: {serverUrl}{'\n'}{downloading ? 'Sprawdzanie bezpiecznego połączenia…' : downloaded ? 'Certyfikat sprawdzony. Możesz połączyć telefon.' : 'Nie udało się sprawdzić certyfikatu. Zeskanuj kod ponownie.'}</Text>}
    <TouchableOpacity style={[styles.saveBtn, (isPairing || downloading || !downloaded) && styles.disabledBtn]} onPress={onPair} disabled={isPairing || downloading || !downloaded}>
      {isPairing || downloading ? <ActivityIndicator color="white" /> : <Text style={styles.btnText}>2. Połącz telefon z komputerem</Text>}
    </TouchableOpacity>
    <TouchableOpacity style={styles.btn} onPress={onRefresh} disabled={isPairing}>
      <Text style={styles.btnText}>Wymuś synchronizację</Text>
    </TouchableOpacity>
    <Modal visible={scannerOpen} animationType="slide" onRequestClose={() => setScannerOpen(false)}><View style={styles.scanner}><View style={styles.scannerHeader}><Text style={styles.scannerTitle}>Skanuj kod QR</Text><TouchableOpacity onPress={() => setScannerOpen(false)}><Ionicons name="close" size={28} color="white" /></TouchableOpacity></View><CameraView style={styles.camera} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={({ data }) => handleQr(data)} /><Text style={styles.scannerHint}>Skieruj aparat na kod QR widoczny w aplikacji komputerowej.</Text></View></Modal>
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#1e293b", padding: 20, borderRadius: 12, borderColor: "#334155", borderWidth: 1 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  cardText: { color: "white", fontSize: 16, fontWeight: "bold" },
  subText: { color: "#94a3b8", fontSize: 14, marginBottom: 20, marginLeft: 24 },
  label: { color: "#cbd5e1", fontSize: 13, fontWeight: "600", marginBottom: 8 },
  input: { color: "white", backgroundColor: "#0f172a", borderColor: "#475569", borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15 },
  hint: { color: "#94a3b8", fontSize: 12, marginTop: 8, marginBottom: 16 },
  saveBtn: { backgroundColor: "#16a34a", padding: 13, borderRadius: 8, alignItems: "center", marginBottom: 10 },
  disabledBtn: { opacity: 0.55 },
  btn: { backgroundColor: "#3b82f6", padding: 12, borderRadius: 8, alignItems: "center" },
  btnText: { color: "white", fontWeight: "bold" },
  qrBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#0e7490", padding: 12, borderRadius: 8, marginBottom: 10 },
  scanner: { flex: 1, backgroundColor: "#020617", paddingTop: 45 }, scannerHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 18, paddingBottom: 16 }, scannerTitle: { color: "white", fontSize: 20, fontWeight: "700" }, camera: { flex: 1 }, scannerHint: { color: "#cbd5e1", textAlign: "center", padding: 20, fontSize: 14 },
});
