import { useRef, useState, type ChangeEvent } from 'react'

export function useBackgroundImage() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [image, setImage] = useState<HTMLImageElement | null>(null)

  const handleUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        setImage(img)
      }
      img.src = e.target?.result as string
    }
    reader.readAsDataURL(file)
  }

  const triggerUpload = () => {
    fileInputRef.current?.click()
  }

  const remove = () => {
    setImage(null)
  }

  return {
    fileInputRef,
    image,
    handleUpload,
    triggerUpload,
    remove,
  }
}
