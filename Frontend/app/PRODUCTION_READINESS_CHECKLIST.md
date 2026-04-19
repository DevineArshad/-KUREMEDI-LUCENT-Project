# Kuremedi Android Production Readiness Checklist

This checklist is intended to be completed after generating a production AAB via EAS.

## 1) Build and Signing Verification

1. Confirm Expo account and project:
   - `npx eas whoami`
   - `npx eas project:info`
2. Confirm Android build profile uses app bundle:
   - Check `eas.json` -> `build.production.android.buildType` is `app-bundle`.
3. Confirm release uses your intended keystore:
   - `npx eas credentials -p android`
   - Verify Android Keystore fingerprint/metadata corresponds to your JKS:
     - `D:\Ankur Kushwaha\Downloads\@anmol1002__kuremedi.jks`
4. Start production build:
   - `npx eas build -p android --profile production`
5. Download AAB and verify artifact in Expo dashboard build details.

## 2) Backend API Smoke Tests (Production URL)

Base URL used by app:
- `https://backend.kuremedi.com/api`

Run from PowerShell:

```powershell
$BASE = "https://backend.kuremedi.com/api"

# Public endpoints
Invoke-WebRequest -Uri "$BASE/products" -Method GET
Invoke-WebRequest -Uri "$BASE/categories" -Method GET
Invoke-WebRequest -Uri "$BASE/brands" -Method GET
Invoke-WebRequest -Uri "$BASE/config/referral-amount" -Method GET
Invoke-WebRequest -Uri "$BASE/config/minimum-checkout-amount" -Method GET
Invoke-WebRequest -Uri "$BASE/config/refund-policy" -Method GET
Invoke-WebRequest -Uri "$BASE/marketing/banners" -Method GET

# Root service health (backend index route)
Invoke-WebRequest -Uri "https://backend.kuremedi.com/" -Method GET
```

Expected result: all calls return `2xx`, valid JSON payloads, and no CORS/network failures.

## 3) Auth + User Journey Prompts (Manual QA)

Use these prompts with QA testers while testing release build on real Android devices.

1. New user onboarding:
   - "Send OTP to a valid phone, verify OTP, complete registration, then relaunch app and confirm session persists."
2. Existing user login:
   - "Login with email/password, then open profile and verify user data loads from `/auth/me`."
3. Profile/KYC:
   - "Upload KYC documents (PDF/JPG/PNG), verify success toast, and confirm KYC state updates after refresh."
4. Product discovery:
   - "Open home and category screens, apply category/brand/search filters, and open multiple product detail pages."
5. Cart and address:
   - "Add products, update quantity, remove item, clear cart, add a new address, and set default delivery details."
6. Wallet flow:
   - "Open wallet, validate balance and transactions render, then create/verify a wallet recharge payment."
7. Checkout (COD + online):
   - "Place one COD order and one Razorpay online order, verify order appears in My Orders with correct status."
8. Order tracking:
   - "Open order tracking and confirm shipment/tracking data loads when available."
9. Support:
   - "Create support ticket, post chat message, and verify ticket list/detail updates."
10. Push notifications:
    - "Register push token and verify at least one notification scenario in production environment."

## 4) Admin/Backend Operational Prompts

1. "From admin panel, confirm the new app orders appear and status transitions PLACED -> CONFIRMED -> DISPATCHED -> DELIVERED work."
2. "Test cancellation/refund path once for COD and once for online payment; verify wallet/razorpay refund behavior is correct."
3. "Check Shiprocket balance endpoint and confirm low-balance warning behavior if balance is below threshold."
4. "Verify support ticket raised from app is visible and reply workflow works from admin."

## 5) Pre-Play Store Gate (Must Pass)

- No crashes across cold start, login, product browse, cart, checkout, support, and profile screens.
- No blocking API failures in app logs for primary flows.
- Signed AAB produced with release keystore intended for Play Console updates.
- Version code incremented for upload (`eas production autoIncrement` covers this).
- Privacy policy URL, support email, and app content declarations in Play Console are updated.
- Test on at least:
  - One low-memory Android device
  - One recent Android version device
  - One slow-network scenario (3G/unstable)

## 6) Suggested Final Commands

```powershell
# From Frontend/app
npx eas whoami
npx eas credentials -p android
npx eas build -p android --profile production
```

Then in Expo dashboard:
1. Open build details
2. Download `.aab`
3. Upload to Play Console internal testing
4. Run internal QA sign-off before production rollout

## 7) Important Signing Note (Fresh Key)

- If this app is already published on Google Play, you can only upload updates signed with the existing upload key (or request an upload key reset in Play Console if Play App Signing is enabled).
- If this is the first Play Store release for this package (`com.digimese.kuremedi`), the new EAS-generated key is fine.
- Save keystore details from Expo credentials securely for future updates:
   - `npx eas credentials -p android` (view fingerprints)
   - Use "Download existing keystore" in credentials menu and store it in a secure password manager/vault.

### If Play Console says "signed with wrong key"

This means Google is expecting your old upload certificate for this package, but your new AAB is signed with a new EAS keystore.

1. Download current EAS keystore files:
   - `npx eas credentials -p android`
   - Select `production` profile.
   - Go to `Keystore` -> `Download existing keystore`.
   - Keep both files safe (usually `.jks` and `.json` with alias/password).
2. Export upload certificate PEM from that keystore:

```powershell
keytool -export -rfc -alias <YOUR_ALIAS> -file upload_certificate.pem -keystore <PATH_TO_DOWNLOADED_JKS>
```

3. In Play Console go to:
   - `Setup` -> `App integrity` -> `App signing` -> `Request upload key reset`.
   - Upload `upload_certificate.pem`.
4. Wait for Google to approve and activate the new upload key (can take some time).
5. Re-upload latest AAB after reset is active.

Tip: if you still have access to old keystore + password, use that key instead and no reset is required.
