import { supabase, supabaseAdmin } from '@/lib/supabase'

export async function POST() {
  // Get all filenames
  const { data: images } = await supabase.from('uploads').select('filename')

  // Delete from storage
  if (images?.length) {
    const filenames = images.map(i => i.filename)
    await supabaseAdmin.storage.from('photos').remove(filenames)
  }

  // Delete all from DB
  await supabaseAdmin.from('uploads').delete().neq('id', '00000000-0000-0000-0000-000000000000')

  return Response.json({ success: true, deleted: images?.length || 0 })
}
