import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

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
};

export default function ConnectionSettingsCard({
  status, statusColor, serverUrl, pairingCode, isPairing, onServerUrlChange, onPairingCodeChange, onPair, onRefresh,
}: ConnectionSettingsCardProps) {
  return <View style={styles.card}>
    <View style={styles.statusRow}>
      <Ionicons name="ellipse" size={14} color={statusColor} />
      <Text style={styles.cardText}>Stan: {status}</Text>
    </View>
    <Text style={styles.subText}>1. Otwórz E‑Teczkę na komputerze.  2. Odczytaj kod w nagłówku.  3. Wpisz go poniżej.</Text>

    <Text style={styles.label}>Adres komputera E‑Teczka</Text>
    <TextInput value={serverUrl} onChangeText={onServerUrlChange} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="np. 192.168.0.15:3000" placeholderTextColor="#64748b" style={styles.input} />
    <Text style={styles.hint}>Dozwolone są wyłącznie adresy sieci lokalnej.</Text>

    <Text style={styles.label}>Kod z aplikacji desktopowej</Text>
    <TextInput value={pairingCode} onChangeText={onPairingCodeChange} keyboardType="number-pad" placeholder="Kod jednorazowy" placeholderTextColor="#64748b" style={styles.input} />

    <TouchableOpacity style={[styles.saveBtn, isPairing && styles.disabledBtn]} onPress={onPair} disabled={isPairing}>
      {isPairing ? <ActivityIndicator color="white" /> : <Text style={styles.btnText}>Połącz telefon z komputerem</Text>}
    </TouchableOpacity>
    <TouchableOpacity style={styles.btn} onPress={onRefresh} disabled={isPairing}>
      <Text style={styles.btnText}>Wymuś synchronizację</Text>
    </TouchableOpacity>
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
});
