// Svenskt organisationsnummer: normalisering, validering (Luhn) och formatering.
// Ren logik – ingen I/O. Används av kundkortet och (samma regler) av edge-funktionen.

// Plockar ut siffrorna. 12-siffrigt (med sekel) kortas till 10. Returnerar '' om < 10 siffror.
export function normalizeOrgNr(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '')
  if (digits.length === 12) return digits.slice(2)        // sekel bort -> 10 siffror
  if (digits.length === 10) return digits
  if (digits.length > 12) return digits.slice(-10)
  return ''                                               // ofullständigt
}

// Luhn-kontroll (mod 10) över exakt 10 siffror – sista siffran är kontrollsiffra.
export function luhnValid(tenDigits) {
  const s = String(tenDigits ?? '')
  if (!/^\d{10}$/.test(s)) return false
  let sum = 0
  for (let i = 0; i < 10; i++) {
    let d = s.charCodeAt(i) - 48
    if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9 }        // dubbla varannan från vänster (position 1,3,…)
    sum += d
  }
  return sum % 10 === 0
}

// Komplett + giltigt svenskt org-/personnummer (10 siffror + korrekt kontrollsiffra).
export function isValidOrgNr(raw) {
  const n = normalizeOrgNr(raw)
  return n.length === 10 && luhnValid(n)
}

// Visningsformat XXXXXX-XXXX. Ogiltig/ofullständig indata returneras oförändrad.
export function formatOrgNr(raw) {
  const n = normalizeOrgNr(raw)
  return n.length === 10 ? `${n.slice(0, 6)}-${n.slice(6)}` : String(raw ?? '')
}
