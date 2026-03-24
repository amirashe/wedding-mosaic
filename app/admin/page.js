'use client'

import { useState, useEffect } from 'react'
import s from './page.module.css'

export default function AdminPage() {
  const [images,          setImages]          = useState([])
  const [loading,         setLoading]         = useState(true)
  const [targetUrl,       setTargetUrl]       = useState(null)
  const [guestUrl,        setGuestUrl]        = useState('')
  const [mosaicStatus,    setMosaicStatus]    = useState('idle')  // idle | running | done | error
  const [mosaicUrl,       setMosaicUrl]       = useState(null)
  const [uploadingTarget, setUploadingTarget] = useState(false)

  useEffect(() => {
    fetchImages()
    setGuestUrl(window.location.origin)
  }, [])

  const fetchImages = async () => {
    setLoading(true)
    const res  = await fetch('/api/images')
    const data = await res.json()
    setImages(data.images || [])
    setTargetUrl(data.targetUrl || null)
    setLoading(false)
  }

  const deleteImage = async (id, filename) => {
    if (!confirm('למחוק את התמונה?')) return
    await fetch('/api/delete', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id, filename }),
    })
    fetchImages()
  }

  const uploadTarget = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingTarget(true)

    const fd = new FormData()
    fd.append('file', file)
    fd.append('isTarget', 'true')

    const res = await fetch('/api/upload', { method: 'POST', body: fd })
    const data = await res.json()
    if (data.url) setTargetUrl(data.url)
    setUploadingTarget(false)
    e.target.value = ''
  }

  const generateMosaic = async () => {
    if (!targetUrl) { alert('העלה קודם תמונת מטרה'); return }
    if (images.length < 1) { alert('צריך לפחות תמונה אחת'); return }
    if (!confirm(`להתחיל יצירת מוזאיקה מ-${images.length} תמונות? זה ייקח כמה דקות.`)) return

    setMosaicStatus('running')
    setMosaicUrl(null)

    const res = await fetch('/api/mosaic', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ targetUrl }),
    })

    if (res.ok) {
      const data = await res.json()
      setMosaicUrl(data.url)
      setMosaicStatus('done')
    } else {
      setMosaicStatus('error')
    }
  }

  return (
    <div className={s.page}>
      <h1 className={s.title}>⚙️ ניהול מוזאיקה</h1>
      <p className={s.sub}>חתונת מעיין ואמיר 💑</p>

      {/* QR Code */}
      {guestUrl && (
        <div className={s.card} style={{ textAlign: 'center' }}>
          <h2 className={s.cardTitle}>📱 QR Code לאורחים</h2>
          <p className={s.hint}>אורחים סורקים את זה כדי להעלות תמונות</p>
          <img
            src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(guestUrl)}&margin=10`}
            alt="QR Code"
            style={{ borderRadius: 12, border: '4px solid #f3f3f3', maxWidth: 220 }}
          />
          <p style={{ fontSize: 13, color: '#999', marginTop: 8, wordBreak: 'break-all' }}>{guestUrl}</p>
        </div>
      )}

      {/* Stats */}
      <div className={s.statsRow}>
        <div className={s.stat}>
          <div className={s.statNum}>{images.length}</div>
          <div className={s.statLbl}>תמונות שהועלו</div>
        </div>
        <div className={s.stat}>
          <div className={s.statNum}>{targetUrl ? '✅' : '❌'}</div>
          <div className={s.statLbl}>תמונת מטרה</div>
        </div>
      </div>

      {/* Target image */}
      <div className={s.card}>
        <h2 className={s.cardTitle}>🎯 תמונת מטרה</h2>
        {targetUrl
          ? <img src={targetUrl} alt="target" className={s.targetPreview} />
          : <p className={s.hint}>לא הועלתה עדיין</p>
        }
        <label className={`${s.btn} ${s.btnSecondary} ${uploadingTarget ? s.disabled : ''}`}>
          {uploadingTarget ? 'מעלה...' : targetUrl ? '🔄 החלף תמונה' : '📤 העלה תמונת מטרה'}
          <input type="file" accept="image/*" onChange={uploadTarget} style={{ display: 'none' }} disabled={uploadingTarget} />
        </label>
      </div>

      {/* Generate mosaic */}
      <div className={s.card}>
        <h2 className={s.cardTitle}>🖼️ יצירת מוזאיקה</h2>
        {mosaicStatus === 'idle'    && <p className={s.hint}>לחץ כדי ליצור את המוזאיקה מכל התמונות שהועלו</p>}
        {mosaicStatus === 'running' && <p className={s.running}>⏳ מייצר מוזאיקה... זה יכול לקחת 3-7 דקות</p>}
        {mosaicStatus === 'error'   && <p className={s.error}>שגיאה ביצירה. נסה שוב.</p>}
        {mosaicStatus === 'done'    && mosaicUrl && (
          <div className={s.mosaicDone}>
            <p className={s.doneText}>✅ המוזאיקה מוכנה!</p>
            <img src={mosaicUrl} alt="mosaic" className={s.mosaicPreview} />
            <button
              className={`${s.btn} ${s.btnPrimary}`}
              onClick={async () => {
                const res  = await fetch(mosaicUrl)
                const blob = await res.blob()
                const url  = URL.createObjectURL(blob)
                const a    = document.createElement('a')
                a.href     = url
                a.download = 'mosaic-maayan-amir.jpg'
                a.click()
                URL.revokeObjectURL(url)
              }}
            >
              ⬇️ הורד מוזאיקה
            </button>
          </div>
        )}
        <button
          className={`${s.btn} ${s.btnPrimary} ${mosaicStatus === 'running' ? s.disabled : ''}`}
          onClick={generateMosaic}
          disabled={mosaicStatus === 'running'}
        >
          {mosaicStatus === 'running' ? '⏳ מייצר...' : '✨ צור מוזאיקה'}
        </button>
      </div>

      {/* Image grid */}
      <div className={s.card}>
        <h2 className={s.cardTitle}>🗂️ תמונות שהועלו ({images.length})</h2>
        {loading && <p className={s.hint}>טוען...</p>}
        {!loading && images.length === 0 && <p className={s.hint}>אין תמונות עדיין</p>}
        <div className={s.grid}>
          {images.map(img => (
            <div key={img.id} className={s.gridItem}>
              <img src={img.image_url} alt="" className={s.thumb} />
              <button className={s.deleteBtn} onClick={() => deleteImage(img.id, img.filename)}>🗑️</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
