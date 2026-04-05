'use client'
import { useEffect, useRef } from 'react'

/* ── Seam helpers (Variant 3: Authentic Random) ── */
function seamH(r, c) {
  const v = Math.sin(r * 127.1 + c * 311.7) * 43758.5453
  return (v - Math.floor(v)) > 0.5 ? 1 : -1
}
function seamV(r, c) {
  const v = Math.sin(r * 269.5 + c * 183.3) * 43758.5453
  return (v - Math.floor(v)) > 0.5 ? 1 : -1
}

const FILLS = [
  ['rgba(255,248,228,0.80)', 'rgba(238,218,168,0.66)'],
  ['rgba(252,242,210,0.84)', 'rgba(232,208,148,0.70)'],
  ['rgba(248,236,196,0.77)', 'rgba(228,198,128,0.62)'],
  ['rgba(255,252,238,0.82)', 'rgba(244,224,174,0.72)'],
  ['rgba(244,232,188,0.74)', 'rgba(220,188,118,0.60)'],
]
function pickFill(r, c) {
  const i = Math.abs(Math.floor(Math.sin(r * 17 + c * 31 + r * c) * 1000)) % FILLS.length
  return FILLS[i]
}

function piecePath(ctx, x, y, S, B, n1, n2, dirs) {
  const { top, right, bottom, left } = dirs
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x + S * n1, y)
  ctx.bezierCurveTo(x + S*n1, y - B*top,    x + S*n2, y - B*top,    x + S*n2, y)
  ctx.lineTo(x + S, y)
  ctx.lineTo(x + S, y + S*n1)
  ctx.bezierCurveTo(x + S + B*right, y + S*n1, x + S + B*right, y + S*n2, x + S, y + S*n2)
  ctx.lineTo(x + S, y + S)
  ctx.lineTo(x + S*n2, y + S)
  ctx.bezierCurveTo(x + S*n2, y + S + B*bottom, x + S*n1, y + S + B*bottom, x + S*n1, y + S)
  ctx.lineTo(x, y + S)
  ctx.lineTo(x, y + S*n2)
  ctx.bezierCurveTo(x - B*left, y + S*n2, x - B*left, y + S*n1, x, y + S*n1)
  ctx.closePath()
}

function drawPuzzle(canvas) {
  const dpr = window.devicePixelRatio || 1
  const W   = window.innerWidth
  const H   = window.innerHeight
  canvas.width  = W * dpr
  canvas.height = H * dpr
  const ctx = canvas.getContext('2d')
  ctx.scale(dpr, dpr)

  const bg = ctx.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0,   '#faf4e8')
  bg.addColorStop(0.5, '#f2e4cc')
  bg.addColorStop(1,   '#e8d4b0')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  const S    = 85
  const B    = S * 0.30
  const n1   = 0.32
  const n2   = 0.68
  const cols = Math.ceil(W / S) + 2
  const rows = Math.ceil(H / S) + 2

  for (let r = -1; r < rows; r++) {
    for (let c = -1; c < cols; c++) {
      const x    = c * S
      const y    = r * S
      const dirs = {
        top:    -seamH(r,     c),
        bottom:  seamH(r + 1, c),
        left:   -seamV(r,     c),
        right:   seamV(r,     c + 1),
      }
      const [f0, f1] = pickFill(r, c)
      piecePath(ctx, x, y, S, B, n1, n2, dirs)

      const gr = ctx.createLinearGradient(x, y, x + S, y + S)
      gr.addColorStop(0, f0)
      gr.addColorStop(1, f1)

      ctx.save()
      ctx.shadowColor   = 'rgba(120,80,20,0.28)'
      ctx.shadowBlur    = 9
      ctx.shadowOffsetX = 1.5
      ctx.shadowOffsetY = 2.5
      ctx.fillStyle = gr
      ctx.fill()

      ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0
      ctx.strokeStyle = 'rgba(182,142,48,0.56)'
      ctx.lineWidth   = 1.3
      ctx.stroke()
      ctx.restore()
    }
  }
}

export default function PuzzleBackground() {
  const ref = useRef(null)

  useEffect(() => {
    if (!ref.current) return
    drawPuzzle(ref.current)
    const onResize = () => { if (ref.current) drawPuzzle(ref.current) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return (
    <canvas
      ref={ref}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: 0,
        pointerEvents: 'none',
        display: 'block',
      }}
    />
  )
}
