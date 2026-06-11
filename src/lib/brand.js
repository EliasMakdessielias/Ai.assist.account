// Central varumärkeskonfiguration för BokPilot.
// Ändra produktnamn/företagsnamn/underrubrik på ETT ställe.
export const BRAND = {
  appName: 'BokPilot',           // produktnamn – huvudnamn i UI
  logo: '/logo.svg',             // app-logo (BP-emblem), serveras från public/
  productName: 'BokPilot',
  companyName: 'BokPilot AB',    // juridiskt företagsnamn (bolaget bakom produkten)
  tagline: 'Bokföring & ekonomi',
  description: 'BokPilot automatiserar svensk bokföring med AI, fakturatolkning och smart granskning.',
  // Publik självregistrering. Avstängt under utvecklingsfasen – endast befintliga
  // konton kan logga in. Sätt till true när vi öppnar för kunder/andra företag.
  allowSignup: false,
}

export const APP_NAME = BRAND.appName
export const PRODUCT_NAME = BRAND.productName
export const COMPANY_NAME = BRAND.companyName
export const TAGLINE = BRAND.tagline

export default BRAND
