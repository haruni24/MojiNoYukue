import { isTauri } from '@tauri-apps/api/core'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'

export type EnsureTakeuchiWindowOptions = {
  focus?: boolean
}

export async function ensureTakeuchiWindow(options: EnsureTakeuchiWindowOptions = {}) {
  if (!isTauri()) return

  const focus = options.focus ?? false
  const existing = await WebviewWindow.getByLabel('takeuchi')
  if (existing) {
    await existing.show()
    if (focus) await existing.setFocus()
    return
  }

  const win = new WebviewWindow('takeuchi', {
    title: 'takeuchi',
    url: 'takeuchi.html',
    width: 1280,
    height: 720,
    resizable: true,
    visible: true,
  })

  win.once('tauri://error', (e) => {
    console.error('takeuchiウインドウ作成エラー:', e)
  })
}
