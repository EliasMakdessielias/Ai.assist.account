// Robust kopiering till urklipp. navigator.clipboard kan saknas eller avvisas (icke-säker
// kontext, saknad fokus, behörighetspolicy) – då används en textarea + execCommand-fallback.
// Returnerar true endast om kopieringen faktiskt lyckades (så UI:t inte ljuger om "kopierat").
export async function copyText(text) {
  const t = String(text ?? '')
  if (!t) return false
  try {
    if (navigator?.clipboard?.writeText) { await navigator.clipboard.writeText(t); return true }
  } catch { /* fall vidare till fallback */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = t
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    ta.setSelectionRange(0, t.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return !!ok
  } catch { return false }
}

// Bekväm helper: kopierar och visar svensk toast (success/fel). `toast` injiceras för att
// hålla modulen fri från beroenden.
export async function copyWithToast(text, toast, label = 'E-postadress kopierad') {
  const ok = await copyText(text)
  if (ok) toast.success(label)
  else toast.error('Kunde inte kopiera – markera adressen och kopiera manuellt')
  return ok
}
