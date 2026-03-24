import { supabase, supabaseAdmin } from '@/lib/supabase'

export async function GET() {
  const { data: images, error } = await supabase
    .from('uploads')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) console.error('images fetch error:', error)

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
