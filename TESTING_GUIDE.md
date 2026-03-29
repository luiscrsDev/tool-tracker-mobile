# Testing Guide - Tool Tracker Mobile

## Pre-Testing Setup

### 1. Environment Configuration
```bash
# Install dependencies
npm install

# Start the app
npm start

# For iOS
npm run ios

# For Android
npm run android
```

### 2. Test Account Setup

**Contractor Account:**
- Email: `contractor@test.com`
- Password: `TestPassword123!`

**Admin Account:**
- Email: `admin@test.com`
- Password: `TestPassword123!`

---

## Test Scenarios

### Phase 1: Authentication & Navigation

#### Test 1.1: Login Flow
- [ ] Open app → Login screen displays
- [ ] Enter invalid credentials → Error message appears
- [ ] Enter valid contractor email → Redirects to contractor dashboard
- [ ] Enter valid admin email → Redirects to admin dashboard
- [ ] Logout button works → Returns to login

#### Test 1.2: Role-Based Navigation
- **Contractor Mode:**
  - [ ] Bottom tab bar shows 5 tabs (Dashboard, Tools, AirTag, Tracking, Alerts)
  - [ ] Each tab navigates correctly
  - [ ] Hidden tool-form screen accessible via Tools tab

- **Admin Mode:**
  - [ ] Tab bar shows 4 tabs (Dashboard, CRM, Operations, Analytics)
  - [ ] Each tab navigates correctly

---

### Phase 2: Data & Caching

#### Test 2.1: Cache Performance
- [ ] First load takes normal time (queries Supabase)
- [ ] Pull-to-refresh within 3 minutes uses cache (instant, console shows "✅ Cache hit")
- [ ] After cache expiry (3+ min), new Supabase query made
- [ ] Offline: Cached data displays, network error shown

#### Test 2.2: Data Mutations
- [ ] Add tool → Cache invalidated → Next refresh queries fresh
- [ ] Update tool → Cache invalidated
- [ ] Delete tool → Cache invalidated
- [ ] Resolve alert → Cache invalidated

#### Test 2.3: Offline Support
- [ ] Enable airplane mode
- [ ] Navigate screens → See cached data or "Network error" message
- [ ] Disable airplane mode
- [ ] Try operation again → Succeeds with retry logic
- [ ] Check console for "⏳ Retry attempt" messages

---

### Phase 3: Bluetooth & AirTag

#### Test 3.1: Bluetooth Scanning
- [ ] AirTag screen → Request Bluetooth permission
- [ ] "Escanear" button starts scan
- [ ] Button changes to "Parando" while scanning
- [ ] Nearby AirTags appear with RSSI signal strength
- [ ] Tap device → Pairing dialog shows

#### Test 3.2: AirTag Pairing
- [ ] Select AirTag from list
- [ ] Enter device name
- [ ] Confirm pairing → Tool added to list
- [ ] Tool appears in Tools screen with status 🟢 Rastreando

#### Test 3.3: Bluetooth Error Handling
- [ ] Bluetooth disabled → "Bluetooth desativado" error
- [ ] Permission denied → "Permissão negada" error
- [ ] Scan timeout → Retry logic engages

---

### Phase 4: Location Tracking

#### Test 4.1: GPS Permission
- [ ] Tracking screen → Request location permission
- [ ] Permission denied → "Localização desativada" error
- [ ] Permission granted → Screen loads

#### Test 4.2: Live Tracking
- [ ] Start tracking tool (button changes to "Parar")
- [ ] Real coordinates display with accuracy
- [ ] Location updates every 5 meters (or per 10 seconds)
- [ ] Last updated timestamp shows
- [ ] Tap "Ver no Mapa" → Google Maps opens with location

#### Test 4.3: Multiple Tracking
- [ ] Enable tracking for 2+ tools
- [ ] All show live locations simultaneously
- [ ] Stop one → Others continue tracking
- [ ] Reload app → Tracking resumes automatically

#### Test 4.4: Offline Tracking
- [ ] Start tracking
- [ ] Enable airplane mode
- [ ] Location updates stop (no Supabase sync)
- [ ] Disable airplane mode
- [ ] Resumes syncing with retry

---

### Phase 5: Admin Features

#### Test 5.1: Dashboard Metrics
- [ ] Stats load correctly (Contractors, Tools, Alerts, Avg)
- [ ] Pull-to-refresh updates stats
- [ ] Offline: Shows cached stats or empty state

#### Test 5.2: CRM Management
- [ ] Contractors list loads (FlatList)
- [ ] Status indicator: 🟢 Ativo (green) / ⚪ Inativo (gray)
- [ ] Pull-to-refresh works
- [ ] Empty state displays if no contractors

#### Test 5.3: Operations Monitoring
- [ ] All 4 menu items display correctly
- [ ] Info box explains real-time sync frequency
- [ ] Layout: Colored left borders (green, blue, red, purple)

#### Test 5.4: Analytics Reports
- [ ] All 5 report categories display
- [ ] Color-coded sections visible
- [ ] Descriptions accurate
- [ ] Info box visible

---

### Phase 6: Error Handling & Resilience

#### Test 6.1: Network Errors
- [ ] Enable airplane mode
- [ ] Try to add/update tool → "Sem conexão" error
- [ ] Disable airplane mode → Can retry successfully

#### Test 6.2: Timeout Handling
- [ ] Mock slow network (DevTools throttling)
- [ ] Long operations retry automatically
- [ ] Console shows retry attempts

