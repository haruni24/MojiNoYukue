import { useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import './CommentOverlay.css'
import { useFloatingComments } from './useFloatingComments'

export type CommentOverlayProps = {
  lifetimeMs?: number
  maxLength?: number
  maxVisible?: number
  placeholder?: string
}

export function CommentOverlay({
  lifetimeMs = 5200,
  maxLength = 80,
  maxVisible = 6,
  placeholder = 'コメントを入力…',
}: CommentOverlayProps) {
  const { comments, addComment } = useFloatingComments({ lifetimeMs })
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const overlayStyle = useMemo(
    () => ({
      '--comment-duration': `${lifetimeMs}ms`,
    }) as CSSProperties,
    [lifetimeMs]
  )

  const visibleComments = useMemo(() => {
    if (!Number.isFinite(maxVisible) || maxVisible <= 0) return comments
    return comments.slice(-maxVisible)
  }, [comments, maxVisible])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const normalized = text.trim().slice(0, maxLength)
    if (!normalized) return

    addComment(normalized)
    setText('')
    inputRef.current?.focus()
  }

  return (
    <div className="commentOverlay" style={overlayStyle}>
      <div className="commentOverlay__stack" aria-live="polite">
        {visibleComments.map((comment) => (
          <div key={comment.id} className="commentOverlay__bubble">
            {comment.text}
          </div>
        ))}
      </div>

      <form className="commentOverlay__composer" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          className="commentOverlay__input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          autoComplete="off"
          enterKeyHint="send"
          aria-label="コメント"
        />
        <button
          type="submit"
          className="commentOverlay__submit"
          disabled={!text.trim()}
        >
          送信
        </button>
      </form>
    </div>
  )
}

