import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY

  // Use REST API directly - bypasses client auth issues
  const res = await fetch(
    `${url}/rest/v1/uploads?select=*&order=created_at.desc`,
    {
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
      },
      cache: 'no-store',
    }
  )
  const images = await res.json()

  // Get target image
  const { data: targetFiles } = await supabaseAdmin.storage
    .from('photos')
    .list('', { search: 'target-' })

  let targetUrl = null
  if (targetFiles?.length) {
    const latest = targetFiles.sort((a, b) => b.name.localeCompare(a.name))[0]
    const { data: { publicUrl } } = supabaseAdmin.storage
      .from('photos')
      .getPublicUrl(latest.name)
    targetUrl = publicUrl
  }

  return Response.json({ images: Array.isArray(images) ? images : [], targetUrl })
}
