import { useSyncExternalStore } from 'react'

// Display preferences that are the viewer's business, not the run's — they must
// not end up in RunSettings, or reopening someone's saved run would silently
// rewrite how they see it. Module-level store + useSyncExternalStore, the same
// shape as i18n.ts, so no Context provider and tests stay provider-free.

const STORAGE_KEY = 'benchy-show-reasoning'
const listeners = new Set<() => void>()

function read(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

let showReasoning = read()

export function getShowReasoning(): boolean {
  return showReasoning
}

export function setShowReasoning(on: boolean): void {
  if (on === showReasoning) return
  showReasoning = on
  try { localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off') } catch { /* ignore */ }
  listeners.forEach(fn => fn())
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function useShowReasoning(): boolean {
  return useSyncExternalStore(subscribe, getShowReasoning, getShowReasoning)
}
