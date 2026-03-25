import sharp from 'sharp'
import https from 'https'
import http from 'http'

const GRID_SIZE    = 35
const TILE_SIZE    = 100
const OUTPUT_SIZE  = GRID_SIZE * TILE_SIZE   // 3500 × 3500
const MAX_REUSE    = 3
const BLEND        = 0.45    // color tint strength (0=none, 1=full color)
const GHOST        = 0.15    // ghost overlay opacity
const VARS_PER_IMG = 8       // pre-generate N variations per source image

// ── Image download ───────────────────────────────────────────────────────────
async function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http
    protocol.get(url, (res) => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks)))
      res.on('error', reject)
    }).on('error', reject)
  })
}

async function getAverageColor(buffer) {
  const { data } = await sharp(buffer)
    .resize(1, 1).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true })
  return { r: data[0], g: data[1], b: data[2] }
}

// ── Perceptual color matching via CIE LAB ────────────────────────────────────
function rgbToLab(r, g, b) {
  let R = r / 255, G = g / 255, B = b / 255
  R = R > 0.04045 ? ((R + 0.055) / 1.055) ** 2.4 : R / 12.92
  G = G > 0.04045 ? ((G + 0.055) / 1.055) ** 2.4 : G / 12.92
  B = B > 0.04045 ? ((B + 0.055) / 1.055) ** 2.4 : B / 12.92
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047
  const Y = (R * 0.2126 + G * 0.7152 + B * 0.0722) / 1.00000
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883
  const f = v => v > 0.008856 ? v ** (1/3) : 7.787 * v + 16 / 116
  return { L: 116 * f(Y) - 16, a: 500 * (f(X) - f(Y)), b: 200 * (f(Y) - f(Z)) }
}

function labDist(a, b) {
  return (a.L - b.L) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2
}

