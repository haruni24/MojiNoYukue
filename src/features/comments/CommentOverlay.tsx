import { useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import './CommentOverlay.css'
import { useFloatingComments, type FloatingComment } from './useFloatingComments'

const ANIMATION_CLASSES = [
  'commentOverlay__bubble--pop',
  'commentOverlay__bubble--bounce',
  'commentOverlay__bubble--shake',
  'commentOverlay__bubble--float',
  'commentOverlay__bubble--spin',
]

export type CommentOverlayProps = {
  lifetimeMs?: number
  maxLength?: number
  maxVisible?: number
  placeholder?: string
}

const getBubbleStyle = (comment: FloatingComment, duration: number): CSSProperties => ({
  '--comment-duration': `${duration}ms`,
  '--comment-x': `${comment.style.x}%`,
  '--comment-y': `${comment.style.y}%`,
  '--comment-scale': comment.style.scale,
  '--comment-rotation': `${comment.style.rotation}deg`,
} as CSSProperties)

export function CommentOverlay({
  lifetimeMs = 5200,
  maxLength = 80,
  maxVisible = 12,
  placeholder = 'コメントを入力…',
}: CommentOverlayProps) {
  const { comments, addComment } = useFloatingComments({ lifetimeMs })
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

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
    <div className="commentOverlay">
      {/* ランダム配置のコメント */}
      <div className="commentOverlay__canvas" aria-live="polite">
        {visibleComments.map((comment) => (
          <div
            key={comment.id}
            className={`commentOverlay__bubble ${ANIMATION_CLASSES[comment.style.animation]}`}
            style={getBubbleStyle(comment, lifetimeMs)}
          >
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

