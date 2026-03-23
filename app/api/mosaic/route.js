import { supabaseAdmin } from '@/lib/supabase'
import { generateMosaic } from '@/lib/mosaic'

export const maxDuration = 300  // 5 min (Railway has no hard limit)

export async function POST(request) {
  const { targetUrl } = await request.json()

  if (!targetUrl) {
    return Response.json({ error: 'Missing targetUrl' }, { status: 400 })
  }

  // Fetch all uploaded images
  const { data: images, error } = await supabaseAdmin
    .from('uploads')
    .select('image_url, filename')
    .order('created_at', { ascending: true })

  if (error || !images?.length) {
    return Response.json({ error: 'No images found' }, { status: 400 })
  }

  console.log(`Generating mosaic from ${images.length} images…`)

  const mosaicBuffer = await generateMosaic(targetUrl, images)

  // Upload mosaic to Supabase storage
  const filename = `mosaic-${Date.now()}.jpg`
  const { error: uploadError } = await supabaseAdmin.storage
    .from('photos')
    .upload(filename, mosaicBuffer, { contentType: 'image/jpeg' })

  if (uploadError) {
    return Response.json({ error: uploadError.message }, { status: 500 })
  }

  const { data: { publicUrl } } = supabaseAdmin.storage.from('photos').getPublicUrl(filename)

  return Response.json({ success: true, url: publicUrl })
}
