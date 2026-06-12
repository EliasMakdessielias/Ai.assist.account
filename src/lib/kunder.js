// Kundkortets rena logik (testbar): kundnummer-förslag och payload-normalisering.

// Nästa lediga kundnummer: högsta befintliga + 1 (minst 1).
export function nextKundNr(customers) {
  const max = (customers || []).reduce((m, c) => Math.max(m, Number(c?.kund_nr) || 0), 0)
  return max + 1
}

const t = v => { const s = String(v ?? '').trim(); return s || null }

// Normaliserar formuläret till databas-payload: trimmade strängar (tomt -> null),
// heltal för kundnummer/betalningsvillkor, giltig kundtyp och alltid en valuta.
export function kundPayload(form) {
  return {
    kund_nr: parseInt(form.kund_nr, 10) || null,
    kundtyp: form.kundtyp === 'privat' ? 'privat' : 'foretag',
    is_active: form.is_active !== false,
    name: String(form.name || '').trim(),
    org_nr: t(form.org_nr),
    contact_person: t(form.contact_person),
    email: t(form.email),
    phone: t(form.phone),
    telefon2: t(form.telefon2),
    webb: t(form.webb),
    address: t(form.address),
    address2: t(form.address2),
    postnr: t(form.postnr),
    ort: t(form.ort),
    land: t(form.land),
    lev_namn: t(form.lev_namn),
    lev_adress: t(form.lev_adress),
    lev_adress2: t(form.lev_adress2),
    lev_postnr: t(form.lev_postnr),
    lev_ort: t(form.lev_ort),
    lev_land: t(form.lev_land),
    anteckningar: t(form.anteckningar),
    payment_terms: parseInt(form.payment_terms, 10) || 30,
    leveransvillkor: t(form.leveransvillkor),
    leveranssatt: t(form.leveranssatt),
    valuta: t(form.valuta) || 'SEK',
    var_referens: t(form.var_referens),
    er_referens: t(form.er_referens),
    vat_nummer: t(form.vat_nummer),
    forsaljningskonto: /^\d{4}$/.test(String(form.forsaljningskonto || '').trim()) ? String(form.forsaljningskonto).trim() : null,
  }
}
