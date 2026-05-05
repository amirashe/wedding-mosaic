import { supabase, supabaseAdmin } from '@/lib/supabase'
import { generateMosaic } from '@/lib/mosaic'

export async function POST(request) {
  const { targetUrl, params } = await request.json()
  if (!targetUrl) return Response.json({ error: 'Missing targetUrl' }, { status: 400 })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SECRET_KEY

  const imgRes = await fetch(
    `${supabaseUrl}/rest/v1/uploads?select=image_url&order=created_at.asc`,
    { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }, cache: 'no-store' }
  )
  const images = await imgRes.json()

  if (!Array.isArray(images) || !images.length) return Response.json({ error: 'No images' }, { status: 400 })

  const encoder = new TextEncoder()
  const send    = (ctrl, data) =>
    ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const mosaicBuffer = await generateMosaic(
          targetUrl,
          images,
          (stage, current, total) => send(controller, { type: 'progress', stage, current, total }),
          params
        )

        send(controller, { type: 'uploading' })

        const filename = `mosaic-${Date.now()}.jpg`
        await supabaseAdmin.storage
          .from('photos')
          .upload(filename, mosaicBuffer, { contentType: 'image/jpeg' })

        const { data: { publicUrl } } = supabaseAdmin.storage
          .from('photos')
          .getPublicUrl(filename)

        send(controller, { type: 'done', url: publicUrl })
      } catch (err) {
        send(controller, { type: 'error', message: err.message })
      }
      controller.close()
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    }
  })
}
