// Svenskt personnummer – validering (format + Luhn-kontrollsiffra), normalisering, maskning.
// Ren, testbar logik. Personnummer är känsliga personuppgifter (GDPR) – maskning används i listvyer.

// Luhn-kontrollsiffra på de 10 siffrorna ÅÅMMDD-NNNK (samma algoritm som för svenska personnummer).
function luhnOk(tenDigits) {
  if (!/^\d{10}$/.test(tenDigits)) return false
  let sum = 0
  for (let i = 0; i < 10; i++) {
    let d = tenDigits.charCodeAt(i) - 48
    if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9 }   // varannan siffra fördubblas (start från första)
    sum += d
  }
  return sum % 10 === 0
}

// Plockar ut enbart siffror och hanterar 10- eller 12-siffriga format (med/utan bindestreck/plus).
function digitsOf(input) {
  return String(input ?? '').replace(/\D/g, '')
}

// Validerar ett personnummer. Returnerar { valid, normalized?, reason? }.
// Godtar 10 siffror (ÅÅMMDDNNNK) eller 12 siffror (ÅÅÅÅMMDDNNNK). Kontrollerar månad, dag och Luhn.
export function validatePersonnummer(input) {
  const d = digitsOf(input)
  let core // 10 siffror ÅÅMMDDNNNK
  let yyyy = null
  if (d.length === 10) core = d
  else if (d.length === 12) { core = d.slice(2); yyyy = d.slice(0, 4) }
  else return { valid: false, reason: 'Personnummer ska ha 10 eller 12 siffror' }

  const mm = parseInt(core.slice(2, 4), 10)
  const dd = parseInt(core.slice(4, 6), 10)
  // Tillåt samordningsnummer (dag + 60) också.
  const dayOk = (dd >= 1 && dd <= 31) || (dd >= 61 && dd <= 91)
  if (mm < 1 || mm > 12) return { valid: false, reason: 'Ogiltig månad' }
  if (!dayOk) return { valid: false, reason: 'Ogiltig dag' }
  if (!luhnOk(core)) return { valid: false, reason: 'Kontrollsiffran stämmer inte' }

  return { valid: true, normalized: normalizePersonnummer(yyyy ? d : core) }
}

// Normaliserar till ÅÅÅÅMMDD-NNNK när århundrade går att härleda, annars ÅÅMMDD-NNNK.
export function normalizePersonnummer(input) {
  const d = digitsOf(input)
  if (d.length === 12) return `${d.slice(0, 8)}-${d.slice(8)}`
  if (d.length === 10) return `${d.slice(0, 6)}-${d.slice(6)}`
  return String(input ?? '').trim()
}

// Maskar de fyra sista siffrorna i listvyer (GDPR): ÅÅÅÅMMDD-**** / ÅÅMMDD-****.
export function maskPersonnummer(input) {
  const norm = normalizePersonnummer(input)
  return norm.replace(/(\d{4})$/, '****')
}
