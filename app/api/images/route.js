import { supabaseAdmin } from '@/lib/supabase'

export async function GET() {
  const { data: images } = await supabaseAdmin
    .from('uploads')
    .select('*')
    .order('created_at', { ascending: false })

  // Get target image URL if it exists
  const { data: targetFiles } = await supabaseAdmin.storage
    .from('photos')
    .list('', { search: 'target-' })

  let targetUrl = null
  if (targetFiles && targetFiles.length > 0) {
    // Get the most recent target file
    const latest = targetFiles.sort((a, b) => b.name.localeCompare(a.name))[0]
    const { data: { publicUrl } } = supabaseAdmin.storage
      .from('photos')
      .getPublicUrl(latest.name)
    targetUrl = publicUrl
  }

  return Response.json({ images: images || [], targetUrl })
}
