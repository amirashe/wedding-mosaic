export const dynamic = 'force-dynamic'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const deviceId = searchParams.get('deviceId')
  if (!deviceId) return Response.json({ count: 0 })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY

  const res = await fetch(
    `${url}/rest/v1/uploads?select=id&device_id=eq.${encodeURIComponent(deviceId)}`,
    {
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Prefer': 'count=exact',
      },
      cache: 'no-store',
    }
  )
  const data = await res.json()
  return Response.json({ count: Array.isArray(data) ? data.length : 0 })
}