// ── Tile variation generation ─────────────────────────────────────────────────
async function makeVariation(buffer, index) {
  const flip       = index % 3 === 0
  const brightness = 0.85 + (index % 5) * 0.08   // 0.85 → 1.17
  const saturation = 0.75 + (index % 4) * 0.15   // 0.75 → 1.20

  // Randomly zoom/crop into different parts of the image
  const meta   = await sharp(buffer).metadata()
  const w      = meta.width  || TILE_SIZE
  const h      = meta.height || TILE_SIZE
  const zoom   = 0.75 + (index % 4) * 0.08       // 0.75 → 0.99
  const cropW  = Math.round(w * zoom)
  const cropH  = Math.round(h * zoom)
  const left   = Math.floor((w - cropW) * (index % 5) / 4)
  const top    = Math.floor((h - cropH) * (index % 3) / 2)

  let img = sharp(buffer).extract({ left, top, width: cropW, height: cropH })
  if (flip) img = img.flop()
  return img
    .modulate({ brightness, saturation })
    .resize(TILE_SIZE, TILE_SIZE, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer()
}

// ── Apply color tint directly on raw buffer (no Sharp = very fast) ───────────
function applyTint(rawBuf, tc) {
  const out = Buffer.from(rawBuf)
  const iB  = 1 - BLEND
  for (let i = 0; i < out.length; i += 3) {
    out[i]     = Math.round(out[i]     * iB + tc.r * BLEND)
    out[i + 1] = Math.round(out[i + 1] * iB + tc.g * BLEND)
    out[i + 2] = Math.round(out[i + 2] * iB + tc.b * BLEND)
  }
  return out
}

// ── Main mosaic generator ─────────────────────────────────────────────────────
export async function generateMosaic(targetUrl, tileEntries, onProgress) {
  const total = GRID_SIZE * GRID_SIZE

  // 1. Download & analyse tiles
  onProgress?.('download', 0, tileEntries.length)
  const tiles = []
  for (let i = 0; i < tileEntries.length; i++) {
    try {
      const buffer   = await downloadImage(tileEntries[i].image_url)
      const avgColor = await getAverageColor(buffer)
      const lab      = rgbToLab(avgColor.r, avgColor.g, avgColor.b)
      tiles.push({ id: i, buffer, avgColor, lab })
    } catch { /* skip */ }
    if (i % 20 === 0) onProgress?.('download', i, tileEntries.length)
  }
  if (!tiles.length) throw new Error('No tiles downloaded')

  // 2. Pre-generate diverse variations as raw RGB buffers
  onProgress?.('variations', 0, tiles.length)
  const tileVariants = new Map()
  for (let i = 0; i < tiles.length; i++) {
    const vars = []
    for (let v = 0; v < VARS_PER_IMG; v++) {
      try { vars.push(await makeVariation(tiles[i].buffer, v)) }
      catch { if (vars.length === 0) vars.push(await makeVariation(tiles[i].buffer, 0)) }
    }
    tileVariants.set(tiles[i].id, vars)
    if (i % 5 === 0) onProgress?.('variations', i, tiles.length)
  }

  // 3. Analyse target image (LAB colors per grid cell)
  onProgress?.('target', 0, 1)
  const targetBuf = await downloadImage(targetUrl)
  const raw       = await sharp(targetBuf)
    .resize(GRID_SIZE, GRID_SIZE)
    .removeAlpha().raw().toBuffer()

  const targetColors = Array.from({ length: total }, (_, i) => ({
    r: raw[i * 3], g: raw[i * 3 + 1], b: raw[i * 3 + 2]
  }))
  const targetLabs = targetColors.map(tc => rgbToLab(tc.r, tc.g, tc.b))

  // 4. Match tiles using LAB distance
  onProgress?.('matching', 0, total)
  const usage       = new Map()
  const assignments = new Array(total)

  for (let pos = 0; pos < total; pos++) {
    const tLab       = targetLabs[pos]
    const x          = pos % GRID_SIZE
    const y          = Math.floor(pos / GRID_SIZE)
    const neighbours = new Set([
      x > 0 ? assignments[pos - 1]?.id         : null,
      y > 0 ? assignments[pos - GRID_SIZE]?.id  : null,
    ])

    let best = null, bestDist = Infinity
    for (const pass of [true, false]) {
      for (const t of tiles) {
        if ((usage.get(t.id) || 0) >= MAX_REUSE) continue
        if (pass && neighbours.has(t.id)) continue
        const d = labDist(tLab, t.lab)
        if (d < bestDist) { bestDist = d; best = t }
      }
      if (best) break
    }
    if (!best) best = tiles.reduce((a, b) =>
      (usage.get(a.id) || 0) <= (usage.get(b.id) || 0) ? a : b)

    assignments[pos] = best
    usage.set(best.id, (usage.get(best.id) || 0) + 1)
  }

  // 5. Build composite with tinted raw buffers (fast - no JPEG per tile)
  onProgress?.('composite', 0, total)
  const overlays = []

  for (let pos = 0; pos < total; pos++) {
    const tile   = assignments[pos]
    const vars   = tileVariants.get(tile.id)
    const raw    = vars[pos % vars.length]          // deterministic variant selection
    const tinted = applyTint(raw, targetColors[pos])

    overlays.push({
      input: tinted,
      raw:   { width: TILE_SIZE, height: TILE_SIZE, channels: 3 },
      left:  (pos % GRID_SIZE) * TILE_SIZE,
      top:   Math.floor(pos / GRID_SIZE) * TILE_SIZE,
    })

    if (pos % 100 === 0) onProgress?.('composite', pos, total)
  }

  onProgress?.('composite', total, total)

  // 6. Composite all tiles
  const mosaic = await sharp({
    create: { width: OUTPUT_SIZE, height: OUTPUT_SIZE, channels: 3, background: { r: 30, g: 30, b: 30 } }
  })
    .composite(overlays)
    .toBuffer({ resolveWithObject: false })

  // 7. Ghost overlay - blend target at low opacity for extra clarity
  const ghostBuf = await sharp(targetBuf)
    .resize(OUTPUT_SIZE, OUTPUT_SIZE)
    .removeAlpha()
    .toBuffer()

  const ghostOverlay = await sharp(ghostBuf)
    .modulate({ brightness: 1 })
    .toBuffer()

  const final = await sharp(mosaic)
    .composite([{ input: ghostOverlay, blend: 'soft-light', opacity: GHOST }])
    .modulate({ brightness: 1.04, saturation: 1.1 })   // subtle contrast boost
    .jpeg({ quality: 92 })
    .toBuffer()

  return final
}
