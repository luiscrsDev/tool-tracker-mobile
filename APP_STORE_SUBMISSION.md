# App Store Submission Guide

## Pre-Submission Checklist

### Code Quality
- [ ] No console errors in production
- [ ] Linting passes: `npm run lint`
- [ ] No memory leaks detected
- [ ] All async operations properly cancelled on unmount
- [ ] No sensitive data logged

### Testing
- [ ] All features tested on real device (iPhone + Android)
- [ ] Offline mode tested and working
- [ ] Cache validation tested
- [ ] Error handling tested
- [ ] Network retry logic verified
- [ ] Bluetooth pairing tested with real AirTag
- [ ] GPS tracking tested outdoors
- [ ] Admin features fully functional

### App Configuration
- [ ] app.json updated with all permissions
- [ ] iOS bundle identifier set
- [ ] Android package name set
- [ ] Version numbers updated (1.0.0)
- [ ] All icons/splash screens in place

### Permissions
- [ ] iOS location permissions configured
- [ ] iOS Bluetooth permissions configured
- [ ] iOS background modes enabled
- [ ] Android permissions declared
- [ ] Runtime permissions handled gracefully

### Data & Security
- [ ] Supabase environment configured
- [ ] API keys in environment variables (not hardcoded)
- [ ] No test data in production
- [ ] User sessions properly managed
- [ ] Authentication tokens encrypted

### Performance
- [ ] App load time < 3s
- [ ] Dashboard renders within 2s
- [ ] Cache hit response time < 100ms
- [ ] Handles 100+ tools without lag
- [ ] Memory usage stable over 10+ minutes

### Accessibility
- [ ] Text sizes readable (min 14pt)
- [ ] Color contrast WCAG AA compliant
- [ ] Touch targets min 44x44pt
- [ ] Screen reader compatible

---

## iOS App Store Submission

### 1. Prepare Apple Developer Account
```bash
# Required files:
# - Apple Developer Program membership ($99/year)
# - App Store Connect access
# - Xcode installed (Mac only)
# - Certificate & provisioning profile
```

### 2. Build for iOS
```bash
# Using Expo
expo prebuild --platform ios

# Or managed build
eas build --platform ios --auto-submit
```

### 3. Complete App Store Connect Info

**App Information:**
- [ ] App name: "Tool Tracker"
- [ ] Subtitle: "Rastreamento de Ferramentas em Tempo Real"
- [ ] Description (4-170 chars):
  ```
  Rastreie suas ferramentas em tempo real com AirTag.
  Conecte, localize e gerencie toda sua frota.
  ```

**Keywords:** airtag, rastreamento, ferramentas, gps, bluetooth, localização

**Support URL:** https://tooltracker.com/support

**Privacy Policy URL:** https://tooltracker.com/privacy

**Support Email:** support@tooltracker.com

### 4. Rating Information
- [ ] Alcohol/Tobacco: No
- [ ] Gambling: No
- [ ] Hate Speech: No
- [ ] Medical: No
- [ ] Intense Violence: No
- [ ] Horror/Scary: No
- [ ] Location Data: Yes (required for GPS tracking)

### 5. App Review Information

**Notes for Reviewer:**
```
Tool Tracker is a real-time tool tracking application using AirTag
and GPS technology. The app requires location and Bluetooth permissions
to function. All permissions are used solely for tracking tools as
described in the app description.

Test account:
- Email: demo@tooltracker.com
- Password: DemoPassword123!

Main features:
1. AirTag pairing and Bluetooth scanning
2. Real-time GPS location tracking
3. Admin dashboard for contractor management
4. Alert system for tool status

No third-party SDKs used. All data stored in Supabase (GDPR compliant).
```

### 6. Submission Steps
1. Go to App Store Connect
2. Select "My Apps" → "Tool Tracker"
3. Complete all required fields (screenshots, preview, etc.)
4. Select build (from EAS Build or local)
5. Submit for review

**Expected Review Time:** 24-48 hours

### 7. Screenshots (Required)
- [ ] iPhone 6.7" (e.g., iPhone 14 Pro Max): 5 screenshots
  - Login screen
  - Dashboard
  - Tools list
  - AirTag pairing
  - Tracking map

- [ ] iPhone 5.5" (e.g., iPhone SE): 5 screenshots (same)

- [ ] iPad (if supporting): 5 screenshots

**Screenshot Guidelines:**
- 72 DPI minimum
- No device bezels
- Text legible
- Showcase core features

---

## Google Play Store Submission

### 1. Prepare Google Developer Account
```bash
# Required:
# - Google Play Developer account ($25 one-time)
# - Google Play Console access
# - Android signing keystore
```

### 2. Create Signing Key
```bash
# Generate keystore (first time only)
keytool -genkey -v -keystore ~/key.jks \
  -alias tooltracker -keyalg RSA -keysize 2048 -validity 10000

# Configure in EAS
eas credentials
# Follow prompts to set keystore
```

### 3. Build for Android
```bash
# Using EAS
eas build --platform android --auto-submit

# Or local:
expo prebuild --platform android
./gradlew build
```

### 4. Complete Play Console Info

**Store Listing:**
- [ ] App name: "Tool Tracker"
- [ ] Short description (30 chars max):
  ```
  Rastreie ferramentas com AirTag e GPS
  ```
