import React, { useRef, useEffect, useCallback, useMemo } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'

const ITEM_HEIGHT = 36 // px
const VISIBLE_COUNT = 3
const CONTAINER_HEIGHT = ITEM_HEIGHT * VISIBLE_COUNT // 108px
const PADDING_Y = (CONTAINER_HEIGHT - ITEM_HEIGHT) / 2 // 36px

function parse24to12(timeStr) {
  const match = String(timeStr || '').match(/^(\d{1,2}):(\d{2})/)
  if (!match) return { hour: 9, minute: 0, period: 'AM' }
  let h = Number.parseInt(match[1], 10)
  const m = Number.parseInt(match[2], 10)
  const period = h >= 12 ? 'PM' : 'AM'
  h = h % 12
  if (h === 0) h = 12
  return { hour: h, minute: Number.isNaN(m) ? 0 : m, period }
}

function format12to24(hour12, minute, period) {
  let h = Number(hour12)
  const m = Number(minute)
  if (period === 'PM') {
    h = h === 12 ? 12 : h + 12
  } else {
    h = h === 12 ? 0 : h
  }
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}`
}

function WheelColumn({ items, selectedIndex, onChange, className = '', wrap = true }) {
  const containerRef = useRef(null)
  const isProgrammaticScrollRef = useRef(false)
  const scrollEndTimerRef = useRef(null)

  const scrollToIndex = useCallback((index, smooth = true) => {
    if (!containerRef.current) return
    const targetTop = index * ITEM_HEIGHT
    if (Math.abs(containerRef.current.scrollTop - targetTop) > 1) {
      containerRef.current.scrollTo({
        top: targetTop,
        behavior: smooth ? 'smooth' : 'auto',
      })
    }
  }, [])

  useEffect(() => {
    scrollToIndex(selectedIndex, false)
  }, [selectedIndex, scrollToIndex])

  const step = useCallback((dir) => {
    let nextIndex = selectedIndex + dir
    if (wrap) {
      if (nextIndex < 0) nextIndex = items.length - 1
      if (nextIndex >= items.length) nextIndex = 0
    } else {
      nextIndex = Math.max(0, Math.min(items.length - 1, nextIndex))
    }

    if (nextIndex !== selectedIndex) {
      isProgrammaticScrollRef.current = true
      onChange(nextIndex)
      scrollToIndex(nextIndex, true)
      setTimeout(() => {
        isProgrammaticScrollRef.current = false
      }, 220)
    }
  }, [selectedIndex, items.length, wrap, onChange, scrollToIndex])

  const select = useCallback((index) => {
    if (index !== selectedIndex) {
      isProgrammaticScrollRef.current = true
      onChange(index)
      scrollToIndex(index, true)
      setTimeout(() => {
        isProgrammaticScrollRef.current = false
      }, 220)
    }
  }, [selectedIndex, onChange, scrollToIndex])

  const handleScroll = () => {
    if (isProgrammaticScrollRef.current) return
    if (scrollEndTimerRef.current) clearTimeout(scrollEndTimerRef.current)

    scrollEndTimerRef.current = setTimeout(() => {
      if (isProgrammaticScrollRef.current || !containerRef.current) return
      const top = containerRef.current.scrollTop
      const newIndex = Math.max(0, Math.min(items.length - 1, Math.round(top / ITEM_HEIGHT)))
      if (newIndex !== selectedIndex) {
        onChange(newIndex)
      }
    }, 120)
  }

  const handleWheel = (e) => {
    e.preventDefault()
    e.stopPropagation()
    const direction = e.deltaY > 0 ? 1 : -1
    step(direction)
  }

  return (
    <div className={`relative flex flex-col items-center flex-1 select-none ${className}`}>
      <button
        type="button"
        tabIndex={-1}
        onClick={() => step(-1)}
        className="flex h-5 w-full items-center justify-center text-stone-500 hover:text-white transition-colors cursor-pointer rounded hover:bg-white/5 active:scale-90"
        aria-label="Previous"
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </button>

      <div
        ref={containerRef}
        onScroll={handleScroll}
        onWheel={handleWheel}
        style={{
          height: `${CONTAINER_HEIGHT}px`,
          paddingTop: `${PADDING_Y}px`,
          paddingBottom: `${PADDING_Y}px`,
        }}
        className="w-full overflow-y-auto no-scrollbar scroll-smooth snap-y snap-mandatory relative"
      >
        {items.map((item, idx) => {
          const isSelected = idx === selectedIndex
          const distance = Math.abs(idx - selectedIndex)

          let styleClass = 'opacity-20 text-stone-500 scale-90'
          if (isSelected) {
            styleClass = 'opacity-100 text-white font-bold scale-105 drop-shadow-sm'
          } else if (distance === 1) {
            styleClass = 'opacity-40 text-stone-300 dark:text-stone-400 font-medium scale-95 hover:opacity-80'
          }

          return (
            <div
              key={item.key ?? idx}
              onClick={() => select(idx)}
              style={{ height: `${ITEM_HEIGHT}px` }}
              className={`flex items-center justify-center snap-center cursor-pointer transition-all duration-150 select-none ${styleClass}`}
            >
              <span className="text-lg sm:text-xl font-semibold tracking-tight">{item.label}</span>
            </div>
          )
        })}
      </div>

      <button
        type="button"
        tabIndex={-1}
        onClick={() => step(1)}
        className="flex h-5 w-full items-center justify-center text-stone-500 hover:text-white transition-colors cursor-pointer rounded hover:bg-white/5 active:scale-90"
        aria-label="Next"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

export default function WheelTimePicker({
  value = '09:00',
  onChange,
  disabled = false,
  className = '',
}) {
  const { hour, minute, period } = useMemo(() => parse24to12(value), [value])

  const hours = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const h = i + 1
      return { value: h, label: String(h), key: `h-${h}` }
    })
  }, [])

  const minutes = useMemo(() => {
    return Array.from({ length: 60 }, (_, i) => {
      return { value: i, label: String(i).padStart(2, '0'), key: `m-${i}` }
    })
  }, [])

  const periods = useMemo(() => {
    return [
      { value: 'AM', label: 'AM', key: 'p-AM' },
      { value: 'PM', label: 'PM', key: 'p-PM' },
    ]
  }, [])

  const hourIndex = Math.max(0, hours.findIndex((h) => h.value === hour))
  const minuteIndex = Math.max(0, minutes.findIndex((m) => m.value === minute))
  const periodIndex = Math.max(0, periods.findIndex((p) => p.value === period))

  const handleHourChange = (idx) => {
    const nextH = hours[idx].value
    const next24 = format12to24(nextH, minute, period)
    onChange?.(next24)
  }

  const handleMinuteChange = (idx) => {
    const nextM = minutes[idx].value
    const next24 = format12to24(hour, nextM, period)
    onChange?.(next24)
  }

  const handlePeriodChange = (idx) => {
    const nextP = periods[idx].value
    const next24 = format12to24(hour, minute, nextP)
    onChange?.(next24)
  }

  return (
    <div
      className={`relative mx-auto w-full max-w-[240px] rounded-xl bg-[#15171a] border border-white/10 px-2 py-1 shadow-md overflow-hidden ${
        disabled ? 'pointer-events-none opacity-50' : ''
      } ${className}`}
    >
      <div
        className="pointer-events-none absolute left-2 right-2 rounded-lg bg-white/[0.09] border border-white/[0.08] backdrop-blur-sm"
        style={{
          height: `${ITEM_HEIGHT}px`,
          top: `${PADDING_Y + 20 + 4}px`,
        }}
      />

      <div
        className="pointer-events-none absolute inset-x-0 h-6 bg-gradient-to-b from-[#15171a] to-transparent z-10"
        style={{ top: '24px' }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 h-6 bg-gradient-to-t from-[#15171a] to-transparent z-10"
        style={{ bottom: '24px' }}
      />

      <div className="relative z-0 flex items-center justify-center gap-1">
        <WheelColumn
          items={hours}
          selectedIndex={hourIndex}
          onChange={handleHourChange}
          wrap={true}
          className="max-w-[62px]"
        />

        <div className="text-base font-bold text-stone-500 opacity-60 self-center select-none pb-0.5">
          :
        </div>

        <WheelColumn
          items={minutes}
          selectedIndex={minuteIndex}
          onChange={handleMinuteChange}
          wrap={true}
          className="max-w-[62px]"
        />

        <WheelColumn
          items={periods}
          selectedIndex={periodIndex}
          onChange={handlePeriodChange}
          wrap={true}
          className="max-w-[62px]"
        />
      </div>
    </div>
  )
}
