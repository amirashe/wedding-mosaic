import { supabaseAdmin } from '@/lib/supabase'

export async function POST(request) {
  const { id, filename } = await request.json()

  // Delete from storage
  await supabaseAdmin.storage.from('photos').remove([filename])

  // Delete from DB
  await supabaseAdmin.from('uploads').delete().eq('id', id)

  return Response.json({ success: true })
}
