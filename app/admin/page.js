'use client'

import { useState, useEffect } from 'react'
import s from './page.module.css'

async function compressImage(file) {
  // HEIC/HEIF from iPhone - browser can't process, send as-is
  if (file.type === 'image/heic' || file.type === 'image/heif' ||
      file.name.toLowerCase().endsWith('.heic') || file.name.toLowerCase().endsWith('.heif')) {
    return file
  }

  return new Promise((resolve) => {
    const img    = new Image()
    const canvas = document.createElement('canvas')
    const ctx    = canvas.getContext('2d')
    const url    = URL.createObjectURL(file)

    // Timeout fallback - if compression hangs, send original
    const timeout = setTimeout(() => {
      URL.revokeObjectURL(url)
      resolve(file)
    }, 8000)

    img.onerror = () => {
      clearTimeout(timeout)
      URL.revokeObjectURL(url)
      resolve(file)  // send original if compression fails
    }

    img.onload = () => {
      clearTimeout(timeout)
      URL.revokeObjectURL(url)
      const MAX = 1000
      let w = img.width, h = img.height
      if (w > MAX) { h = Math.round(h * MAX / w); w = MAX }
      canvas.width = w; canvas.height = h
      ctx.drawImage(img, 0, 0, w, h)
      canvas.toBlob(
        blob => resolve(new File([blob], 'photo.jpg', { type: 'image/jpeg' })),
        'image/jpeg', 0.80
      )
    }
    img.src = url
  })
}

