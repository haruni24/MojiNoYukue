import type { RenderMode, DebugSnapshot } from './types'
import './DebugPanel.css'

export type DebugPanelProps = {
  renderMode: RenderMode
  onRenderModeChange: (mode: RenderMode) => void
  selectedMaskIndex: number | 'auto'
  onMaskIndexChange: (index: number | 'auto') => void
  maskIndexOptions: Array<{ index: number; label: string }>
  debugText: string
  debugSnapshot: DebugSnapshot | null
  segmenterDisabled: boolean
  onCaptureSnapshot: () => void
}

export function DebugPanel({
  renderMode,
  onRenderModeChange,
  selectedMaskIndex,
  onMaskIndexChange,
  maskIndexOptions,
  debugText,
  debugSnapshot,
  segmenterDisabled,
  onCaptureSnapshot,
}: DebugPanelProps) {
  return (
    <>
      <div className="controls">
        <button type="button" onClick={onCaptureSnapshot} className="glass-button glass-button--secondary">
          スナップショット
        </button>
      </div>
      <details className="debug-panel" open>
        <summary className="debug-panel__summary">デバッグパネル</summary>
        <div className="debug-panel__row">
          <label className="debug-panel__field">
            表示モード
            <select value={renderMode} onChange={(e) => onRenderModeChange(e.target.value as RenderMode)}>
              <option value="composite">合成（通常）</option>
              <option value="raw">元映像のみ</option>
              <option value="mask">マスクのみ</option>
              <option value="background">背景のみ</option>
              <option value="test">テストパターン</option>
            </select>
          </label>

          <label className="debug-panel__field">
            マスク
            <select
              value={selectedMaskIndex === 'auto' ? 'auto' : String(selectedMaskIndex)}
              onChange={(e) => {
                const value = e.target.value
                onMaskIndexChange(value === 'auto' ? 'auto' : Number(value))
              }}
              disabled={segmenterDisabled}
            >
              <option value="auto">auto</option>
              {maskIndexOptions.map(({ index, label }) => (
                <option key={index} value={String(index)}>
                  {label ? `${index}: ${label}` : index}
                </option>
              ))}
            </select>
          </label>
        </div>

        <pre className="debug-panel__log">{debugText || '...'}</pre>
        {debugSnapshot && <pre className="debug-panel__snapshot">{JSON.stringify(debugSnapshot, null, 2)}</pre>}
      </details>
    </>
  )
}
