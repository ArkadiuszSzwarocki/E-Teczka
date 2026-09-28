import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export type RetentionAlert = { id: number; title: string; text: string; level: "urgent" | "soon" };

type RetentionAlertsCardProps = {
  alerts: RetentionAlert[];
  loading: boolean;
  onRefresh: () => void;
};

export default function RetentionAlertsCard({ alerts, loading, onRefresh }: RetentionAlertsCardProps) {
  return <View style={styles.card}>
    <View style={styles.header}>
      <Ionicons name="notifications" size={22} color="#fbbf24" />
      <Text style={styles.title}>Terminy życia dokumentów</Text>
      <View style={styles.count}><Text style={styles.countText}>{alerts.length}</Text></View>
    </View>
    <Text style={styles.intro}>Scalone przypomnienia z wszystkich kartotek.</Text>
    {loading ? <ActivityIndicator color="#fbbf24" /> : alerts.length === 0
      ? <Text style={styles.empty}>Brak dokumentów z terminem w ciągu 6 miesięcy.</Text>
      : <View style={styles.list}>{alerts.slice(0, 5).map((item) => <View key={item.id} style={[styles.row, item.level === "urgent" && styles.urgent]}>
        <Ionicons name={item.level === "urgent" ? "warning" : "time-outline"} size={16} color={item.level === "urgent" ? "#fecaca" : "#fde68a"} />
        <View style={styles.rowContent}><Text numberOfLines={1} style={styles.rowTitle}>{item.title}</Text><Text style={styles.rowText}>{item.text}</Text></View>
      </View>)}</View>}
    <TouchableOpacity style={styles.refresh} onPress={onRefresh}><Text style={styles.buttonText}>Odśwież powiadomienia</Text></TouchableOpacity>
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#422006", padding: 16, borderRadius: 12, borderColor: "#b45309", borderWidth: 1, gap: 10 },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { color: "white", fontSize: 17, fontWeight: "bold" },
  count: { marginLeft: "auto", minWidth: 24, height: 24, paddingHorizontal: 7, borderRadius: 12, backgroundColor: "#dc2626", alignItems: "center", justifyContent: "center" },
  countText: { color: "white", fontWeight: "800", fontSize: 12 },
  intro: { color: "#fde68a", fontSize: 12 }, empty: { color: "#fde68a", fontSize: 12 }, list: { gap: 7 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, padding: 9, borderRadius: 7, backgroundColor: "#78350f" }, urgent: { backgroundColor: "#991b1b" }, rowContent: { flex: 1 },
  rowTitle: { color: "white", fontSize: 12, fontWeight: "700" }, rowText: { color: "#fde68a", fontSize: 11, marginTop: 1 },
  refresh: { backgroundColor: "#b45309", padding: 10, borderRadius: 7, alignItems: "center" }, buttonText: { color: "white", fontWeight: "bold" },
});
