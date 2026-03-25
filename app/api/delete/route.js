import { supabase, supabaseAdmin } from '@/lib/supabase'

export async function POST(request) {
  const { id, filename } = await request.json()

  // Delete from storage (needs admin)
  await supabaseAdmin.storage.from('photos').remove([filename])

  // Delete from DB (anon key works with public policy)
  await supabase.from('uploads').delete().eq('id', id)

  return Response.json({ success: true })
}