export default function AdminPage() {
  const [images,          setImages]          = useState([])
  const [loading,         setLoading]         = useState(true)
  const [targetUrl,       setTargetUrl]       = useState(null)
  const [guestUrl,        setGuestUrl]        = useState('')
  const [bulkStatus,      setBulkStatus]      = useState(null) // null | { done, total, errors }
  const [mosaicStatus,    setMosaicStatus]    = useState('idle')
  const [mosaicUrl,       setMosaicUrl]       = useState(null)
  const [mosaicError,     setMosaicError]     = useState('')
  const [progress,        setProgress]        = useState({ stage: '', current: 0, total: 1 })
  const [uploadingTarget, setUploadingTarget] = useState(false)
  const [params, setParams] = useState({
    blend:        0.28,
    varsPerImg:   3,
    minReuseDist: 7,
    ghostOpacity: 0.35,
    jpegQuality:  88,
  })

  const setParam = (key, val) => setParams(p => ({ ...p, [key]: val }))

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

  const handleBulkUpload = async (e) => {
    const files = Array.from(e.target.files || [])
    if (!files.length) return

    setBulkStatus({ done: 0, total: files.length, errors: 0 })

    // Keep screen awake during upload
    let wakeLock = null
    try { wakeLock = await navigator.wakeLock?.request('screen') } catch {}

    try {
      for (let i = 0; i < files.length; i++) {
        try {
          const compressed = await compressImage(files[i])
          const fd = new FormData()
          fd.append('file', compressed)
          fd.append('deviceId', 'admin-bulk-' + i)
          fd.append('isAdmin', 'true')
          await fetch('/api/upload', { method: 'POST', body: fd })
          setBulkStatus(prev => ({ ...prev, done: prev.done + 1 }))
        } catch {
          setBulkStatus(prev => ({ ...prev, done: prev.done + 1, errors: prev.errors + 1 }))
        }
      }
    } finally {
      try { wakeLock?.release() } catch {}
    }

    await fetchImages()
    e.target.value = ''
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
    setProgress({ stage: 'מתחיל...', current: 0, total: 1 })

    const stageNames = {
      download:   'מוריד תמונות',
      variations: 'מכין וריאציות',
      target:     'מנתח תמונת מטרה',
      matching:   'מתאים צבעים',
      composite:  'בונה רצועה',
      joining:    'מחבר רצועות...',
      blending:   'מוסיף אפקט פנים...',
      finishing:  'בונה תמונה סופית',
      uploading:  'מעלה תוצאה',
    }

    try {
      const res    = await fetch('/api/mosaic', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ targetUrl, params }),
      })

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const lines = decoder.decode(value).split('\n').filter(l => l.startsWith('data: '))
        for (const line of lines) {
          try {
            const data = JSON.parse(line.slice(6))
            if (data.type === 'progress') {
              setProgress({
                stage:   stageNames[data.stage] || data.stage,
                current: data.current,
                total:   data.total,
              })
            } else if (data.type === 'uploading') {
              setProgress({ stage: 'מעלה תוצאה...', current: 1, total: 1 })
            } else if (data.type === 'done') {
              setMosaicUrl(data.url)
              setMosaicStatus('done')
            } else if (data.type === 'error') {
              setMosaicError(data.message || 'unknown error')
              setMosaicStatus('error')
            }
          } catch { /* skip parse errors */ }
        }
      }
    } catch {
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

      {/* Bulk upload */}
      <div className={s.card}>
        <h2 className={s.cardTitle}>📦 העלאת תמונות בכמות (טסט)</h2>
        <p className={s.hint}>בחר עד 500 תמונות בבת אחת מהגלריה שלך</p>

        {bulkStatus && (
          <div className={s.progressBox}>
            <p className={s.running}>
              {bulkStatus.done < bulkStatus.total
                ? `⏳ מעלה ${bulkStatus.done}/${bulkStatus.total}...`
                : `✅ הועלו ${bulkStatus.done - bulkStatus.errors}/${bulkStatus.total} תמונות`}
            </p>
            <div className={s.progressTrack}>
              <div
                className={s.progressFill}
                style={{ width: `${Math.round(bulkStatus.done / bulkStatus.total * 100)}%` }}
              />
            </div>
            <p className={s.progressText}>
              {Math.round(bulkStatus.done / bulkStatus.total * 100)}%
              {bulkStatus.errors > 0 && ` · ${bulkStatus.errors} שגיאות`}
            </p>
          </div>
        )}

        <label className={`${s.btn} ${s.btnPrimary} ${bulkStatus && bulkStatus.done < bulkStatus.total ? s.disabled : ''}`}>
          📸 בחר תמונות
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={handleBulkUpload}
            disabled={bulkStatus && bulkStatus.done < bulkStatus.total}
            style={{ display: 'none' }}
          />
        </label>
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
        {mosaicStatus === 'running' && (
          <div className={s.progressBox}>
            <p className={s.running}>⏳ {progress.stage}</p>
            <div className={s.progressTrack}>
              <div
                className={s.progressFill}
                style={{ width: `${progress.total > 0 ? Math.round(progress.current / progress.total * 100) : 0}%` }}
              />
            </div>
            <p className={s.progressText}>
              {progress.current} / {progress.total}
              {' '}({progress.total > 0 ? Math.round(progress.current / progress.total * 100) : 0}%)
            </p>
          </div>
        )}
        {mosaicStatus === 'error'   && <p className={s.error}>שגיאה ביצירה: {mosaicError}</p>}
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
        <div className={s.paramsGrid}>
          <div className={s.paramItem}>
            <label className={s.paramLabel}>עוצמת גוון צבע</label>
            <div className={s.paramHint}>0.1 = טבעי · 0.6 = חזק</div>
            <input
              type="number" className={s.paramInput}
              value={params.blend} min={0.05} max={0.7} step={0.01}
              onChange={e => setParam('blend', parseFloat(e.target.value))}
            />
          </div>
          <div className={s.paramItem}>
            <label className={s.paramLabel}>וריאציות לתמונה</label>
            <div className={s.paramHint}>גיוון חיתוך לכל תמונה</div>
            <input
              type="number" className={s.paramInput}
              value={params.varsPerImg} min={1} max={10} step={1}
              onChange={e => setParam('varsPerImg', parseInt(e.target.value))}
            />
          </div>
          <div className={s.paramItem}>
            <label className={s.paramLabel}>מרחק שימוש חוזר</label>
            <div className={s.paramHint}>מינימום טיילס בין פנים זהות</div>
            <input
              type="number" className={s.paramInput}
              value={params.minReuseDist} min={1} max={25} step={1}
              onChange={e => setParam('minReuseDist', parseInt(e.target.value))}
            />
          </div>
          <div className={s.paramItem}>
            <label className={s.paramLabel}>שקיפות דמות מרכז</label>
            <div className={s.paramHint}>0 = רק מוזאיקה · 0.6 = דמות חזקה</div>
            <input
              type="number" className={s.paramInput}
              value={params.ghostOpacity} min={0} max={0.7} step={0.01}
              onChange={e => setParam('ghostOpacity', parseFloat(e.target.value))}
            />
          </div>
          <div className={s.paramItem}>
            <label className={s.paramLabel}>איכות JPEG</label>
            <div className={s.paramHint}>70 = קל · 100 = מקסימום</div>
            <input
              type="number" className={s.paramInput}
              value={params.jpegQuality} min={70} max={100} step={1}
              onChange={e => setParam('jpegQuality', parseInt(e.target.value))}
            />
          </div>
          <div className={s.paramItem} style={{ alignSelf: 'end' }}>
            <button
              className={s.resetBtn}
              onClick={() => setParams({ blend: 0.28, varsPerImg: 3, minReuseDist: 7, ghostOpacity: 0.35, jpegQuality: 88 })}
            >↺ ברירת מחדל</button>
          </div>
        </div>

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
        {images.length > 0 && (
          <button
            className={`${s.btn} ${s.btnDanger}`}
            style={{ marginBottom: 14 }}
            onClick={async () => {
              if (!confirm(`למחוק את כל ${images.length} התמונות?`)) return
              await fetch('/api/delete-all', { method: 'POST' })
              fetchImages()
            }}
          >
            🗑️ מחק את כל התמונות
          </button>
        )}
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
