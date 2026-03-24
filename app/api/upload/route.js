import { supabase, supabaseAdmin } from '@/lib/supabase'
import sharp from 'sharp'

const MAX_UPLOADS = parseInt(process.env.MAX_UPLOADS_PER_DEVICE || '3')
const BUCKET = 'photos'

export async function POST(request) {
  const formData = await request.formData()
  const file     = formData.get('file')
  const deviceId = formData.get('deviceId')
  const isTarget = formData.get('isTarget') === 'true'

  if (!file) return Response.json({ error: 'missing file' }, { status: 400 })

  // Check upload limit (guests only)
  if (!isTarget && deviceId) {
    const { count } = await supabase
      .from('uploads')
      .select('*', { count: 'exact', head: true })
      .eq('device_id', deviceId)

    if (count >= MAX_UPLOADS) {
      return Response.json({ error: 'limit' }, { status: 429 })
    }
  }

  // Server-side compression with Sharp
  const raw = Buffer.from(await file.arrayBuffer())
  const processed = await sharp(raw)
    .resize(1000, 1000, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer()

  // Upload to Supabase storage
  const prefix   = isTarget ? 'target' : (deviceId || 'guest')
  const filename = `${prefix}-${Date.now()}.jpg`

  const { error: storageError } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(filename, processed, { contentType: 'image/jpeg', upsert: isTarget })

  if (storageError) {
    return Response.json({ error: storageError.message }, { status: 500 })
  }

  const { data: { publicUrl } } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(filename)

  // Save metadata to DB (guests only)
  if (!isTarget) {
    await supabaseAdmin.from('uploads').insert({
      image_url: publicUrl,
      filename,
      device_id: deviceId || 'unknown',
    })
  }

  return Response.json({ success: true, url: publicUrl })
}
