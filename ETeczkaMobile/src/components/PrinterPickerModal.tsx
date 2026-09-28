import { ActivityIndicator, Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { PrinterDevice } from "../services/printerScan";

type PrinterPickerModalProps = {
  visible: boolean;
  loading: boolean;
  devices: PrinterDevice[];
  mode: "new-page" | "new-document";
  onSelect: (deviceId: string) => void;
  onClose: () => void;
};

export default function PrinterPickerModal({
  visible,
  loading,
  devices,
  mode,
  onSelect,
  onClose,
}: PrinterPickerModalProps) {
  const newPage = mode === "new-page";

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{newPage ? "Dodaj stronę z drukarki" : "Wybierz skaner"}</Text>
          <Text style={styles.intro}>
            {newPage
              ? "Skan trafi do tej samej wersji roboczej i zostanie scalony z pozostałymi stronami."
              : "Komputer wykona skan i zapisze go w wybranej podkartotece."}
          </Text>
          {loading ? (
            <ActivityIndicator color="#60a5fa" style={styles.loader} />
          ) : devices.length ? (
            devices.map((device) => (
              <TouchableOpacity key={device.id} style={styles.choice} onPress={() => onSelect(device.id)}>
                <Ionicons name="print" size={23} color="#60a5fa" />
                <View style={styles.deviceText}>
                  <Text style={styles.name}>{device.name}</Text>
                  {device.manufacturer ? <Text style={styles.manufacturer}>{device.manufacturer}</Text> : null}
                </View>
                <Ionicons name="chevron-forward" size={19} color="#64748b" />
              </TouchableOpacity>
            ))
          ) : (
            <Text style={styles.warning}>Nie znaleziono skanera WIA.</Text>
          )}
          <TouchableOpacity style={styles.cancel} onPress={onClose} disabled={loading}>
            <Text style={styles.cancelText}>Anuluj</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(2,6,23,0.72)" },
  card: { margin: 18, borderRadius: 16, backgroundColor: "#1e293b", borderWidth: 1, borderColor: "#475569", padding: 18 },
  title: { color: "white", fontSize: 19, fontWeight: "800" },
  intro: { color: "#94a3b8", fontSize: 13, lineHeight: 19, marginTop: 7, marginBottom: 16 },
  loader: { marginVertical: 26 },
  choice: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#0f172a", borderColor: "#334155", borderWidth: 1, borderRadius: 10, padding: 13, marginBottom: 9 },
  deviceText: { flex: 1 },
  name: { color: "white", fontWeight: "700", fontSize: 14 },
  manufacturer: { color: "#94a3b8", fontSize: 11, marginTop: 2 },
  warning: { color: "#fbbf24", fontSize: 13, textAlign: "center", marginVertical: 16 },
  cancel: { alignItems: "center", padding: 13, marginTop: 5 },
  cancelText: { color: "#cbd5e1", fontWeight: "700" },
});
