import { useEffect, useState } from 'react'
import { subscribeNetwork, retryNow, getNetworkState } from '../lib/offline/networkHealth'

// Läser det centrala nätverkshälsolagret. Returnerar { status, lastSuccessAt, checking, retry }.
export function useNetworkStatus() {
  const [state, setState] = useState(getNetworkState)
  useEffect(() => subscribeNetwork(setState), [])
  return { ...state, retry: retryNow }
}
