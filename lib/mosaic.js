import sharp from 'sharp'
import https from 'https'
import http from 'http'

const GRID_SIZE    = 70
const TILE_SIZE    = 80     // 80px tiles → 5600×5600 output
const OUTPUT_SIZE  = GRID_SIZE * TILE_SIZE
const BLEND        = 0.40
const GHOST        = 0.15
const VARS_PER_IMG = 8

// ── Download ─────────────────────────────────────────────────────────────────
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

// ── CIE LAB color matching ───────────────────────────────────────────────────
function rgbToLab(r, g, b) {
  let R = r / 255, G = g / 255, B = b / 255
  R = R > 0.04045 ? ((R + 0.055) / 1.055) ** 2.4 : R / 12.92
  G = G > 0.04045 ? ((G + 0.055) / 1.055) ** 2.4 : G / 12.92
  B = B > 0.04045 ? ((B + 0.055) / 1.055) ** 2.4 : B / 12.92
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047
  const Y = (R * 0.2126 + G * 0.7152 + B * 0.0722)
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883
  const f = v => v > 0.008856 ? v ** (1/3) : 7.787 * v + 16/116
  return { L: 116 * f(Y) - 16, a: 500 * (f(X) - f(Y)), b: 200 * (f(Y) - f(Z)) }
}

function labDist(a, b) {
  return (a.L - b.L) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2
}

// ── Variations ───────────────────────────────────────────────────────────────
async function makeVariation(buffer, index) {
  const flip       = index % 3 === 0
  const brightness = 0.85 + (index % 5) * 0.08
  const saturation = 0.75 + (index % 4) * 0.15
  let img = sharp(buffer)
  if (flip) img = img.flop()
  return img
    .modulate({ brightness, saturation })
    .resize(TILE_SIZE, TILE_SIZE, { fit: 'cover' })
    .removeAlpha().raw().toBuffer()
}

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