- [ ] Full description:
  ```
  Rastreie suas ferramentas em tempo real usando AirTag e GPS.
  Gerencie sua frota, receba alertas de desconexão e acompanhe
  localização em tempo real.

  Recursos:
  • Emparelhamento automático de AirTag via Bluetooth
  • Rastreamento GPS em tempo real
  • Dashboard do administrador
  • Sistema de alertas
  • Modo offline com sincronização automática

  Privacidade: Todos os dados são criptografados e armazenados
  em Supabase (GDPR compliant).
  ```

### 5. Content Rating Questionnaire
- [ ] Complete IARC questionnaire
- [ ] Select rating: Usually "Everyone" (T if alerts show harsh language)

### 6. Privacy Policy
- [ ] Link to privacy policy
- [ ] Explain data usage (location, Bluetooth)
- [ ] Explain data storage (Supabase)

### 7. App Category
- **Category:** Tools
- **Content Rating:** Everyone

### 8. Screenshots
- [ ] Phone (5.4" - 6.7"): 8 screenshots
- [ ] 7" Tablet: 8 screenshots (if supporting)
- [ ] 10" Tablet: 8 screenshots (if supporting)

**Screenshot Requirements:**
- PNG or JPEG
- 1080x1920 pixels (phone)
- No watermarks

### 9. Feature Graphic (Optional)
- [ ] 1024x500 pixels
- [ ] Showcase app value proposition

### 10. Submission Steps
1. Go to Google Play Console
2. Create new app "Tool Tracker"
3. Complete all store listing fields
4. Upload APK (or AAB from EAS)
5. Review content rating
6. Accept agreements
7. Submit for review

**Expected Review Time:** 2-4 hours (usually same day)

---

## Post-Submission

### Monitor Review Status
**iOS App Store Connect:**
- Check daily in "App Review" section
- Status: Processing → Pending Review → Approved/Rejected

**Google Play Console:**
- Check "Release" section
- Status: Uploading → Processing → Published

### Common Rejection Reasons

**iOS:**
- Missing privacy policy details
- Unclear permission usage
- Bugs in core features
- App crashes on launch
- Sensitive data stored unencrypted

**Android:**
- Missing content rating
- Incomplete privacy policy
- Targeting wrong API level
- Missing required permissions

### If Rejected
1. Read rejection reason carefully
2. Fix the issue
3. Increment version (1.0.1)
4. Rebuild and resubmit
5. Allow 24h between submissions

### After Approval

**Launch Checklist:**
- [ ] Announce on social media
- [ ] Send email to beta testers
- [ ] Monitor ratings and reviews
- [ ] Fix critical bugs immediately
- [ ] Plan version 1.1 improvements

**Monitor Metrics:**
- Downloads/installs
- Crash rates
- User ratings
- Review comments
- Retention rate

---

## Environment Setup for Submission

### iOS Credentials
```bash
# Install EAS CLI
npm install -g eas-cli

# Configure iOS credentials
eas credentials configure --platform ios

# Provides:
# - Apple ID (your developer account email)
# - Team ID (from Apple Developer account)
# - Bundle ID (com.tooltracker.mobile)
# - Signing certificate & profile
```

### Android Credentials
```bash
# Configure Android credentials
eas credentials configure --platform android

# Provides:
# - Signing keystore
# - Key alias
# - Key password
# - Store password
```

### Environment Variables
```bash
# Create .env.production (never commit!)
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SENTRY_DSN=https://your-sentry-dsn  # Optional: error tracking
```

---

## Version Management

### Semantic Versioning
- **1.0.0** - Initial release (done!)
- **1.0.1** - Bug fixes
- **1.1.0** - New features
- **2.0.0** - Major breaking changes

### Update Process
```bash
# Update version in app.json
# Update version in package.json
# Create git tag
git tag -a v1.0.0 -m "Release 1.0.0"
git push origin v1.0.0

# For subsequent versions
npm version patch  # 1.0.1
npm version minor  # 1.1.0
npm version major  # 2.0.0
```

---

## Monitoring & Analytics

### Add Error Tracking (Optional)
```bash
npm install sentry-expo

# Configure in app root
import * as Sentry from 'sentry-expo';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enableInExpoDevelopment: true,
});
```

### Supabase Analytics
- Monitor active users
- Track feature usage
- Identify bottlenecks
- Watch error rates

### App Store Metrics
- iOS: App Store Connect → Analytics
- Android: Google Play Console → Metrics

---

## Release Notes Template

### Version 1.0.0 - Launch 🚀
**New:**
- AirTag pairing via Bluetooth
- Real-time GPS tracking
- Contractor dashboard
- Admin management panel
- Offline support with auto-sync
- Smart caching system
- Automatic retry on network failures

**Fixed:**
- N/A (initial release)

**Known Issues:**
- Maps open in external Google Maps app (by design)
- Background tracking requires iOS Background Modes
- Bluetooth range limited to ~100 meters

---

## Support & Escalation

### If Build Fails
```bash
# Clear cache
eas cache --platform ios --clear
eas cache --platform android --clear

# Rebuild
eas build --platform ios --auto-submit
```

### Contact Support
- **Expo Support:** https://expo.canny.io/
- **Supabase Support:** https://supabase.com/support
- **Apple Developer:** https://developer.apple.com/support/
- **Google Play:** https://support.google.com/googleplay/android-developer/

---

## Final Checklist

- [ ] All code committed to git
- [ ] app.json configured correctly
- [ ] Version updated (1.0.0)
- [ ] All tests passing
- [ ] Linting clean
- [ ] Screenshots prepared
- [ ] Privacy policy ready
- [ ] Support email configured
- [ ] Credentials saved securely
- [ ] Build succeeds locally
- [ ] EAS build successful
- [ ] Ready to submit! 🎉
