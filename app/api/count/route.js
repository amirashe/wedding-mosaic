import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const deviceId = searchParams.get('deviceId')

  if (!deviceId) return Response.json({ count: 0 })

  const { count } = await supabaseAdmin
    .from('uploads')
    .select('*', { count: 'exact', head: true })
    .eq('device_id', deviceId)

  return Response.json({ count: count || 0 })
}