// ── Main ─────────────────────────────────────────────────────────────────────
export async function generateMosaic(targetUrl, tileEntries, onProgress) {
  const total    = GRID_SIZE * GRID_SIZE
  const MAX_REUSE = Math.max(3, Math.ceil(total / Math.max(tileEntries.length, 1)) + 2)

  // 1. Download & analyse tiles
  onProgress?.('download', 0, tileEntries.length)
  const tiles = []
  for (let i = 0; i < tileEntries.length; i++) {
    try {
      const raw      = await downloadImage(tileEntries[i].image_url)
      // Force convert to JPEG - handles HEIC, WebP, PNG, any format
      const buffer   = await sharp(raw).jpeg({ quality: 85 }).toBuffer()
      const avgColor = await getAverageColor(buffer)
      const lab      = rgbToLab(avgColor.r, avgColor.g, avgColor.b)
      tiles.push({ id: i, buffer, avgColor, lab })
    } catch { /* skip unsupported formats */ }
    if (i % 20 === 0) onProgress?.('download', i, tileEntries.length)
  }
  if (!tiles.length) throw new Error('No tiles downloaded')

  // 2. Pre-generate variations
  onProgress?.('variations', 0, tiles.length)
  const tileVariants = new Map()
  for (let i = 0; i < tiles.length; i++) {
    const vars = []
    for (let v = 0; v < VARS_PER_IMG; v++) {
      try { vars.push(await makeVariation(tiles[i].buffer, v)) } catch {}
    }
    if (vars.length === 0) {
      try { vars.push(await sharp(tiles[i].buffer).resize(TILE_SIZE, TILE_SIZE, { fit: 'cover' }).removeAlpha().raw().toBuffer()) } catch {}
    }
    if (vars.length > 0) tileVariants.set(tiles[i].id, vars)
    if (i % 5 === 0) onProgress?.('variations', i, tiles.length)
  }

  // 3. Analyse target image
  onProgress?.('target', 0, 1)
  const targetRaw = await downloadImage(targetUrl)
  const targetBuf = await sharp(targetRaw).jpeg({ quality: 90 }).toBuffer()
  const raw       = await sharp(targetBuf)
    .resize(GRID_SIZE, GRID_SIZE).removeAlpha().raw().toBuffer()
  const targetColors = Array.from({ length: total }, (_, i) => ({
    r: raw[i * 3], g: raw[i * 3 + 1], b: raw[i * 3 + 2]
  }))
  const targetLabs = targetColors.map(tc => rgbToLab(tc.r, tc.g, tc.b))

  // 4. PHASE 1 - Guarantee every photo appears at least once
  onProgress?.('matching', 0, total)
  const assignments = new Array(total).fill(null)
  const usedInPhase1 = new Set()
  const usage = new Map()

  for (const tile of tiles) {
    let bestPos = -1, bestDist = Infinity
    for (let pos = 0; pos < total; pos++) {
      if (assignments[pos]) continue
      const d = labDist(targetLabs[pos], tile.lab)
      if (d < bestDist) { bestDist = d; bestPos = pos }
    }
    if (bestPos >= 0) {
      assignments[bestPos] = tile
      usedInPhase1.add(bestPos)
      usage.set(tile.id, 1)
    }
  }

  // 5. PHASE 2 - Fill remaining positions with randomized top-3 matching
  for (let pos = 0; pos < total; pos++) {
    if (assignments[pos]) continue

    const tLab       = targetLabs[pos]
    const x          = pos % GRID_SIZE
    const y          = Math.floor(pos / GRID_SIZE)
    const neighbours = new Set([
      x > 0 ? assignments[pos - 1]?.id         : null,
      y > 0 ? assignments[pos - GRID_SIZE]?.id  : null,
    ])

    let chosen = null
    for (const ignoreNeighbour of [false, true]) {
      const candidates = []
      for (const t of tiles) {
        if ((usage.get(t.id) || 0) >= MAX_REUSE) continue
        if (!ignoreNeighbour && neighbours.has(t.id)) continue
        candidates.push({ t, d: labDist(tLab, t.lab) })
      }
      if (candidates.length > 0) {
        candidates.sort((a, b) => a.d - b.d)
        // Pick randomly from top 3 (60/30/10 weight)
        const top = candidates.slice(0, 3)
        const rand = Math.random()
        chosen = rand < 0.6 ? top[0].t : rand < 0.9 ? (top[1]?.t || top[0].t) : (top[2]?.t || top[0].t)
        break
      }
    }
    if (!chosen) chosen = tiles.reduce((a, b) =>
      (usage.get(a.id) || 0) <= (usage.get(b.id) || 0) ? a : b)

    assignments[pos] = chosen
    usage.set(chosen.id, (usage.get(chosen.id) || 0) + 1)
  }

  // 6. Build composite
  onProgress?.('composite', 0, total)
  const overlays = []
  for (let pos = 0; pos < total; pos++) {
    const tile   = assignments[pos]
    const vars   = tileVariants.get(tile?.id)
    if (!vars?.length) continue

    const rawBuf = vars[Math.floor(Math.random() * vars.length)]
    const tinted = applyTint(rawBuf, targetColors[pos])
    overlays.push({
      input: tinted,
      raw:   { width: TILE_SIZE, height: TILE_SIZE, channels: 3 },
      left:  (pos % GRID_SIZE) * TILE_SIZE,
      top:   Math.floor(pos / GRID_SIZE) * TILE_SIZE,
    })
    if (pos % 200 === 0) onProgress?.('composite', pos, total)
  }
  onProgress?.('composite', total, total)

  // 7. Composite in strips of 10 rows (faster, keeps connection alive)
  const ROWS_PER_STRIP = 10
  const NUM_STRIPS     = Math.ceil(GRID_SIZE / ROWS_PER_STRIP)
  const stripHeight    = ROWS_PER_STRIP * TILE_SIZE
  const stripBuffers   = []

  for (let strip = 0; strip < NUM_STRIPS; strip++) {
    onProgress?.('finishing', strip, NUM_STRIPS)
    const startRow = strip * ROWS_PER_STRIP
    const endRow   = Math.min(startRow + ROWS_PER_STRIP, GRID_SIZE)
    const thisH    = (endRow - startRow) * TILE_SIZE

    const stripOverlays = overlays
      .filter(o => o.top >= startRow * TILE_SIZE && o.top < endRow * TILE_SIZE)
      .map(o => ({ ...o, top: o.top - startRow * TILE_SIZE }))

    const buf = await sharp({
      create: { width: OUTPUT_SIZE, height: thisH, channels: 3, background: { r: 20, g: 20, b: 20 } }
    }).composite(stripOverlays).raw().toBuffer()

    stripBuffers.push({ buf, top: startRow * TILE_SIZE, height: thisH })
  }

  // 8. Join strips into final image
  onProgress?.('finishing', NUM_STRIPS, NUM_STRIPS)
  const mosaic = await sharp({
    create: { width: OUTPUT_SIZE, height: OUTPUT_SIZE, channels: 3, background: { r: 20, g: 20, b: 20 } }
  }).composite(
    stripBuffers.map(s => ({
      input: s.buf,
      raw:   { width: OUTPUT_SIZE, height: s.height, channels: 3 },
      left:  0,
      top:   s.top,
    }))
  ).toBuffer()

  // 9. Ghost overlay
  const ghostWithAlpha = await sharp(targetBuf)
    .resize(OUTPUT_SIZE, OUTPUT_SIZE)
    .ensureAlpha(GHOST)
    .toBuffer()

  return sharp(mosaic)
    .composite([{ input: ghostWithAlpha, blend: 'over' }])
    .modulate({ brightness: 1.04, saturation: 1.1 })
    .jpeg({ quality: 90 })
    .toBuffer()
}
