import { useEffect, useRef, useState, type ChangeEvent } from 'react'

const BACKGROUND_DATA_URL_KEY = 'background.dataUrl'

const readStoredDataUrl = () => {
  try {
    return window.localStorage.getItem(BACKGROUND_DATA_URL_KEY)
  } catch {
    return null
  }
}

const storeDataUrl = (dataUrl: string | null) => {
  try {
    if (!dataUrl) window.localStorage.removeItem(BACKGROUND_DATA_URL_KEY)
    else window.localStorage.setItem(BACKGROUND_DATA_URL_KEY, dataUrl)
  } catch {
    // ignore
  }
}

export function useBackgroundImage() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [image, setImage] = useState<HTMLImageElement | null>(null)

  const setFromDataUrl = (dataUrl: string | null) => {
    if (!dataUrl) {
      setImage(null)
      return
    }

    const img = new Image()
    img.onload = () => setImage(img)
    img.onerror = () => setImage(null)
    img.src = dataUrl
  }

  useEffect(() => {
    setFromDataUrl(readStoredDataUrl())

    const onStorage = (event: StorageEvent) => {
      if (event.key !== BACKGROUND_DATA_URL_KEY) return
      setFromDataUrl(event.newValue)
    }

    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const handleUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      const dataUrl = String(e.target?.result ?? '')
      if (!dataUrl) return
      storeDataUrl(dataUrl)
      setFromDataUrl(dataUrl)
    }
    reader.readAsDataURL(file)
  }

  const triggerUpload = () => {
    fileInputRef.current?.click()
  }

  const remove = () => {
    storeDataUrl(null)
    setImage(null)
  }

  return {
    fileInputRef,
    image,
    handleUpload,
    triggerUpload,
    remove,
    setFromDataUrl,
  }
}
