# Tool Tracker Mobile — Architecture Map

## Project Structure

```
tool-tracker-mobile/
│
├── app/                          ← TELAS (Expo Router)
│   ├── _layout.tsx               ← Root: auth redirect por role
│   ├── (auth)/login.tsx          ← Login OTP (Twilio)
│   ├── (tabs)/                   ← Interface Contractor (5 tabs)
│   │   ├── index.tsx             ← Dashboard (stats, activity feed, quick actions)
│   │   ├── tools.tsx             ← Lista de ferramentas (thumbnails, filtros)
│   │   ├── tracking.tsx          ← Rastrear (auto-refresh, signal bars)
│   │   ├── alerts.tsx            ← Alertas (severity cards)
│   │   ├── more.tsx              ← Menu (historico, airtag, sites, diario, config)
│   │   ├── airtag.tsx            ← AirTag Setup (parear, beep, scan)
│   │   ├── history.tsx           ← Historico de movimentos
│   │   ├── diary.tsx             ← Diario manual (validacao do tracking)
│   │   ├── tool-detail.tsx       ← Detalhe ferramenta (vincular tag, historico)
│   │   ├── tool-form.tsx         ← Cadastro ferramenta (fotos, barcode)
│   │   ├── sites.tsx             ← Sites/depositos (geofence)
│   │   ├── settings.tsx          ← Configuracoes de alertas
│   │   └── locations.tsx         ← Mapa de localizacoes
│   ├── (worker)/                 ← Interface Worker (3 tabs)
│   │   ├── index.tsx             ← Minhas ferramentas
│   │   ├── transfers.tsx         ← Transferencias
│   │   └── profile.tsx           ← Perfil
│   └── admin/                    ← Interface Admin (4 tabs)
│       ├── dashboard.tsx         ← Dashboard admin
│       ├── crm.tsx               ← CRM contractors
│       ├── operations.tsx        ← Operacoes (stub)
│       └── analytics.tsx         ← Analytics (stub)
│
├── modules/                      ← MODULOS NATIVOS (Kotlin)
│   ├── expo-ble-tracker/         ← BLE TRACKING (principal)
│   │   ├── src/index.ts          ← TypeScript wrapper + eventos
│   │   └── android/.../
│   │       ├── BleTrackingService.kt    ← PendingIntent scan background
│   │       ├── ExpoBleTrackerModule.kt  ← Bridge React Native ↔ Kotlin
│   │       ├── BleForegroundScanner.kt  ← Scan continuo (pareamento)
│   │       ├── MokoGattClient.kt        ← GATT: senha, LED, buzzer
│   │       └── BootReceiver.kt          ← Restart apos reboot
│   └── expo-fmdn/               ← FMDN (legado, nao usado)
│
├── src/                          ← LOGICA JS
│   ├── context/                  ← Providers React
│   │   ├── AuthContext.tsx       ← Auth OTP + roles
│   │   ├── ToolsContext.tsx      ← CRUD ferramentas
│   │   ├── TagsContext.tsx       ← CRUD tags BLE
│   │   ├── AlertsContext.tsx     ← Alertas
│   │   ├── LocationContext.tsx   ← GPS + tracking
│   │   ├── SitesContext.tsx      ← Sites + reverse geocoding
│   │   ├── BluetoothContext.tsx  ← BLE JS (sendo substituido pelo native)
│   │   └── AdminContext.tsx      ← Stats admin
│   ├── lib/                      ← Servicos
│   │   ├── supabase.ts           ← Cliente Supabase
│   │   ├── backgroundTracking.ts ← GPS background (expo-location)
│   │   ├── bleMonitoring.ts      ← BLE JS monitoring (sendo substituido)
│   │   ├── bluetooth.ts          ← BLE JS operations (sendo substituido)
│   │   ├── movementEngine.ts     ← Engine JS (movement/stop/speed)
│   │   ├── location.ts           ← GPS service
│   │   ├── cache.ts              ← Cache com TTL
│   │   ├── notifications.ts      ← Push notifications
│   │   ├── imageService.ts       ← Upload de fotos
│   │   ├── network.ts            ← Network utils
│   │   ├── analytics.ts          ← Analytics
│   │   └── errors.ts             ← Error handling
│   └── types/index.ts            ← TypeScript types
│
├── supabase/                     ← BACKEND
│   ├── functions/
│   │   ├── send-otp/index.ts     ← Twilio SMS
│   │   └── verify-otp/index.ts   ← Twilio verify + dev bypass (000000)
│   └── migrations/               ← Schema SQL
│       ├── 20260325_worker_network.sql
│       ├── 20260328_tags_table.sql
│       ├── 20260329_movements.sql
│       ├── 20260329_sites.sql
│       └── 20260419_diary.sql
│
├── components/                   ← Componentes reutilizaveis
│   ├── themed-text.tsx           ← Text com tema
│   ├── themed-view.tsx           ← View com tema
│   ├── haptic-tab.tsx            ← Tab com haptic feedback
│   └── ui/                       ← UI primitivos
│
├── constants/theme.ts            ← Cores e fontes
├── app.json                      ← Configuracao Expo
├── eas.json                      ← Configuracao EAS Build
└── .mcp.json                     ← MCP servers (stitch, 21st-magic)
```

---

## Fluxo de Tracking (BLE → Supabase)

