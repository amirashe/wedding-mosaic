import { supabase, supabaseAdmin } from '@/lib/supabase'

export async function POST(request) {
  const { deviceId } = await request.json()
  if (!deviceId) return Response.json({ error: 'missing deviceId' }, { status: 400 })

  // Get filenames for this device
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY

  const res = await fetch(
    `${url}/rest/v1/uploads?select=filename&device_id=eq.${encodeURIComponent(deviceId)}`,
    { headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }, cache: 'no-store' }
  )
  const photos = await res.json()

  // Delete from storage
  if (Array.isArray(photos) && photos.length) {
    try {
      await supabaseAdmin.storage.from('photos').remove(photos.map(p => p.filename))
    } catch { /* continue */ }
  }

  // Delete from DB
  await fetch(
    `${url}/rest/v1/uploads?device_id=eq.${encodeURIComponent(deviceId)}`,
    { method: 'DELETE', headers: { 'apikey': key, 'Authorization': `Bearer ${key}` } }
  )

  return Response.json({ success: true, deleted: photos?.length || 0 })
}
