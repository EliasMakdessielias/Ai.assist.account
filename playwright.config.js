// Etapp 3C-2A: separat Playwright-konfiguration för tvåsidig E2E-verifiering.
// SÄKER LOGGNING: video/screenshot/trace AV som standard (tills redaction är verifierad).
// Auth-state behandlas som OPAK indata; testkoden läser aldrig tokens/cookies/headers.
import { defineConfig, devices } from '@playwright/test'
import { AUTH_FILE, BASE_URL } from './tests/e2e/_env.js'

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['line']],                 // ingen HTML-rapport med inbäddade artefakter
  use: {
    baseURL: BASE_URL,
    headless: true,                     // e2e:auth överrider med --headed för manuell inloggning
    video: 'off',
    screenshot: 'off',
    trace: 'off',
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },
  projects: [
    // Skapar opak storageState via manuell inloggning (headed).
    { name: 'setup',  testMatch: /auth\.setup\.js/,        use: { ...devices['Desktop Chrome'] } },
    // Auth-fritt smoke (två pages i samma context).
    { name: 'noauth', testMatch: /.*\.noauth\.spec\.js/,   use: { ...devices['Desktop Chrome'] } },
    // Autentiserade tester – konsumerar opak storageState.
    { name: 'auth',   testMatch: /.*\.auth\.spec\.js/,     use: { ...devices['Desktop Chrome'], storageState: AUTH_FILE } },
  ],
  // Återanvänder en redan körande preview-server (annars startas den).
  webServer: {
    command: 'npm run preview',
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 60000,
  },
})
