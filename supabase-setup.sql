-- Run this in Supabase SQL Editor

-- 1. Create uploads table
CREATE TABLE IF NOT EXISTS uploads (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  image_url   TEXT NOT NULL,
  filename    TEXT NOT NULL,
  device_id   TEXT NOT NULL,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Enable Row Level Security
ALTER TABLE uploads ENABLE ROW LEVEL SECURITY;

-- 3. Policies - allow public read/insert/delete (no auth needed)
CREATE POLICY "public_select" ON uploads FOR SELECT USING (true);
CREATE POLICY "public_insert" ON uploads FOR INSERT WITH CHECK (true);
CREATE POLICY "public_delete" ON uploads FOR DELETE USING (true);
