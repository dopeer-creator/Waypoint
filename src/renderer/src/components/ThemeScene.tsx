import { useEffect, useRef } from 'react'
import type { ThemeId } from '@shared/types'

/**
 * Animated decorative background for the destination themes. When the user has dropped a wallpaper in for a theme,
 * that photo shows behind a readable scrim and the animated layer plays on top; otherwise original vector art is
 * drawn. Everything is code (SVG + canvas), no bundled artwork. Sits behind content and ignores pointer events.
 */
export function ThemeScene({ theme, bgUrl, dim }: { theme: ThemeId; bgUrl: string | null; dim: number }) {
  const photo = !!bgUrl
  const scene = (() => {
    switch (theme) {
      case 'ragnarok':
        return <RagnarokScene photo={photo} />
      case 'jackdaw':
        return <JackdawScene photo={photo} />
      case 'nightcity':
        return <NightCityScene photo={photo} />
      case 'tsushima':
        return <TsushimaScene photo={photo} />
      case 'wasteland':
        return <WastelandScene photo={photo} />
      default:
        return null
    }
  })()
  if (!scene) return null

  const style = bgUrl ? ({ '--scene-bg': `url("${bgUrl}")`, '--scene-dim': `${dim / 100}` } as React.CSSProperties) : undefined
  return (
    <div className={`scene scene-${theme}`} data-photo={photo} style={style} aria-hidden>
      {photo && <div className="scene-photo" />}
      {scene}
    </div>
  )
}

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Sizes a canvas to its parent and runs a draw callback each frame until unmounted. */
function useCanvas(draw: (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    let w = 0
    let h = 0
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      w = rect.width
      h = rect.height
      canvas.width = Math.max(1, Math.floor(w * dpr))
      canvas.height = Math.max(1, Math.floor(h * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    let raf = 0
    let stopped = false
    const still = reduceMotion()
    const loop = (t: number) => {
      if (stopped) return
      draw(ctx, w, h, t)
      if (!still) raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return ref
}

// Ragnarök — carved stone frieze: world serpent, Fenrir, shields and spears, runic bands, flickering embers.
function RagnarokScene({ photo }: { photo: boolean }) {
  return (
    <>
      {!photo && (
        <svg className="scene-art" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">
          <g className="rag-runes" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M60 60v40M60 74l20-14M60 74l20 14" />
            <path d="M120 56v44M120 56l18 22M120 78h18" />
            <path d="M1360 60v40M1360 60l20 20-20 20" />
            <path d="M1300 58v44M1300 58l20 12-20 12 20 12" />
          </g>
          <path className="rag-serpent" d="M-40 720C160 640 260 800 460 720S760 620 960 700s360 40 540-40" fill="none" stroke="currentColor" strokeWidth="6" />
          <g className="rag-frieze" fill="currentColor">
            <path d="M250 560l60 40v120h-120v-120z" opacity="0.5" />
            <circle cx="310" cy="620" r="34" opacity="0.35" />
            <path d="M700 540v190M690 560l10-24 10 24" opacity="0.5" />
            <path d="M740 540v190M730 560l10-24 10 24" opacity="0.5" />
            <circle cx="1040" cy="600" r="46" opacity="0.3" />
            <path d="M1010 600h60M1040 570v60" stroke="currentColor" strokeWidth="6" opacity="0.5" />
          </g>
          <g className="rag-wolf" fill="none" stroke="currentColor" strokeWidth="5" opacity="0.55">
            <path d="M980 300l70-40 40 30 60-10-20 50 30 40-70 10-40 40-30-60-50-10z" />
            <circle cx="1050" cy="300" r="6" fill="currentColor" />
          </g>
        </svg>
      )}
      <div className="rag-embers" />
    </>
  )
}

// Jackdaw — parchment sea chart: compass rose, dashed route with X marks, island, ship, sea serpent.
function JackdawScene({ photo }: { photo: boolean }) {
  if (photo) return null
  return (
    <svg className="scene-art" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">
      <g className="jd-compass" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="1200" cy="220" r="120" />
        <circle cx="1200" cy="220" r="90" strokeDasharray="4 8" />
        <path d="M1200 80l16 140-16 20-16-20zM1200 360l16-140-16-20-16 20zM1060 220l140 16 20-16-20-16zM1340 220l-140 16-20-16 20-16z" fill="currentColor" fillOpacity="0.25" />
      </g>
      <path className="jd-route" d="M120 700C300 560 380 600 520 500S780 360 980 420" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="2 14" strokeLinecap="round" />
      <g className="jd-x" stroke="currentColor" strokeWidth="4">
        <path d="M512 492l16 16M528 492l-16 16" />
        <path d="M972 412l16 16M988 412l-16 16" />
      </g>
      <path className="jd-island" d="M240 640c40-30 120-40 170-10s90 10 120 40-20 70-90 76-190 10-220-30 0-46 20-76z" fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeWidth="2" />
      <g className="jd-ship" stroke="currentColor" strokeWidth="3" fill="none">
        <path d="M560 250h120l-20 40h-80z" fill="currentColor" fillOpacity="0.15" />
        <path d="M620 250V110M620 130h70l-70 30M620 150h60l-60 26" fill="currentColor" fillOpacity="0.1" />
      </g>
      <path className="jd-serpent" d="M980 720q40-40 80 0t80 0 80 0 80 0" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

// Night City — neon HUD: brackets, scan bar, barcode, circuit arcs, hazard block, pulsing glow (glow stays over photos).
function NightCityScene({ photo }: { photo: boolean }) {
  const bars = Array.from({ length: 40 }, (_, i) => 2 + ((i * 37) % 7))
  let x = 0
  if (photo) return null
  return (
    <svg className="scene-art" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">
      <g stroke="currentColor" strokeWidth="2" fill="none" opacity="0.5">
        <path d="M40 40h80M40 40v80" />
        <path d="M1400 860h-80M1400 860v-80" />
        <path d="M1400 40h-80M1400 40v80" />
        <path d="M40 860h80M40 860v-80" />
      </g>
      <g className="nc-ticks" stroke="currentColor" strokeWidth="2" opacity="0.4">
        {Array.from({ length: 16 }, (_, i) => (
          <path key={i} d={`M60 ${140 + i * 34}h${i % 4 === 0 ? 26 : 14}`} />
        ))}
      </g>
      <g className="nc-arcs" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="1300" cy="760" r="70" strokeDasharray="80 40" opacity="0.4" />
        <circle cx="1300" cy="760" r="110" strokeDasharray="30 60" opacity="0.25" />
      </g>
      <g className="nc-bars" fill="currentColor" opacity="0.6">
        {bars.map((w, i) => {
          const rect = <rect key={i} x={120 + x} y={92} width={w} height={26} />
          x += w + 3
          return rect
        })}
      </g>
      <rect className="nc-scan" x="120" y="0" width="900" height="2" fill="currentColor" />
      <g className="nc-grid" stroke="currentColor" strokeWidth="1" opacity="0.06">
        {Array.from({ length: 18 }, (_, i) => (
          <path key={`h${i}`} d={`M0 ${i * 52}h1440`} />
        ))}
      </g>
    </svg>
  )
}

// Tsushima — rice paper, red sun, ink mountains, gnarled branch and drifting leaves; ink spreads from the cursor.
function TsushimaScene({ photo }: { photo: boolean }) {
  const blotsRef = useRef<{ x: number; y: number; r: number; max: number; life: number }[]>([])
  const ref = useCanvas((ctx, w, h) => {
    ctx.clearRect(0, 0, w, h)
    const blots = blotsRef.current
    for (let i = blots.length - 1; i >= 0; i--) {
      const b = blots[i]
      b.r += (b.max - b.r) * 0.08
      b.life -= 0.012
      if (b.life <= 0) {
        blots.splice(i, 1)
        continue
      }
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r)
      const a = Math.min(0.2, b.life * 0.2)
      g.addColorStop(0, `rgba(150,120,88,${a})`)
      g.addColorStop(0.7, `rgba(150,120,88,${a * 0.5})`)
      g.addColorStop(1, 'rgba(150,120,88,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2)
      ctx.fill()
    }
  })

  useEffect(() => {
    if (reduceMotion()) return
    let last = 0
    const onMove = (e: PointerEvent) => {
      const canvas = ref.current
      if (!canvas) return
      const now = performance.now()
      if (now - last < 90) return
      last = now
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) return
      const blots = blotsRef.current
      blots.push({ x, y, r: 4, max: 26 + Math.random() * 34, life: 1 })
      if (blots.length > 40) blots.splice(0, blots.length - 40)
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [ref])

  return (
    <>
      {!photo && (
        <svg className="scene-art" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">
          <circle className="ts-sun" cx="1180" cy="230" r="140" fill="currentColor" fillOpacity="0.16" />
          <path className="ts-mountain" d="M-40 760l260-180 180 120 220-200 260 190 240-120 300 160v230H-40z" fill="currentColor" fillOpacity="0.1" />
          <g className="ts-branch" stroke="currentColor" strokeWidth="5" fill="none" opacity="0.4">
            <path d="M0 120c120 30 200 90 250 180M120 150c30 20 40 50 40 90M200 190c40 10 70 40 80 90" />
          </g>
          <g className="ts-leaves" fill="currentColor">
            <path className="ts-leaf" d="M300 300q20-16 40 0-20 16-40 0z" opacity="0.4" />
            <path className="ts-leaf ts-leaf2" d="M600 200q20-16 40 0-20 16-40 0z" opacity="0.35" />
            <path className="ts-leaf ts-leaf3" d="M900 340q20-16 40 0-20 16-40 0z" opacity="0.4" />
          </g>
        </svg>
      )}
      <canvas className="ts-ink" ref={ref} />
    </>
  )
}

// Wasteland — Matrix code rain, scanlines (rain and scanlines stay over photos too).
function WastelandScene({ photo }: { photo: boolean }) {
  const glyphs = 'ｱｲｳｴｵｶｷｸ01ﾊﾋﾎ7ﾘ4ﾑ2ﾃ9ﾈ'
  const dropsRef = useRef<number[]>([])
  const ref = useCanvas((ctx, w, h) => {
    const fontSize = 15
    const cols = Math.floor(w / fontSize)
    const drops = dropsRef.current
    if (drops.length !== cols) {
      drops.length = cols
      for (let i = 0; i < cols; i++) if (drops[i] === undefined) drops[i] = Math.random() * -50
    }
    ctx.fillStyle = photo ? 'rgba(4,8,4,0.24)' : 'rgba(4,8,4,0.16)'
    ctx.fillRect(0, 0, w, h)
    ctx.font = `${fontSize}px "Cascadia Mono", Consolas, monospace`
    for (let i = 0; i < cols; i++) {
      const ch = glyphs[Math.floor(Math.random() * glyphs.length)]
      const x = i * fontSize
      const y = drops[i] * fontSize
      ctx.fillStyle = 'rgba(210,255,220,0.9)'
      ctx.fillText(ch, x, y)
      ctx.fillStyle = 'rgba(60,240,122,0.55)'
      ctx.fillText(ch, x, y - fontSize)
      if (y > h && Math.random() > 0.975) drops[i] = 0
      drops[i] += 0.5
    }
  })
  return (
    <>
      <canvas className="wl-rain" ref={ref} />
      <div className="wl-scanlines" />
      {!photo && <div className="wl-vignette" />}
    </>
  )
}
