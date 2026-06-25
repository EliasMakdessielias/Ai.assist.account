// Etapp 3C-2A: delade konstanter för E2E-miljön. Inga hemligheter här.
import path from 'node:path'

// Opak autentiseringsstate – ligger UTANFÖR Git (se .gitignore). Testkoden öppnar/läser ALDRIG filen.
export const AUTH_FILE = path.resolve('playwright/.auth/user.json')
export const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:4173'
