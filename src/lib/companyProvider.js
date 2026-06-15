// Klientsidans mappning av den normaliserade företagsmodellen (intern modell från
// edge-funktionen hamta-foretag / AllabolagCompanyProvider) till kundkortets formulärfält.
// Ren logik – ingen I/O. Hämtning och normalisering av rådata sker server-side.
import { formatOrgNr } from './orgnr'

const ne = v => v != null && String(v).trim() !== ''      // non-empty

// Översätter en intern företagsmodell till formulärvärden (endast ifyllda fält).
// Fakturaadressen tas från postadressen med besöksadress som fallback (samma princip
// som tidigare). Returnerar { values, filledKeys } – filledKeys driver "Hämtad från
// Allabolag"-etiketterna i UI.
export function companyToKundForm(company) {
  const c = company || {}
  const addr = c.address || {}
  const post = c.postalAddress || {}
  const contact = c.contact || {}
  const tax = c.taxRegistration || {}
  const pick = (a, b) => (ne(a) ? a : (ne(b) ? b : ''))

  const candidates = {
    kundtyp: 'foretag',
    org_nr: c.organizationNumber ? formatOrgNr(c.organizationNumber) : '',
    name: c.legalName || c.displayName || '',
    address: pick(post.street, addr.street),
    address2: pick(post.careOf, addr.careOf),
    postnr: pick(post.postalCode, addr.postalCode),
    ort: pick(post.city, addr.city),
    land: pick(post.country, addr.country),
    phone: contact.phone || '',
    telefon2: contact.mobile || '',
    email: contact.email || '',
    webb: contact.website || '',
    vat_nummer: tax.vatNumber || '',
  }

  const values = {}
  const filledKeys = []
  for (const [k, v] of Object.entries(candidates)) {
    if (k === 'kundtyp') { values[k] = v; continue }      // kundtyp sätts alltid, ingen etikett
    if (ne(v)) { values[k] = String(v).trim(); filledKeys.push(k) }
  }
  return { values, filledKeys }
}

// Konflikter inför "Uppdatera företagsuppgifter": fält där formuläret redan har ett
// (manuellt) värde som SKILJER sig från det nyhämtade. Visas som jämförelse innan
// användaren godkänner att skriva över. Tomma formulärfält fylls utan att räknas som konflikt.
export function diffFormValues(currentForm, newValues) {
  const out = []
  for (const [k, to] of Object.entries(newValues || {})) {
    if (k === 'kundtyp') continue
    const from = currentForm?.[k]
    if (ne(from) && String(from).trim() !== String(to).trim()) out.push({ key: k, from: String(from).trim(), to: String(to).trim() })
  }
  return out
}

// Svenska etiketter för fältnycklarna (jämförelsedialog).
export const KUND_FIELD_LABELS = {
  name: 'Namn', org_nr: 'Organisationsnummer', address: 'Fakturaadress', address2: 'Fakturaadress 2',
  postnr: 'Postnr', ort: 'Ort', land: 'Land', phone: 'Telefon', telefon2: 'Telefon 2',
  email: 'E-post', webb: 'Webbadress', vat_nummer: 'VAT-nummer',
}
