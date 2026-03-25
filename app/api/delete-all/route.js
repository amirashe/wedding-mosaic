import { supabaseAdmin } from '@/lib/supabase'

export async function POST() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY

  // Get all filenames first
  const res = await fetch(
    `${url}/rest/v1/uploads?select=filename`,
    {
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
      },
      cache: 'no-store',
    }
  )
  const images = await res.json()

  // Delete from storage (best effort)
  if (Array.isArray(images) && images.length) {
    try {
      await supabaseAdmin.storage.from('photos').remove(images.map(i => i.filename))
    } catch { /* continue even if storage delete fails */ }
  }

  // Delete all from DB via REST
  await fetch(
    `${url}/rest/v1/uploads?id=neq.00000000-0000-0000-0000-000000000000`,
    {
      method: 'DELETE',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
      },
    }
  )

  return Response.json({ success: true, deleted: Array.isArray(images) ? images.length : 0 })
}
