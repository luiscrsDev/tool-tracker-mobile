# Android Setup & Testing Guide

## Prerequisites Check

### Option A: Using Expo Go (Easiest - 5 minutes)
**No Android SDK required!**

1. Install Expo Go app on Android phone/emulator from Google Play Store
2. Run development server: `npm start`
3. Scan QR code with phone camera or Expo Go app
4. App loads instantly

**Pros:** Fast, no setup, easy iteration
**Cons:** Limited native features

---

## Option B: Full Android Build (Production - 15-20 minutes)

### Step 1: Install Android SDK

#### macOS (using Homebrew)
```bash
# Install Java (required)
brew install openjdk@11
export JAVA_HOME=$(/usr/libexec/java_home -v 11)

# Install Android SDK
brew install android-commandlinetools

# Set Android SDK path
export ANDROID_HOME=$HOME/Library/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/emulator:$ANDROID_HOME/tools:$ANDROID_HOME/tools/bin:$ANDROID_HOME/platform-tools

# Add to ~/.zshrc or ~/.bash_profile for persistence
echo 'export ANDROID_HOME=$HOME/Library/Android/Sdk' >> ~/.zshrc
echo 'export PATH=$PATH:$ANDROID_HOME/emulator:$ANDROID_HOME/tools:$ANDROID_HOME/tools/bin:$ANDROID_HOME/platform-tools' >> ~/.zshrc
```

#### Linux
```bash
# Install Java
sudo apt-get install openjdk-11-jdk

# Download Android SDK from:
# https://developer.android.com/studio/command-line-tools

# Extract and add to PATH
export ANDROID_HOME=$HOME/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/emulator:$ANDROID_HOME/tools:$ANDROID_HOME/platform-tools
```

#### Windows
```bash
# Use Android Studio (recommended)
# https://developer.android.com/studio

# Or download command-line tools:
# Set ANDROID_HOME environment variable to SDK location
# Add to PATH: %ANDROID_HOME%\emulator, %ANDROID_HOME%\platform-tools
```

### Step 2: Verify Installation
```bash
# Check Java
java -version

# Check Android SDK
android --version

# Check ADB
adb --version
```

### Step 3: Create/Start Android Emulator

#### Using Android Studio (Easiest)
```bash
# Open Android Studio → Tools → Device Manager → Create Virtual Device
# Select: Pixel 5, Android 12+
# Start the emulator
```

#### Using Command Line
```bash
# List available emulators
emulator -list-avds

# Create new emulator (if none exist)
avdmanager create avd -n Pixel5 -k "system-images;android-31;google_apis;x86"

# Start emulator
emulator -avd Pixel5
```

### Step 4: Verify Emulator Connection
```bash
# Wait ~30 seconds for emulator to fully boot
adb devices

# Expected output:
# List of attached devices
# emulator-5554  device
```

---

## Step 5: Build & Install App

### Option 1: Expo Prebuild (Recommended)
```bash
# Prebuild native Android project
expo prebuild --platform android

# Install on emulator/device
npm run android

# Or manually:
adb install ./android/app/build/outputs/apk/debug/app-debug.apk
```

### Option 2: Direct Gradle Build
```bash
# Requires Android SDK
cd android
./gradlew assembleDebug
cd ..

# Install
adb install ./android/app/build/outputs/apk/debug/app-debug.apk
```

### Option 3: EAS Build (Cloud)
```bash
# No local Android SDK needed
eas build --platform android --local

# Or remote (recommended for release):
eas build --platform android
```

---

## Troubleshooting

### ADB Device Not Found
```bash
# Restart ADB
adb kill-server
adb start-server
adb devices

# If still not found:
# 1. Check emulator is running: emulator -avd Pixel5
# 2. Kill other emulators/devices
# 3. Restart emulator
```

### Permission Denied
```bash
# Make sure emulator is bootloader complete
adb wait-for-device

# Install app
adb install -r app-debug.apk
```

### Gradle Build Failures
```bash
# Clear gradle cache
rm -rf android/.gradle

# Prebuild again
expo prebuild --platform android --clean
```

### Emulator Too Slow
- Use Intel HAXM or Hyper-V acceleration
- Increase emulator RAM: Android Studio → Device Manager → Edit → Memory
- Use physical device instead

