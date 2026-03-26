'use client'

import { useState, useEffect, useRef } from 'react'
import s from './page.module.css'

const MAX_UPLOADS = parseInt(process.env.NEXT_PUBLIC_MAX_UPLOADS || '3')

export default function UploadPage() {
  const [deviceId,    setDeviceId]    = useState(null)
  const [uploadCount, setUploadCount] = useState(0)
  const [status,      setStatus]      = useState('idle') // idle | uploading | success | error | limit
  const inputRef = useRef(null)

  useEffect(() => {
    let id = localStorage.getItem('wedding_device_id')
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem('wedding_device_id', id)
    }
    setDeviceId(id)

    fetch(`/api/count?deviceId=${id}`)
      .then(r => r.json())
      .then(d => { if (d.count >= MAX_UPLOADS) setStatus('limit'); else setUploadCount(d.count) })
      .catch(() => {})
  }, [])

  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file || !deviceId) return
    if (uploadCount >= MAX_UPLOADS) { setStatus('limit'); return }

    setStatus('uploading')

    try {
      const compressed = await compressImage(file)
      const fd = new FormData()
      fd.append('file', compressed)
      fd.append('deviceId', deviceId)

      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      if (!res.ok) {
        const err = await res.json()
        if (err.error === 'limit') { setStatus('limit'); return }
        throw new Error()
      }

      const newCount = uploadCount + 1
      setUploadCount(newCount)
      setStatus(newCount >= MAX_UPLOADS ? 'limit' : 'success')
    } catch {
      setStatus('error')
    }

    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <main className={s.main}>
      <div className={s.card}>
        <div className={s.emoji}>📸</div>
        <h1 className={s.title}>צלמו תמונה למוזאיקה שלנו</h1>
        <p className={s.desc}>כל התמונות שתעלו יצרפו יחד לתמונה אחת גדולה של מעיין ואמיר</p>

        {status !== 'limit' && (
          <>
            <label className={`${s.uploadBtn} ${status === 'uploading' ? s.loading : ''}`}>
              {status === 'uploading' ? '⏳ מעלה...' : '📷 צלם תמונה'}
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFile}
                disabled={status === 'uploading'}
                style={{ display: 'none' }}
              />
            </label>
            <label className={`${s.galleryBtn} ${status === 'uploading' ? s.loading : ''}`}>
              🖼️ בחר מהגלריה
              <input
                type="file"
                accept="image/*"
                onChange={handleFile}
                disabled={status === 'uploading'}
                style={{ display: 'none' }}
              />
            </label>

            {status === 'success' && (
              <div className={s.success}>
                <div className={s.successIcon}>✅</div>
                <p className={s.successText}>התמונה הועלתה בהצלחה!</p>
                <div className={s.counter}>{uploadCount}/{MAX_UPLOADS} תמונות הועלו</div>
              </div>
            )}

            {status === 'error' && (
              <p className={s.error}>שגיאה בהעלאה, נסה שוב 🙏</p>
            )}
          </>
        )}

        {status === 'limit' && (
          <div className={s.limitBox}>
            <div className={s.limitEmoji}>🎉</div>
            <p className={s.limitTitle}>תודה רבה!</p>
            <p className={s.limitSub}>העלית {MAX_UPLOADS} תמונות — אתם חלק מהמוזאיקה!</p>
            <button className={s.restartBtn} onClick={async () => {
              await fetch('/api/delete-my-photos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ deviceId })
              })
              const newId = crypto.randomUUID()
              localStorage.setItem('wedding_device_id', newId)
              setDeviceId(newId)
              setUploadCount(0)
              setStatus('idle')
            }}>
              רוצה להתחיל מחדש? 🔄
            </button>
          </div>
        )}
      </div>
    </main>
  )
}

async function compressImage(file) {
  return new Promise((resolve) => {
    const img    = new Image()
    const canvas = document.createElement('canvas')
    const ctx    = canvas.getContext('2d')

    img.onload = () => {
      const MAX = 1000
      let w = img.width, h = img.height
      if (w > MAX) { h = Math.round(h * MAX / w); w = MAX }

      canvas.width  = w
      canvas.height = h
      ctx.drawImage(img, 0, 0, w, h)

      canvas.toBlob(
        blob => resolve(new File([blob], 'photo.jpg', { type: 'image/jpeg' })),
        'image/jpeg', 0.80
      )
    }
    img.src = URL.createObjectURL(file)
  })
}
