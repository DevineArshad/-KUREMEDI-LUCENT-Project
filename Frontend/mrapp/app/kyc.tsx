import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getMe, submitKyc } from "@/src/api";
import { useAuth } from "@/src/context/AuthContext";
import type { User } from "@/src/context/AuthContext";

const SCREEN_TITLE = "MR Agent KYC";

type PickedFile = { uri: string; name: string; mimeType: string } | null;

export default function KycScreen() {
  const insets = useSafeAreaInsets();
  const { user, isAuthenticated, refreshUser, token } = useAuth();
  const [loading, setLoading] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);
  const [backendUser, setBackendUser] = useState<User | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [aadharNumber, setAadharNumber] = useState("");
  const [aadharDoc, setAadharDoc] = useState<PickedFile>(null);
  const [panNumber, setPanNumber] = useState("");
  const [panDoc, setPanDoc] = useState<PickedFile>(null);
  const [bankName, setBankName] = useState("");
  const [accountHolderName, setAccountHolderName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [ifscCode, setIfscCode] = useState("");
  const [cancelChequeDoc, setCancelChequeDoc] = useState<PickedFile>(null);

  const loadLatestProfile = async () => {
    setProfileLoading(true);
    setStatusMessage(null);
    try {
      const freshUser = (await getMe()) as User;
      setBackendUser(freshUser);
    } catch (err: unknown) {
      setBackendUser(user);
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setStatusMessage(message || "Showing your last saved KYC status while we reconnect to the server.");
    } finally {
      setProfileLoading(false);
    }
  };

  useEffect(() => {
    void loadLatestProfile();
  }, [user]);

  const latestUser = backendUser ?? user;
  const kycStatus = latestUser?.kyc || "BLANK";
  const rejectionReason = String(
    (latestUser as User & { kycRejectionReason?: string } | null)?.kycRejectionReason || ""
  ).trim();

  if (!isAuthenticated || !user) {
    return (
      <View style={[styles.centerScreen, { paddingTop: insets.top }]}>
        <Text style={styles.msgText}>Please login as MR (Agent) to access KYC</Text>
        <Pressable onPress={() => router.replace("/login")} style={styles.primaryBtn}>
          <Text style={styles.primaryBtnText}>Login</Text>
        </Pressable>
      </View>
    );
  }

  if (profileLoading) {
    return (
      <View style={[styles.centerScreen, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color="#0d9488" />
        <Text style={styles.msgText}>Checking your latest KYC status...</Text>
      </View>
    );
  }

  if (kycStatus === "APPROVED") {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={28} color="#111" />
        </Pressable>
        <View style={styles.approvedWrap}>
          <View style={styles.approvedIcon}>
            <Ionicons name="shield-checkmark" size={40} color="#059669" />
          </View>
          <Text style={styles.approvedTitle}>KYC Approved</Text>
          <Text style={styles.approvedSubtitle}>Your KYC verification is complete.</Text>
        </View>
      </View>
    );
  }

  if (kycStatus === "PENDING") {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerBack}>
            <Ionicons name="chevron-back" size={28} color="#111" />
          </Pressable>
          <Text style={styles.headerTitle}>{SCREEN_TITLE}</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.pendingWrap}>
          <View style={styles.pendingIcon}>
            <Ionicons name="time-outline" size={40} color="#b45309" />
          </View>
          <Text style={styles.pendingTitle}>KYC Pending</Text>
          <Text style={styles.pendingSubtitle}>
            Your documents are already submitted. The backend shows them as pending review.
          </Text>
          {statusMessage ? <Text style={styles.noticeText}>{statusMessage}</Text> : null}
          <View style={styles.pendingActions}>
            <Pressable onPress={() => void loadLatestProfile()} style={styles.secondaryBtn}>
              <Text style={styles.secondaryBtnText}>Check again</Text>
            </Pressable>
            <Pressable onPress={() => router.back()} style={styles.primaryBtn}>
              <Text style={styles.primaryBtnText}>Go back</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  const pickDocument = async (type: "aadhar" | "pan" | "cancelCheque"): Promise<void> => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["image/*", "application/pdf"],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const file = result.assets[0];
      const picked: PickedFile = {
        uri: file.uri,
        name: file.name || `doc-${type}.pdf`,
        mimeType: file.mimeType || "application/pdf",
      };
      if (type === "aadhar") setAadharDoc(picked);
      else if (type === "pan") setPanDoc(picked);
      else setCancelChequeDoc(picked);
    } catch {
      Alert.alert("Error", "Could not pick document");
    }
  };

  const handleSubmit = async () => {
    if (!token) {
      Alert.alert("Session expired", "Please log in again.");
      return;
    }

    try {
      setLoading(true);
      const formData = new FormData();
      const append = (key: string, value: string) => {
        if (value.length > 0) formData.append(key, value);
      };

      append("aadharNumber", aadharNumber.trim());
      append("panNumber", panNumber.trim());
      append("bankName", bankName.trim());
      append("accountHolderName", accountHolderName.trim());
      append("accountNumber", accountNumber.trim());
      append("ifscCode", ifscCode.trim());

      const filePart = (file: PickedFile) => {
        if (!file) return null;
        const uri = Platform.OS === "ios" ? file.uri.replace(/^file:\/\//, "") : file.uri;
        return { uri, name: file.name, type: file.mimeType } as unknown as Blob;
      };

      if (aadharDoc) {
        const part = filePart(aadharDoc);
        if (part) formData.append("aadharDoc", part);
      }
      if (panDoc) {
        const part = filePart(panDoc);
        if (part) formData.append("panDoc", part);
      }
      if (cancelChequeDoc) {
        const part = filePart(cancelChequeDoc);
        if (part) formData.append("cancelChequeDoc", part);
      }

      await submitKyc(formData, token);
      await refreshUser();
      await loadLatestProfile();
      Alert.alert("Success", "KYC submitted successfully. Status: Pending.");
    } catch (err: unknown) {
      const ax = err as {
        response?: { status?: number; data?: { message?: string } };
        message?: string;
        code?: string;
      };
      const isNetworkError =
        !ax?.response &&
        (ax?.message === "Network Error" || ax?.code === "ECONNABORTED" || ax?.code === "ERR_NETWORK");
      const msg =
        ax?.response?.data?.message ||
        (ax?.response?.status === 413 ? "Files too large (max 5MB each)" : null) ||
        (ax?.response?.status === 401 ? "Please log in again" : null) ||
        (ax?.response?.status ? `Request failed (${ax.response.status})` : null) ||
        (isNetworkError
          ? "Cannot reach server. Check Wi‑Fi, ensure the server is running, and try again."
          : null) ||
        ax?.message ||
        "Failed to submit KYC. Check network and try again.";
      Alert.alert("KYC submit failed", msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerBack}>
          <Ionicons name="chevron-back" size={28} color="#111" />
        </Pressable>
        <Text style={styles.headerTitle}>{SCREEN_TITLE}</Text>
        <View style={styles.headerSpacer} />
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.keyboard}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24 }}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.hint}>MR Agent KYC: Aadhar, PAN and bank details with cancel cheque document.</Text>
          {statusMessage ? <Text style={styles.noticeText}>{statusMessage}</Text> : null}
          {kycStatus === "REJECTED" ? (
            <View style={styles.rejectedCard}>
              <Text style={styles.rejectedTitle}>KYC Rejected</Text>
              <Text style={styles.rejectedText}>
                {rejectionReason || "Please review your details and submit the corrected documents again."}
              </Text>
            </View>
          ) : null}
          <Text style={styles.sectionTitle}>Identity – Aadhar</Text>
          <View style={styles.fieldCard}>
            <Text style={styles.label}>Aadhar Number</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter Aadhar number"
              placeholderTextColor="#9ca3af"
              value={aadharNumber}
              onChangeText={setAadharNumber}
              keyboardType="number-pad"
            />
            <Pressable onPress={() => pickDocument("aadhar")} style={styles.docBtn}>
              <Ionicons name="document-attach" size={20} color="#0d9488" />
              <Text style={styles.docBtnText}>{aadharDoc ? aadharDoc.name : "Upload Aadhar document"}</Text>
            </Pressable>
          </View>
          <Text style={styles.sectionTitle}>Identity – PAN</Text>
          <View style={styles.fieldCard}>
            <Text style={styles.label}>PAN Number</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter PAN number"
              placeholderTextColor="#9ca3af"
              value={panNumber}
              onChangeText={setPanNumber}
              autoCapitalize="characters"
            />
            <Pressable onPress={() => pickDocument("pan")} style={styles.docBtn}>
              <Ionicons name="document-attach" size={20} color="#0d9488" />
              <Text style={styles.docBtnText}>{panDoc ? panDoc.name : "Upload PAN document"}</Text>
            </Pressable>
          </View>
          <Text style={styles.sectionTitle}>Bank details</Text>
          <View style={styles.fieldCard}>
            <Text style={styles.label}>Bank Name</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. SBI, HDFC"
              placeholderTextColor="#9ca3af"
              value={bankName}
              onChangeText={setBankName}
            />
          </View>
          <View style={styles.fieldCard}>
            <Text style={styles.label}>Account Holder Name</Text>
            <TextInput
              style={styles.input}
              placeholder="As per bank account"
              placeholderTextColor="#9ca3af"
              value={accountHolderName}
              onChangeText={setAccountHolderName}
            />
          </View>
          <View style={styles.fieldCard}>
            <Text style={styles.label}>Account Number</Text>
            <TextInput
              style={styles.input}
              placeholder="Bank account number"
              placeholderTextColor="#9ca3af"
              value={accountNumber}
              onChangeText={setAccountNumber}
              keyboardType="number-pad"
            />
          </View>
          <View style={styles.fieldCard}>
            <Text style={styles.label}>IFSC Code</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. SBIN0001234"
              placeholderTextColor="#9ca3af"
              value={ifscCode}
              onChangeText={setIfscCode}
              autoCapitalize="characters"
            />
          </View>
          <Text style={styles.sectionTitle}>Bank document</Text>
          <View style={styles.fieldCard}>
            <Text style={styles.label}>Cancel cheque / passbook</Text>
            <Pressable onPress={() => pickDocument("cancelCheque")} style={styles.docBtn}>
              <Ionicons name="document-attach" size={20} color="#0d9488" />
              <Text style={styles.docBtnText}>
                {cancelChequeDoc ? cancelChequeDoc.name : "Upload cancel cheque or passbook"}
              </Text>
            </Pressable>
          </View>
          <Pressable onPress={handleSubmit} disabled={loading} style={styles.submitBtn}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Submit KYC</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  centerScreen: {
    flex: 1,
    backgroundColor: "#f0f9ff",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  msgText: { color: "#6b7280", marginBottom: 16, textAlign: "center" },
  primaryBtn: {
    backgroundColor: "#0d9488",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  primaryBtnText: { color: "#fff", fontWeight: "600" },
  screen: { flex: 1, backgroundColor: "#f0f9ff" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0f2fe",
  },
  headerBack: { padding: 4 },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "600",
    color: "#000",
    textAlign: "center",
    marginLeft: -36,
  },
  headerSpacer: { width: 36 },
  backBtn: { paddingVertical: 8, paddingHorizontal: 16 },
  approvedWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  approvedIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#d1fae5",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  approvedTitle: { fontSize: 20, fontWeight: "700", color: "#000" },
  approvedSubtitle: { color: "#6b7280", marginTop: 8, textAlign: "center" },
  pendingWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
  pendingIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#fef3c7",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  pendingTitle: { fontSize: 20, fontWeight: "700", color: "#111", textAlign: "center" },
  pendingSubtitle: { color: "#6b7280", marginTop: 8, textAlign: "center", lineHeight: 20 },
  pendingActions: { flexDirection: "row", gap: 12, marginTop: 20 },
  secondaryBtn: {
    backgroundColor: "#fff",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#cbd5e1",
  },
  secondaryBtnText: { color: "#111", fontWeight: "600" },
  noticeText: {
    color: "#0f172a",
    backgroundColor: "#e0f2fe",
    borderColor: "#bae6fd",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
    lineHeight: 20,
  },
  rejectedCard: {
    backgroundColor: "#fef2f2",
    borderColor: "#fecaca",
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  rejectedTitle: { fontSize: 15, fontWeight: "700", color: "#b91c1c", marginBottom: 6 },
  rejectedText: { color: "#7f1d1d", lineHeight: 20 },
  keyboard: { flex: 1 },
  scroll: { flex: 1 },
  hint: { color: "#6b7280", fontSize: 14, marginBottom: 16 },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#0d9488",
    marginBottom: 8,
    marginTop: 8,
  },
  fieldCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#e0f2fe",
  },
  label: { fontSize: 14, fontWeight: "500", color: "#374151", marginBottom: 8 },
  input: {
    backgroundColor: "#f8fafc",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
  },
  docBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: "#f0fdfa",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#99f6e4",
  },
  docBtnText: { fontSize: 14, color: "#0d9488", flex: 1 },
  submitBtn: {
    backgroundColor: "#0d9488",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 8,
  },
  submitBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});