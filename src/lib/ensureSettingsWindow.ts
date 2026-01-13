import { isTauri } from '@tauri-apps/api/core'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'

export type EnsureSettingsWindowOptions = {
  focus?: boolean
}

export async function ensureSettingsWindow(options: EnsureSettingsWindowOptions = {}) {
  if (!isTauri()) return

  const focus = options.focus ?? false
  const existing = await WebviewWindow.getByLabel('settings')
  if (existing) {
    await existing.show()
    if (focus) await existing.setFocus()
    return
  }

  const win = new WebviewWindow('settings', {
    title: '調整',
    url: 'settings.html',
    width: 440,
    height: 760,
    resizable: true,
    visible: true,
  })

  win.once('tauri://error', (e) => {
    console.error('設定ウインドウ作成エラー:', e)
  })
}
