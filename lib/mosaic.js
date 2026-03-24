import sharp from 'sharp'
import https from 'https'
import http from 'http'

const GRID_SIZE    = 35
const TILE_SIZE    = 100
const OUTPUT_SIZE  = GRID_SIZE * TILE_SIZE
const MAX_REUSE    = 3
const BLEND        = 0.38   // color tint strength
const VARS_PER_IMG = 6      // pre-generate N variations per source image

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

function colorDist(c1, c2) {
  return (c1.r - c2.r) ** 2 + (c1.g - c2.g) ** 2 + (c1.b - c2.b) ** 2
}

async function makeVariation(buffer) {
  const flip       = Math.random() > 0.65
  const brightness = 0.88 + Math.random() * 0.24
  const saturation = 0.80 + Math.random() * 0.40
  let img = sharp(buffer)
  if (flip) img = img.flop()
  return img
    .modulate({ brightness, saturation })
    .resize(TILE_SIZE, TILE_SIZE, { fit: 'cover' })
    .removeAlpha()
    .raw()
    .toBuffer()
}

// Apply color tint directly on raw RGB buffer - no Sharp needed, very fast
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

export async function generateMosaic(targetUrl, tileEntries, onProgress) {
  const total = GRID_SIZE * GRID_SIZE
  onProgress?.('download', 0, tileEntries.length)

  // ── 1. Download & analyse tiles ─────────────────────────────────────────
  const tiles = []
  for (let i = 0; i < tileEntries.length; i++) {
    try {
      const buffer   = await downloadImage(tileEntries[i].image_url)
      const avgColor = await getAverageColor(buffer)
      tiles.push({ id: i, buffer, avgColor })
    } catch { /* skip failed downloads */ }
    if (i % 20 === 0) onProgress?.('download', i, tileEntries.length)
  }
  if (!tiles.length) throw new Error('No tiles downloaded')

  // ── 2. Pre-generate variations as raw RGB buffers (fast, reusable) ──────
  onProgress?.('variations', 0, tiles.length)
  const tileVariants = new Map()
  for (let i = 0; i < tiles.length; i++) {
    const vars = []
    for (let v = 0; v < VARS_PER_IMG; v++) {
      vars.push(await makeVariation(tiles[i].buffer))
    }
    tileVariants.set(tiles[i].id, vars)
    if (i % 5 === 0) onProgress?.('variations', i, tiles.length)
  }

  // ── 3. Analyse target image ──────────────────────────────────────────────
  onProgress?.('target', 0, 1)
  const targetBuf = await downloadImage(targetUrl)
  const raw       = await sharp(targetBuf)
    .resize(GRID_SIZE, GRID_SIZE)
    .removeAlpha().raw().toBuffer()

  const targetColors = Array.from({ length: total }, (_, i) => ({
    r: raw[i * 3], g: raw[i * 3 + 1], b: raw[i * 3 + 2]
  }))

  // ── 4. Match tiles ───────────────────────────────────────────────────────
  onProgress?.('matching', 0, total)
  const usage       = new Map()
  const assignments = new Array(total)

  for (let pos = 0; pos < total; pos++) {
    const tc         = targetColors[pos]
    const x          = pos % GRID_SIZE
    const y          = Math.floor(pos / GRID_SIZE)
    const neighbours = new Set([
      x > 0                ? assignments[pos - 1]?.id          : null,
      y > 0                ? assignments[pos - GRID_SIZE]?.id  : null,
    ])

    let best = null, bestDist = Infinity
    for (const pass of [true, false]) {
      for (const t of tiles) {
        if ((usage.get(t.id) || 0) >= MAX_REUSE) continue
        if (pass && neighbours.has(t.id)) continue
        const d = colorDist(tc, t.avgColor)
        if (d < bestDist) { bestDist = d; best = t }
      }
      if (best) break
    }
    if (!best) best = tiles.reduce((a, b) =>
      (usage.get(a.id) || 0) <= (usage.get(b.id) || 0) ? a : b)

    assignments[pos] = best
    usage.set(best.id, (usage.get(best.id) || 0) + 1)
  }

  // ── 5. Build composite using raw buffers (no JPEG per tile → fast!) ─────
  onProgress?.('composite', 0, total)
  const overlays = []

  for (let pos = 0; pos < total; pos++) {
    const tile   = assignments[pos]
    const vars   = tileVariants.get(tile.id)
    const raw    = vars[Math.floor(Math.random() * vars.length)]
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

  const final = await sharp({
    create: { width: OUTPUT_SIZE, height: OUTPUT_SIZE, channels: 3, background: { r: 240, g: 240, b: 240 } }
  })
    .composite(overlays)
    .jpeg({ quality: 90 })
    .toBuffer()

  return final
}
