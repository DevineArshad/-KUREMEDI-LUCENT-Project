import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { APP_NAME } from '@/src/constants/app';
import { sendOtp, verifyOtp, completeRegistration } from '@/src/api';
import { useAuth } from '@/src/context/AuthContext';
import type { User } from '@/src/context/AuthContext';

type Step = 'mobile' | 'otp' | 'register';

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { login } = useAuth();
  const [step, setStep] = useState<Step>('mobile');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [tempToken, setTempToken] = useState<string | null>(null);

  const formatPhone = (val: string) => val.replace(/\D/g, '').slice(0, 10);

  const handleSendOTP = async () => {
    const cleaned = formatPhone(phone);
    if (cleaned.length < 10) {
      Alert.alert('Invalid', 'Enter a valid 10-digit mobile number');
      return;
    }
    try {
      setLoading(true);
      await sendOtp(cleaned);
      setPhone(cleaned);
      setStep('otp');
      setOtp('');
      setTempToken(null);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Failed to send OTP';
      Alert.alert('Error', msg);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = async () => {
    const code = otp.replace(/\D/g, '').slice(0, 6);
    if (code.length !== 6) {
      Alert.alert('Invalid', 'Enter the full 6-digit OTP sent to your number');
      return;
    }
    try {
      setLoading(true);
      const res = await verifyOtp(phone, code);
      if (res.needsRegistration) {
        setTempToken(res.tempToken);
        setStep('register');
      } else if (res.user && res.token) {
        await login(res.token, res.user as User);
        const u = res.user as User;
        if (u.kyc !== 'APPROVED') router.replace('/kyc');
        else router.replace('/(tabs)');
      } else {
        Alert.alert('Error', 'Invalid response from server');
      }
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Invalid OTP. Please try again.';
      Alert.alert('Error', msg);
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteRegistration = async () => {
    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedName || !trimmedEmail) {
      Alert.alert('Required', 'Name and email are required');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      Alert.alert('Invalid', 'Enter a valid email address');
      return;
    }
    if (!tempToken) {
      Alert.alert('Error', 'Session expired. Please start again.');
      return;
    }
    try {
      setLoading(true);
      const res = await completeRegistration(tempToken, {
        name: trimmedName,
        email: trimmedEmail,
        referralCode: referralCode.trim() || undefined,
      });
      if (res.user && res.token) {
        await login(res.token, res.user as User);
        const u = res.user as User;
        if (u.kyc !== 'APPROVED') router.replace('/kyc');
        else router.replace('/(tabs)');
      } else {
        Alert.alert('Error', 'Registration failed');
      }
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Registration failed. Please try again.';
      Alert.alert('Error', msg);
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    if (step === 'otp') {
      setStep('mobile');
      setOtp('');
    } else if (step === 'register') {
      setStep('otp');
      setTempToken(null);
    } else {
      router.back();
    }
  };

  const PrimaryButton = ({
    onPress,
    disabled,
    label,
    loading: btnLoading,
  }: { onPress: () => void; disabled?: boolean; label: string; loading?: boolean }) => (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.primaryBtn, (disabled || btnLoading) && styles.primaryBtnDisabled]}
    >
      {btnLoading ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <Text style={styles.primaryBtnText}>{label}</Text>
      )}
    </Pressable>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboard}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <Pressable onPress={handleBack} style={styles.backBtn}>
              <Ionicons name="chevron-back" size={28} color="#111" />
            </Pressable>
          </View>

          {/* Logo / app icon */}
          <View style={styles.logoWrap}>
            <Image
              source={require('@/assets/images/icon.png')}
              style={styles.logoIconImage}
              resizeMode="contain"
            />
            <Text style={styles.hello}>Hello there!</Text>
            <Text style={styles.welcome}>Welcome</Text>
            <Text style={styles.agentLabel}>Sign in as MR (Agent)</Text>
          </View>

          <View style={styles.card}>
            {step === 'mobile' && (
              <>
                <Text style={styles.cardTitle}>Sign in to continue with your mobile number</Text>
                <View style={styles.inputRow}>
                  <View style={styles.countryCode}>
                    <Text style={styles.countryCodeText}>+91</Text>
                  </View>
                  <TextInput
                    style={styles.mobileInput}
                    placeholder="Enter your mobile number"
                    placeholderTextColor="#9ca3af"
                    keyboardType="phone-pad"
                    maxLength={10}
                    value={phone}
                    onChangeText={(t) => setPhone(formatPhone(t))}
                    editable={!loading}
                    autoFocus
                  />
                </View>
                <Text style={styles.otpNote}>
                  A real-time 6 digit OTP will be sent via SMS to verify your mobile number.
                </Text>
                <PrimaryButton
                  onPress={handleSendOTP}
                  disabled={loading}
                  label="Sign In"
                  loading={loading}
                />
              </>
            )}

            {step === 'otp' && (
              <>
                <Text style={styles.cardTitle}>Verification</Text>
                <Text style={styles.otpSubtitle}>
                  We will send you a One Time Password on your phone number
                </Text>
                <Text style={styles.phoneDisplay}>+91 {phone}</Text>
                <View style={styles.otpBoxWrap}>
                  <TextInput
                    style={styles.otpInput}
                    placeholder="Enter OTP"
                    placeholderTextColor="#9ca3af"
                    keyboardType="number-pad"
                    maxLength={6}
                    value={otp}
                    onChangeText={setOtp}
                    editable={!loading}
                    autoFocus
                  />
                </View>
                <PrimaryButton
                  onPress={handleVerifyOTP}
                  disabled={loading}
                  label="Verify"
                  loading={loading}
                />
                <Pressable onPress={handleSendOTP} disabled={loading} style={styles.resendWrap}>
                  <Text style={styles.resendLabel}>Didnt receive the verification OTP? </Text>
                  <Text style={styles.resendLink}>Resend again</Text>
                </Pressable>
              </>
            )}

            {step === 'register' && (
              <>
                <Text style={styles.cardTitle}>Complete your profile</Text>
                <Text style={styles.otpSubtitle}>Enter your name and email to continue</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="Full Name"
                  placeholderTextColor="#9ca3af"
                  value={name}
                  onChangeText={setName}
                  editable={!loading}
                />
                <TextInput
                  style={styles.textInput}
                  placeholder="Email"
                  placeholderTextColor="#9ca3af"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  value={email}
                  onChangeText={setEmail}
                  editable={!loading}
                />
                <TextInput
                  style={styles.textInput}
                  placeholder="Referral Code (optional)"
                  placeholderTextColor="#9ca3af"
                  autoCapitalize="characters"
                  value={referralCode}
                  onChangeText={setReferralCode}
                  editable={!loading}
                />
                <PrimaryButton
                  onPress={handleCompleteRegistration}
                  disabled={loading}
                  label="Sign Up"
                  loading={loading}
                />
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f9ff' },
  keyboard: { flex: 1 },
  scroll: { flex: 1 },
  header: { paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { padding: 4, alignSelf: 'flex-start' },
  logoWrap: { alignItems: 'center', marginBottom: 24, paddingHorizontal: 24 },
  logoIcon: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  logoIconImage: {
    width: 64,
    height: 64,
    marginBottom: 16,
  },
  hello: { fontSize: 24, fontWeight: '700', color: '#111' },
  welcome: { fontSize: 16, color: '#6b7280', marginTop: 4 },
  agentLabel: { fontSize: 12, color: '#9ca3af', marginTop: 6 },
  card: {
    backgroundColor: '#fff',
    marginHorizontal: 20,
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: '#e0f2fe',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#111', marginBottom: 8 },
  otpSubtitle: { fontSize: 14, color: '#6b7280', marginBottom: 16 },
  inputRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, marginBottom: 12, overflow: 'hidden' },
  countryCode: { paddingHorizontal: 16, paddingVertical: 16, backgroundColor: '#f8fafc', borderRightWidth: 1, borderRightColor: '#e5e7eb' },
  countryCodeText: { fontSize: 16, fontWeight: '600', color: '#374151' },
  mobileInput: { flex: 1, paddingHorizontal: 16, paddingVertical: 16, fontSize: 16, color: '#111' },
  otpNote: { fontSize: 13, color: '#9ca3af', marginBottom: 20 },
  primaryBtn: {
    marginTop: 4,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    borderRadius: 12,
    backgroundColor: '#0d9488',
  },
  primaryBtnDisabled: { opacity: 0.7 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  phoneDisplay: { fontSize: 15, color: '#374151', marginBottom: 12 },
  otpBoxWrap: { marginBottom: 12 },
  otpInput: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 16,
    fontSize: 18,
    textAlign: 'center',
    letterSpacing: 8,
    color: '#111',
  },
  resendWrap: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: 16, alignItems: 'center' },
  resendLabel: { fontSize: 14, color: '#6b7280' },
  resendLink: { fontSize: 14, color: '#0d9488', fontWeight: '600' },
  textInput: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 16,
    color: '#111',
    marginBottom: 12,
  },
});
