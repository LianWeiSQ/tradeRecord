import { useEffect, useState } from 'react'

type StorageKind = 'local' | 'session'

function resolveStorage(kind: StorageKind) {
  if (typeof window === 'undefined') {
    return undefined
  }

  return kind === 'session' ? window.sessionStorage : window.localStorage
}

function cloneDefault<T>(value: T | (() => T)) {
  return typeof value === 'function' ? (value as () => T)() : value
}

export function usePersistentState<T>(
  key: string,
  defaultValue: T | (() => T),
  storageKind: StorageKind = 'local',
) {
  const [state, setState] = useState<T>(() => {
    const fallback = cloneDefault(defaultValue)
    const storage = resolveStorage(storageKind)

    if (!storage) {
      return fallback
    }

    try {
      const raw = storage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : fallback
    } catch {
      return fallback
    }
  })

  useEffect(() => {
    const storage = resolveStorage(storageKind)
    if (!storage) {
      return
    }

    try {
      storage.setItem(key, JSON.stringify(state))
    } catch {
      // Ignore browser storage failures and fall back to in-memory state.
    }
  }, [key, state, storageKind])

  return [state, setState] as const
}