```
┌─────────────────────┐
│  MokoSmart M1P Tag  │ BLE advertisement (MAC fixo E4:06:BF:*)
│  (BXP-S firmware)   │ Nome: "MK Sensor"
└────────┬────────────┘
         │ BLE radio
         ▼
┌─────────────────────────────────────────────────┐
│  Android BLE Stack (system-level)               │
│  PendingIntent scan com ScanFilter por MAC      │
│  Roda mesmo com app morto / tela desligada      │
└────────┬────────────────────────────────────────┘
         │ Intent → BroadcastReceiver
         ▼
┌─────────────────────────────────────────────────┐
│  BleTrackingService.kt (Kotlin Foreground Svc)  │
│                                                 │
│  1. Recebe PendingIntent com ScanResult         │
│  2. Match MAC contra trackedTags                │
│  3. FusedLocationProvider → GPS                 │
│  4. Filtra accuracy > 50m (descarta indoor)     │
│  5. GPS averaging (ultimas 5 posicoes)          │
│  6. Movement engine:                            │
│     - movement: dist > max(15m, acc*2)          │
│     - speed: > 10 km/h                         │
│     - stop: > 4 min parado                     │
│     - heartbeat: > 1h                           │
│  7. HTTP POST → Supabase (tool_movements)       │
│  8. HTTP PATCH → Supabase (last_seen_location)  │
└────────┬────────────────────────────────────────┘
         │ EventEmitter
         ▼
┌─────────────────────────────────────────────────┐
│  React Native (UI)                              │
│  Dashboard / Rastrear / Historico               │
└─────────────────────────────────────────────────┘
```

---

## Tabelas Supabase

| Tabela | Descricao | Campos Chave |
|--------|-----------|--------------|
| `contractors` | Empresas/usuarios | id, name, email, phone, company, status |
| `app_users` | Workers | id, name, phone |
| `admin_users` | Admins | id, name, email, phone |
| `tools` | Ferramentas | id, name, type, value, images[], assigned_tag, last_seen_location, contractor_id |
| `tags` | Tags BLE | id, name, tag_id (MAC), eik, battery, contractor_id |
| `tool_movements` | Historico tracking | id, tool_id, event, latitude, longitude, speed_kmh, contractor_id, created_at |
| `tool_checkouts` | Saidas | id, worker_id, tool_ids[], site_id, checked_out_at, returned_at |
| `sites` | Depositos/obras | id, label, address, latitude, longitude, radius, contractor_id |
| `alert_settings` | Config alertas | id, contractor_id, notify_out_of_range, notify_low_battery, etc |
| `diary_entries` | Diario manual | id, contractor_id, event, latitude, longitude, note, created_at |
| `location_history` | Historico BLE | id, tool_id, latitude, longitude, accuracy, detection_method |

---

## Hardware

| Dispositivo | Modelo | Firmware | MAC | Uso |
|-------------|--------|----------|-----|-----|
| BLE Tag | MokoSmart M1P LED Tag | BXP-S | E4:06:BF:C1:38:39 | Aspirador Ridge |
| BLE Tag | MokoSmart M1P LED Tag | BXP-S | E4:06:BF:C1:37:9B | Parafusadeira |
| BLE Tag | MokoSmart M1P LED Tag | BXP-S | E4:06:BF:C1:38:3E | Gerador Power |
| Celular | Samsung Galaxy | Android | R3CY90WM8EH | App + tracking |

### M1P Specs
- Chip: Silicon Labs BG22 (BLE 5.1)
- Bateria: CR2032 (1.5 anos)
- Alcance: 150m (legacy) / 350m (long range)
- Advertising: 1000ms interval
- Sensores: Acelerometro 3-eixos, temperatura (opcional), buzzer (opcional)
- LED: Vermelho (alta luminosidade)
- Senha conexao: `Moko4321`
- Service GATT: `0x AA00` (params: AA01, password: AA04)

---

## Stack Tecnico

| Camada | Tecnologia |
|--------|-----------|
| Frontend | React Native + Expo (SDK 54) |
| Routing | Expo Router (file-based) |
| Styling | React Native StyleSheet (inline) |
| Backend | Supabase (Postgres + Auth + Storage + Edge Functions) |
| BLE Tracking | Kotlin Foreground Service (PendingIntent scan) |
| GPS | FusedLocationProvider (Google Play Services) |
| OTP | Twilio Verify |
| Build | EAS Build (cloud) + Gradle local |
| Icons | Ionicons (@expo/vector-icons) |

---

## Roles e Navegacao

| Role | Tela Inicial | Tabs |
|------|-------------|------|
| `contractor` | Dashboard | Dashboard, Ferramentas, Rastrear, Alertas, Mais |
| `worker` | Minhas Ferramentas | Ferramentas, Transferencias, Perfil |
| `admin` / `master` | Admin Dashboard | Dashboard, CRM, Operacoes, Analytics |

---

## Status do Desenvolvimento (Abril 2026)

### Funcionando
- Login OTP (Twilio + bypass 000000)
- CRUD ferramentas (fotos, barcode)
- PendingIntent BLE scan (background persistente)
- Tracking com 3 tags M1P (64 registros no primeiro teste real)
- GPS accuracy filter (>50m = descarta)
- GPS averaging (ultimas 5 posicoes)
- Movement engine nativo (movement/stop/speed/heartbeat)
- Supabase REST direto do Kotlin
- Diario manual pra validacao

### Em Progresso
- Beep/LED nos M1P (protocolo MOKO identificado, implementacao pendente)
- Stop detection refinamento
- Reescrita AirTag Setup pra usar native scan

### Pendente
- Remover react-native-ble-plx (substituido pelo native module)
- RLS (Row Level Security) no Supabase
- Google Maps API key (mini-mapa no tool detail)
- iOS support (CBCentralManager)
- Onboarding de permissoes automatico
- Health check do service