---

## Quick Start Commands

```bash
# Development with Expo Go (fastest)
npm start
# Then scan QR code on Android phone

# Full build & install
npm run android

# Watch for code changes
npm start -- --android

# Debug in Chrome DevTools
# Shake phone → "Debug" option

# View logs
adb logcat

# Clear app data
adb shell pm clear com.tooltracker.mobile

# Uninstall app
adb uninstall com.tooltracker.mobile
```

---

## Testing Checklist (Android)

See TESTING_GUIDE.md for full scenarios, but quick check:

- [ ] App opens and login screen displays
- [ ] Login with test credentials works
- [ ] Dashboard loads with stats
- [ ] Tools list displays
- [ ] Can add new tool
- [ ] AirTag pairing screen opens (may show permission requests)
- [ ] Alerts display
- [ ] Pull-to-refresh works
- [ ] Navigation between tabs works
- [ ] Offline mode: Enable airplane mode, data still shows
- [ ] No crashes: Check logcat for errors

---

## Emulator vs Physical Device

| Feature | Emulator | Physical |
|---------|----------|----------|
| Setup Time | 15 min | 1 min |
| Speed | Slow | Fast |
| GPS | Simulated | Real |
| Bluetooth | Limited | Full |
| Sensors | Simulated | Real |
| Testing Reality | Medium | High |

**Recommendation:** Use emulator for UI testing, physical device for Bluetooth/GPS testing

---

## Android Device Testing

### Connect Physical Device
```bash
# Enable USB debugging on device:
# Settings → About → Build Number (tap 7 times)
# Back → Developer Options → USB Debugging (enable)

# Connect via USB
adb devices

# Expected: device shows as "device" (not "unauthorized")
```

### Install App
```bash
# Build APK
npm run android

# Or manually:
adb install app-debug.apk

# Verify installation
adb shell pm list packages | grep tooltracker
```

### Monitor Device Logs
```bash
# Real-time logs
adb logcat

# Filter by app
adb logcat *:S com.tooltracker:V

# Save to file
adb logcat > logcat.txt
```

---

## Common Issues & Fixes

### "ANDROID_HOME not set"
```bash
# Set in current session
export ANDROID_HOME=$HOME/Library/Android/Sdk

# Or add to ~/.zshrc permanently
echo 'export ANDROID_HOME=$HOME/Library/Android/Sdk' >> ~/.zshrc
source ~/.zshrc
```

### Emulator Won't Start
```bash
# Delete and recreate
avdmanager delete avd -n Pixel5
avdmanager create avd -n Pixel5 -k "system-images;android-31;google_apis;x86"
emulator -avd Pixel5
```

### App Crashes on Start
```bash
# Check logs
adb logcat | grep "FATAL\|Error\|Exception"

# Clear app data
adb shell pm clear com.tooltracker.mobile

# Reinstall
adb uninstall com.tooltracker.mobile
adb install app-debug.apk
```

### Permissions Not Requested
```bash
# Check app permissions
adb shell pm list permissions -g | grep -i tool

# Grant permission manually
adb shell pm grant com.tooltracker.mobile android.permission.ACCESS_FINE_LOCATION
adb shell pm grant com.tooltracker.mobile android.permission.BLUETOOTH
```

---

## Debugging Tools

### Android Studio Profiler
```bash
# Monitor CPU, Memory, Network
# Android Studio → Profiler tab
# Select running app
```

### Flipper (React Native Debugger)
```bash
# Download: https://fbflipper.com/
# Connect via USB
# Monitor network, database, logs
```

### Chrome DevTools
```bash
# Shake device → "Debug"
# Opens Chrome DevTools
# Inspect components, console logs, network
```

---

## Next Steps

1. **Choose setup method** (Expo Go vs Full SDK)
2. **Install prerequisites** (follow steps above)
3. **Connect device/emulator** (verify with adb devices)
4. **Build app** (npm run android)
5. **Follow TESTING_GUIDE.md** for comprehensive testing
6. **Report any issues** with logs

---

## Support

If stuck:
- Check emulator is running: `adb devices`
- View logs: `adb logcat`
- Restart everything: Kill emulator, close IDE, `adb kill-server`, start fresh
- Search error message in Android docs
- Post logs in issue tracker
