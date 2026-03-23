import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const secretKey = process.env.SUPABASE_SECRET_KEY

// Client for browser (read + upload)
export const supabase = createClient(url, publishableKey)

// Admin client for API routes (full access)
export const supabaseAdmin = createClient(url, secretKey)
