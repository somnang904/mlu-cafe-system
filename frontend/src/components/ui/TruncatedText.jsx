import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import Tooltip from './Tooltip'

export default function TruncatedText({ text, className = '', wrapperClassName = '' }) {
  const ref = useRef(null)
  const [truncated, setTruncated] = useState(false)

  const measure = useCallback(() => {
    const node = ref.current
    if (!node?.parentNode) return
    const probe = node.cloneNode(true)
    Object.assign(probe.style, {
      position: 'absolute',
      visibility: 'hidden',
      pointerEvents: 'none',
      width: 'max-content',
      maxWidth: 'none',
      overflow: 'visible',
      textOverflow: 'clip',
    })
    node.parentNode.appendChild(probe)
    const fullWidth = probe.getBoundingClientRect().width
    probe.remove()
    setTruncated(fullWidth > node.getBoundingClientRect().width + 0.01)
  }, [])

  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return undefined
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    document.fonts?.ready.then(measure)
    return () => observer.disconnect()
  }, [text, measure])

  return (
    <Tooltip label={truncated ? text : null} className={wrapperClassName}>
      <span ref={ref} onMouseEnter={measure} className={`block min-w-0 truncate ${className}`.trim()}>
        {text}
      </span>
    </Tooltip>
  )
}