#### Test 6.3: Validation
- [ ] Tool name required → Validation error
- [ ] Invalid email format → Validation error
- [ ] Required fields highlighted

#### Test 6.4: Duplicate Prevention
- [ ] Try pairing same AirTag twice → "Duplicate" error
- [ ] Same contractor email → Proper error

---

### Phase 7: Performance Testing

#### Test 7.1: App Load Time
- [ ] Cold start: < 3 seconds to login screen
- [ ] Warm start: < 1 second to dashboard
- [ ] Tab switches: < 500ms with cache hits

#### Test 7.2: Memory Usage
- [ ] Monitor memory before/after operations
- [ ] No memory leaks on repeated loads
- [ ] Navigation history cleaned up

#### Test 7.3: Battery Impact
- [ ] GPS tracking enabled for 10 minutes
- [ ] Monitor battery drain (should be ~1-2% per hour)
- [ ] Background location updates minimize battery

#### Test 7.4: Data Size
- [ ] Load app with 100+ tools
- [ ] Load app with 50+ contractors
- [ ] Load app with 200+ alerts
- [ ] Performance acceptable (< 2s)

---

### Phase 8: iOS-Specific Testing

#### Test 8.1: Permissions
- [ ] Bluetooth permission dialog
- [ ] Location permission dialog (While Using / Always)
- [ ] Notification permission dialog

#### Test 8.2: Notifications
- [ ] Push notification badge works
- [ ] Notification center shows alerts
- [ ] Tap notification → Opens relevant screen

#### Test 8.3: Background Modes
- [ ] Location tracking continues (requires capability)
- [ ] Data syncs periodically
- [ ] App doesn't crash when backgrounded

---

### Phase 9: Real Device Testing

#### Tested Devices
- [ ] iPhone 12+ (iOS 15+)
- [ ] iPhone SE (iOS 14+)
- [ ] Android 12+
- [ ] Android 10+

#### Device-Specific Tests
- [ ] Screen sizes: Large phone, small phone, tablet
- [ ] Orientations: Portrait, landscape
- [ ] Network: WiFi, LTE, 3G
- [ ] Location accuracy varies by device

---

## Test Data Creation

### Create Test Contractor
```sql
INSERT INTO contractors (name, email, status, company)
VALUES ('Test Contractor', 'test@contractor.com', 'active', 'Test Co');
```

### Create Test Tools
```sql
INSERT INTO tools (contractor_id, name, device_id, battery_level, is_connected)
VALUES
  ('...contractor-id...', 'AirTag 1', 'ABC123', 85, true),
  ('...contractor-id...', 'AirTag 2', 'XYZ789', 45, false);
```

### Create Test Alerts
```sql
INSERT INTO alerts (contractor_id, tool_id, message, severity, resolved)
VALUES
  ('...contractor-id...', '...tool-id...', 'Battery low', 'high', false),
  ('...contractor-id...', '...tool-id...', 'Connection lost', 'critical', false);
```

---

## Console Logging Guide

Watch for these patterns in console:

| Pattern | Meaning |
|---------|---------|
| `✅ Cache hit: {key}` | Using cached data (good!) |
| `📦 Cached: {key}` | Data stored in cache |
| `🗑️ Cache cleared: {key}` | Cache invalidated |
| `⚠️ Cache stale (fallback): {key}` | Using old data (offline) |
| `⏳ Retry attempt 1/3 in 1000ms` | Retrying failed operation |
| `Sem conexão` | Network offline |
| `❌ Error loading...` | Operation failed |
| `✅ [Data] loaded` | Success loading data |

---

## Checklist for Release

- [ ] All 4 phases passing
- [ ] No console errors (only warnings acceptable)
- [ ] Offline mode tested and working
- [ ] Cache performance verified
- [ ] Retry logic tested
- [ ] Real AirTag pairing works
- [ ] GPS tracking continuous
- [ ] Admin features fully functional
- [ ] Tested on 2+ real devices
- [ ] App doesn't crash on any screen
- [ ] Performance acceptable (<2s loads)
- [ ] Notifications working
- [ ] No memory leaks

---

## Debugging Tips

### Enable Debug Mode
```bash
# In app startup
console.log = console.debug;
```

### Check AsyncStorage
```javascript
import AsyncStorage from '@react-native-async-storage/async-storage';
const all = await AsyncStorage.getAllKeys();
console.log('Stored keys:', all);
```

### Network Monitoring
Enable Flipper (React Native Debugger) to see:
- Network requests/responses
- Database queries
- AsyncStorage contents
- Console logs with timestamps

### Bluetooth Debugging
- Check `BluetoothContext` console logs
- Use native Bluetooth app to verify pairing
- Monitor RSSI signal strength values

### Location Debugging
- Use device location simulator
- Move to different coordinates
- Verify accuracy values
- Check Supabase sync timestamp

---

## Known Limitations

1. **Web Bluetooth** - Not supported on iOS (using react-native-ble-plx instead)
2. **Background Tracking** - Requires iOS Background Modes configuration
3. **Maps** - Opens external Google Maps app (not embedded)
4. **Analytics Charts** - Display raw numbers (not visual charts yet)

---

## Next Steps

- [ ] Integrate charting library for analytics
- [ ] Add embedded map view
- [ ] Implement push notifications
- [ ] Add user preferences/settings
- [ ] Create admin reporting exports
