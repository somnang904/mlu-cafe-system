import { useCallback, useLayoutEffect, useState } from 'react'

export function useScrollFade(ref, size = 40) {
  const [edges, setEdges] = useState({ start: false, end: false })

  const update = useCallback(() => {
    const node = ref.current
    if (!node) return
    const start = node.scrollTop > 1
    const end = node.scrollTop < node.scrollHeight - node.clientHeight - 1
    setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
  }, [ref])

  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return undefined
    update()
    const resize = new ResizeObserver(update)
    resize.observe(node)
    const watchChildren = () => {
      for (const child of node.children) resize.observe(child)
      update()
    }
    watchChildren()
    const mutations = new MutationObserver(watchChildren)
    mutations.observe(node, { childList: true, subtree: true })
    return () => {
      resize.disconnect()
      mutations.disconnect()
    }
  }, [ref, update])

  const mask = `linear-gradient(to bottom, ${edges.start ? `transparent, #000 ${size}px` : '#000'}, ${
    edges.end ? `#000 calc(100% - ${size}px), transparent` : '#000'
  })`

  return { onScroll: update, style: { maskImage: mask, WebkitMaskImage: mask } }
}
