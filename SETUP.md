# Tool Tracker Mobile (React Native + Expo)

Versão nativa iOS + Android, migrada de Web.

## Setup Rápido

```bash
npm install
cp .env.example .env.local  # Configure Supabase
npm start
```

## Funcionalidades

- ✅ Types & Interfaces
- ✅ Supabase integration
- ✅ Contractor authentication (AsyncStorage)
- 🔄 Bluetooth nativo (em progresso)
- 🔄 Screens & Navigation (em progresso)

## Estrutura

```
src/
  ├── hooks/      - useContractorAuth, useBluetooth
  ├── screens/    - Login, Dashboard, AirTagSetup
  ├── components/ - UI components
  ├── lib/        - Supabase client
  ├── types/      - TypeScript definitions
  └── constants/  - App constants
```

