import sharp from 'sharp'
import https from 'https'
import http from 'http'

const GRID_SIZE    = 50
const TILE_SIZE    = 98      // 98px tile + 2px gap = 100px step
const GRID_STEP    = 100     // spacing between tile origins
const OUTPUT_SIZE  = GRID_SIZE * GRID_STEP   // 5000 × 5000
const BLEND        = 0.28    // reduced tint - photos look more natural
const GHOST        = 0.20    // slightly stronger target visibility
const VARS_PER_IMG    = 3
const MIN_REUSE_DIST  = 7   // min distance (in tiles) before same photo can reappear

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

// ── Tile variation generation (with random crop) ──────────────────────────────
async function makeVariation(buffer, index) {
  const flip       = index % 3 === 0
  const brightness = 0.85 + (index % 5) * 0.08
  const saturation = 0.75 + (index % 4) * 0.15

  // Random crop: zoom into a random region (70-95% of original)
  const meta  = await sharp(buffer).metadata()
  const w     = meta.width  || 200
  const h     = meta.height || 200
  const zoom  = 0.70 + (index % 5) * 0.06   // 0.70 → 0.94
  const cropW = Math.max(1, Math.round(w * zoom))
  const cropH = Math.max(1, Math.round(h * zoom))
  const left  = Math.floor((w - cropW) * ((index * 7) % 11) / 10)
  const top   = Math.floor((h - cropH) * ((index * 3) % 7)  / 6)

  let img = sharp(buffer).extract({
    left:   Math.min(left, w - cropW),
    top:    Math.min(top,  h - cropH),
    width:  cropW,
    height: cropH,
  })
  if (flip) img = img.flop()
  return img
    .modulate({ brightness, saturation })
    .resize(TILE_SIZE, TILE_SIZE, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer()
}

// ── Center priority weight (1.0 at center → 0.4 at edges) ────────────────────
function centerWeight(pos, gridSize) {
  const x  = (pos % gridSize) / (gridSize - 1)   // 0..1
  const y  = Math.floor(pos / gridSize) / (gridSize - 1)
  const dx = x - 0.5
  const dy = y - 0.5
  const dist = Math.sqrt(dx * dx + dy * dy) * Math.SQRT2  // 0 (center) → 1 (corner)
  return 1.0 - dist * 0.6   // 1.0 at center, 0.4 at corner
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
  const total    = GRID_SIZE * GRID_SIZE
  // Auto-calculate max reuse so all tiles get filled
  const MAX_REUSE = Math.max(3, Math.ceil(total / Math.max(tileEntries.length, 1)) + 2)

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
      try { vars.push(await makeVariation(tiles[i].buffer, v)) } catch { /* skip */ }
    }
    // Fallback: plain resize if all variations failed
    if (vars.length === 0) {
      try {
        const plain = await sharp(tiles[i].buffer)
          .resize(TILE_SIZE, TILE_SIZE, { fit: 'cover' })
          .removeAlpha().raw().toBuffer()
        vars.push(plain)
      } catch { console.error(`Tile ${i} completely failed, skipping`) }
    }
    if (vars.length > 0) tileVariants.set(tiles[i].id, vars)
    tiles[i].buffer = null   // free original buffer - no longer needed
    if (i % 5 === 0) onProgress?.('variations', i, tiles.length)
  }

  // 3. Analyse target image - preprocess for better matching
  onProgress?.('target', 0, 1)
  const targetBuf = await downloadImage(targetUrl)

  // Sharpen + slight contrast boost before extracting colors
  const targetProcessed = await sharp(targetBuf)
    .sharpen({ sigma: 1.5, m1: 1.5, m2: 0.7 })
    .modulate({ brightness: 1.05, saturation: 1.1 })
    .toBuffer()

  const raw = await sharp(targetProcessed)
    .resize(GRID_SIZE, GRID_SIZE)
    .removeAlpha().raw().toBuffer()

  const targetColors = Array.from({ length: total }, (_, i) => ({
    r: raw[i * 3], g: raw[i * 3 + 1], b: raw[i * 3 + 2]
  }))
  const targetLabs = targetColors.map(tc => rgbToLab(tc.r, tc.g, tc.b))

  // 4. Match tiles using LAB distance
  onProgress?.('matching', 0, total)
  const usage         = new Map()
  const assignments   = new Array(total)
  const allPositions  = new Map()  // track ALL positions where each photo was placed

  // Phase 1: guarantee every photo appears at least once
  // Each photo finds its single best unoccupied position
  const takenInPhase1 = new Set()
  for (const tile of tiles) {
    let bestPos = -1, bestDist = Infinity
    for (let pos = 0; pos < total; pos++) {
      if (takenInPhase1.has(pos)) continue
      const d = labDist(targetLabs[pos], tile.lab)
      if (d < bestDist) { bestDist = d; bestPos = pos }
    }
    if (bestPos >= 0) {
      assignments[bestPos] = tile
      takenInPhase1.add(bestPos)
      usage.set(tile.id, 1)
      allPositions.set(tile.id, [bestPos])
    }
  }

  // Phase 2: fill remaining positions with best color match
  for (let pos = 0; pos < total; pos++) {
    if (assignments[pos]) continue   // already assigned in phase 1
    const tLab       = targetLabs[pos]
    const x          = pos % GRID_SIZE
    const y          = Math.floor(pos / GRID_SIZE)
    // Extended neighbours: check all 8 surrounding tiles
    const neighbours = new Set()
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        const nx = x + dx, ny = y + dy
        if (nx >= 0 && nx < GRID_SIZE && ny >= 0 && ny < GRID_SIZE) {
          neighbours.add(assignments[ny * GRID_SIZE + nx]?.id)
        }
      }
    }

    const weight    = centerWeight(pos, GRID_SIZE)
    const tolerance = (1 - weight) * 8000

    let best = null, bestDist = Infinity

    // 3 passes: strict → ignore distance constraint → ignore neighbours too
    for (const pass of [0, 1, 2]) {
      for (const t of tiles) {
        if ((usage.get(t.id) || 0) >= MAX_REUSE) continue
        if (pass < 2 && neighbours.has(t.id)) continue

        // Minimum distance from ALL previous positions of this photo
        if (pass < 1) {
          const prevPositions = allPositions.get(t.id)
          if (prevPositions) {
            const tooClose = prevPositions.some(prevPos => {
              const lx = prevPos % GRID_SIZE
              const ly = Math.floor(prevPos / GRID_SIZE)
              return Math.max(Math.abs(x - lx), Math.abs(y - ly)) < MIN_REUSE_DIST
            })
            if (tooClose) continue
          }
        }

        const d = labDist(tLab, t.lab) - tolerance
        if (d < bestDist) { bestDist = d; best = t }
      }
      if (best) break
    }
    if (!best) best = tiles.reduce((a, b) =>
      (usage.get(a.id) || 0) <= (usage.get(b.id) || 0) ? a : b)

    if (!assignments[pos]) {
      assignments[pos] = best
      usage.set(best.id, (usage.get(best.id) || 0) + 1)
      const positions = allPositions.get(best.id) || []
      positions.push(pos)
      allPositions.set(best.id, positions)
    }
  }

  // 5. Build composite with tinted raw buffers (fast - no JPEG per tile)
  onProgress?.('composite', 0, total)
  const overlays = []

  for (let pos = 0; pos < total; pos++) {
    const tile   = assignments[pos]
    const vars   = tileVariants.get(tile.id)
    if (!vars || vars.length === 0) continue
    const raw    = vars[Math.floor(Math.random() * vars.length)]
    const tinted = applyTint(raw, targetColors[pos])

    overlays.push({
      input: tinted,
      raw:   { width: TILE_SIZE, height: TILE_SIZE, channels: 3 },
      left:  (pos % GRID_SIZE) * GRID_STEP,
      top:   Math.floor(pos / GRID_SIZE) * GRID_STEP,
    })

    if (pos % 100 === 0) onProgress?.('composite', pos, total)
  }

  // 6. Composite in strips of 10 rows (avoids memory spike + keeps progress alive)
  const ROWS_PER_STRIP = 10
  const NUM_STRIPS     = Math.ceil(GRID_SIZE / ROWS_PER_STRIP)
  const strips         = []

  for (let s = 0; s < NUM_STRIPS; s++) {
    onProgress?.('composite', s, NUM_STRIPS)

    const startRow = s * ROWS_PER_STRIP
    const endRow   = Math.min(startRow + ROWS_PER_STRIP, GRID_SIZE)
    const stripH   = (endRow - startRow) * GRID_STEP

    const stripOverlays = overlays
      .filter(o => o.top >= startRow * GRID_STEP && o.top < endRow * GRID_STEP)
      .map(o => ({ ...o, top: o.top - startRow * GRID_STEP }))

    const stripBuf = await sharp({
      create: { width: OUTPUT_SIZE, height: stripH, channels: 3, background: { r: 30, g: 30, b: 30 } }
    })
      .composite(stripOverlays)
      .jpeg({ quality: 95 })   // JPEG = Sharp can read it back without format hints
      .toBuffer()

    strips.push({ input: stripBuf, left: 0, top: startRow * GRID_STEP })
  }

  onProgress?.('joining', 0, 1)

  // Join strips into final image
  const mosaic = await sharp({
    create: { width: OUTPUT_SIZE, height: OUTPUT_SIZE, channels: 3, background: { r: 30, g: 30, b: 30 } }
  })
    .composite(strips)
    .jpeg({ quality: 92 })
    .toBuffer()

  onProgress?.('blending', 1, 4)
  const ghostBuf  = await sharp(targetProcessed)
    .resize(OUTPUT_SIZE, OUTPUT_SIZE)
    .removeAlpha().raw().toBuffer()

  onProgress?.('blending', 2, 4)
  const mosaicRaw = await sharp(mosaic).raw().toBuffer()
  const blended   = Buffer.from(mosaicRaw)
  onProgress?.('blending', 3, 4)

  // Compute opacity once per tile position (2500 sqrt calls instead of 25M)
  const tileOpacity = new Float32Array(GRID_SIZE * GRID_SIZE)
  for (let pos = 0; pos < GRID_SIZE * GRID_SIZE; pos++) {
    const w = centerWeight(pos, GRID_SIZE)
    tileOpacity[pos] = 0.30 - (1 - w) * 0.22   // 0.30 center → 0.08 edge
  }

  // Apply blending using tile-level opacity lookup
  for (let py = 0; py < OUTPUT_SIZE; py++) {
    const ty      = Math.min(Math.floor(py / GRID_STEP), GRID_SIZE - 1)
    const rowBase = py * OUTPUT_SIZE * 3
    for (let px = 0; px < OUTPUT_SIZE; px++) {
      const tx      = Math.min(Math.floor(px / GRID_STEP), GRID_SIZE - 1)
      const opacity = tileOpacity[ty * GRID_SIZE + tx]
      const iO      = 1 - opacity
      const idx     = rowBase + px * 3
      blended[idx]     = (blended[idx]     * iO + ghostBuf[idx]     * opacity + 0.5) | 0
      blended[idx + 1] = (blended[idx + 1] * iO + ghostBuf[idx + 1] * opacity + 0.5) | 0
      blended[idx + 2] = (blended[idx + 2] * iO + ghostBuf[idx + 2] * opacity + 0.5) | 0
    }
  }

  onProgress?.('blending', 4, 4)
  const final = await sharp(blended, {
    raw: { width: OUTPUT_SIZE, height: OUTPUT_SIZE, channels: 3 }
  })
    .modulate({ brightness: 1.04, saturation: 1.1 })
    .jpeg({ quality: 88 })
    .toBuffer()

  return final
}
