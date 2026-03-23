import sharp from 'sharp'
import https from 'https'
import http from 'http'

const GRID_SIZE = 35
const TILE_SIZE = 100
const OUTPUT_SIZE = GRID_SIZE * TILE_SIZE  // 3500x3500
const MAX_REUSE = 3

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
    .resize(1, 1)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { r: data[0], g: data[1], b: data[2] }
}

function colorDist(c1, c2) {
  return (c1.r - c2.r) ** 2 + (c1.g - c2.g) ** 2 + (c1.b - c2.b) ** 2
}

async function applyVariation(buffer) {
  const flip       = Math.random() > 0.65
  const brightness = 0.88 + Math.random() * 0.24
  const saturation = 0.80 + Math.random() * 0.40

  let img = sharp(buffer)
  if (flip) img = img.flop()
  return img.modulate({ brightness, saturation }).toBuffer()
}

export async function generateMosaic(targetUrl, tileEntries) {
  console.log(`Mosaic start: ${tileEntries.length} source images, ${GRID_SIZE}×${GRID_SIZE} grid`)

  // ── Download & analyse tiles ────────────────────────────────────────────
  const tiles = []
  for (let i = 0; i < tileEntries.length; i++) {
    try {
      const buffer   = await downloadImage(tileEntries[i].image_url)
      const avgColor = await getAverageColor(buffer)
      tiles.push({ id: i, buffer, avgColor })
    } catch (e) {
      console.error(`Tile ${i} failed:`, e.message)
    }
    if (i % 50 === 0) console.log(`  downloaded ${i}/${tileEntries.length}`)
  }
  if (!tiles.length) throw new Error('No tiles downloaded')

  // ── Analyse target image ────────────────────────────────────────────────
  const targetBuf     = await downloadImage(targetUrl)
  const targetResized = await sharp(targetBuf)
    .resize(GRID_SIZE, GRID_SIZE)
    .removeAlpha()
    .raw()
    .toBuffer()

  const targetColors = []
  for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
    const o = i * 3
    targetColors.push({ r: targetResized[o], g: targetResized[o + 1], b: targetResized[o + 2] })
  }

  // ── Match tiles ──────────────────────────────────────────────────────────
  const usage       = new Map()
  const assignments = new Array(GRID_SIZE * GRID_SIZE)

  for (let pos = 0; pos < GRID_SIZE * GRID_SIZE; pos++) {
    const tc  = targetColors[pos]
    const x   = pos % GRID_SIZE
    const y   = Math.floor(pos / GRID_SIZE)

    // Collect neighbour IDs to avoid repetition
    const neighbours = new Set()
    if (x > 0 && assignments[pos - 1])          neighbours.add(assignments[pos - 1].id)
    if (y > 0 && assignments[pos - GRID_SIZE])   neighbours.add(assignments[pos - GRID_SIZE].id)

    let best = null, bestDist = Infinity

    // Pass 1: obey all constraints
    for (const t of tiles) {
      if ((usage.get(t.id) || 0) >= MAX_REUSE) continue
      if (neighbours.has(t.id)) continue
      const d = colorDist(tc, t.avgColor)
      if (d < bestDist) { bestDist = d; best = t }
    }

    // Pass 2: ignore neighbour constraint
    if (!best) {
      for (const t of tiles) {
        if ((usage.get(t.id) || 0) >= MAX_REUSE) continue
        const d = colorDist(tc, t.avgColor)
        if (d < bestDist) { bestDist = d; best = t }
      }
    }

    // Pass 3: least-used tile
    if (!best) best = tiles.reduce((a, b) => (usage.get(a.id) || 0) <= (usage.get(b.id) || 0) ? a : b)

    assignments[pos] = best
    usage.set(best.id, (usage.get(best.id) || 0) + 1)
  }

  console.log('Assignments done, compositing…')

  // ── Build composite ──────────────────────────────────────────────────────
  const overlays = []
  for (let pos = 0; pos < GRID_SIZE * GRID_SIZE; pos++) {
    const tile = assignments[pos]
    if (!tile) continue

    const x = (pos % GRID_SIZE) * TILE_SIZE
    const y = Math.floor(pos / GRID_SIZE) * TILE_SIZE

    const varied  = await applyVariation(tile.buffer)
    const resized = await sharp(varied)
      .resize(TILE_SIZE, TILE_SIZE, { fit: 'cover' })
      .jpeg({ quality: 85 })
      .toBuffer()

    overlays.push({ input: resized, left: x, top: y })
  }

  const final = await sharp({
    create: { width: OUTPUT_SIZE, height: OUTPUT_SIZE, channels: 3, background: { r: 240, g: 240, b: 240 } }
  })
    .composite(overlays)
    .jpeg({ quality: 90 })
    .toBuffer()

  console.log(`Mosaic done: ${(final.length / 1024 / 1024).toFixed(1)} MB`)
  return final
}
