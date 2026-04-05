'use client'

import { useState, useEffect, useRef } from 'react'
import s from './page.module.css'
import PuzzleBackground from './components/PuzzleBackground'

const MAX_UPLOADS = parseInt(process.env.NEXT_PUBLIC_MAX_UPLOADS || '3')

function SamsungBlock() {
  const isSamsung = typeof navigator !== 'undefined' &&
    /SamsungBrowser/i.test(navigator.userAgent)
  if (!isSamsung) return null

  const currentUrl = typeof window !== 'undefined' ? window.location.href : ''
  const host = currentUrl.replace(/^https?:\/\//, '')
  const chromeIntent = `intent://${host}#Intent;scheme=https;package=com.android.chrome;end`

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99999,
      background: 'linear-gradient(160deg, #faf4e8 0%, #f2e4cc 55%, #e8d4b0 100%)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '32px 24px', textAlign: 'center', direction: 'rtl',
    }}>
      <div style={{ fontSize: '64px', marginBottom: '20px' }}>🌐</div>
      <h2 style={{
        fontFamily: "'Playfair Display', serif",
        fontSize: '24px', fontWeight: '700',
        color: '#2c1a00', marginBottom: '12px', lineHeight: '1.35',
      }}>
        דפדפן לא נתמך
      </h2>
      <p style={{
        fontSize: '15px', color: '#8a6f4a',
        lineHeight: '1.7', marginBottom: '28px', fontWeight: '300',
      }}>
        דפדפן Samsung Internet אינו תומך בהעלאת תמונות.<br />
        אנא פתחו את הקישור ב‑<strong>Chrome</strong> או בכל דפדפן אחר.
      </p>
      <a href={chromeIntent} style={{
        display: 'block', width: '100%', maxWidth: '320px',
        padding: '16px',
        background: 'linear-gradient(135deg, #4285f4, #5a9cf5)',
        color: '#fff', borderRadius: '50px', textDecoration: 'none',
        fontSize: '17px', fontWeight: '700', marginBottom: '12px',
        boxShadow: '0 5px 18px rgba(66,133,244,.35)',
      }}>
        פתח ב‑Chrome ▶
      </a>
      <p style={{ fontSize: '12px', color: '#b8a080' }}>
        אין Chrome? העתיקו את הקישור ופתחו בדפדפן אחר
      </p>
      <div style={{
        marginTop: '16px',
        background: 'rgba(255,253,246,.9)',
        borderRadius: '12px', padding: '10px 16px',
        border: '1px solid rgba(200,168,76,.22)',
        fontSize: '13px', color: '#8a6f4a',
        wordBreak: 'break-all', maxWidth: '320px',
      }}>
        {currentUrl}
      </div>
    </div>
  )
}

function BrowserWarning() {
  const isSamsung = typeof navigator !== 'undefined' &&
    /SamsungBrowser/i.test(navigator.userAgent)
  if (!isSamsung) return null

  const url = typeof window !== 'undefined' ? window.location.href : ''
  const chromeUrl = `intent://${url.replace(/^https?:\/\//, '')}#Intent;scheme=https;package=com.android.chrome;end`

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
      background: '#1a1a1a', color: '#fff', padding: '14px 16px',
      textAlign: 'center', fontSize: '14px', lineHeight: '1.5',
      direction: 'rtl',
    }}>
      <div>⚠️ לחוויה הטובה ביותר, פתחו את הקישור <strong>ב-Chrome</strong></div>
      <a href={chromeUrl} style={{
        display: 'inline-block', marginTop: '8px',
        background: '#4285f4', color: '#fff',
        padding: '8px 20px', borderRadius: '20px',
        fontSize: '14px', fontWeight: '700', textDecoration: 'none',
      }}>
        פתח ב-Chrome ▶
      </a>
    </div>
  )
}

export default function UploadPage() {
  const [deviceId,  setDeviceId]  = useState(null)
  const [stage,     setStage]     = useState('loading')  // loading | splash | select | uploading | done
  const [staged,    setStaged]    = useState([])          // [{file, previewUrl}] - not yet uploaded
  const [uploaded,  setUploaded]  = useState([])          // [{url}] - already uploaded this session
  const [existing,  setExisting]  = useState(0)           // count from previous sessions
  const [uploadMsg, setUploadMsg] = useState('')
  const cameraRef  = useRef(null)
  const galleryRef = useRef(null)

  useEffect(() => {
    let id = localStorage.getItem('wedding_device_id')
    if (!id) { id = crypto.randomUUID(); localStorage.setItem('wedding_device_id', id) }
    setDeviceId(id)

    fetch(`/api/count?deviceId=${id}`)
      .then(r => r.json())
      .then(d => {
        setExisting(d.count || 0)
        // If already uploaded before → skip splash, go straight to select/done
        setStage(d.count >= MAX_UPLOADS ? 'done' : d.count > 0 ? 'select' : 'splash')
      })
      .catch(() => setStage('splash'))
  }, [])

  const totalUploaded = existing + uploaded.length
  const remaining     = MAX_UPLOADS - totalUploaded - staged.length

  // ── Add photos ──────────────────────────────────────────────────────────────
  const addFiles = (files) => {
    const arr = Array.from(files || [])
    if (!arr.length) return

    if (arr.length > remaining) {
      alert(`מותר להעלות עד ${MAX_UPLOADS} תמונות בסך הכל. נותר מקום ל-${remaining} תמונות.`)
      return
    }

    const newItems = arr.map(file => ({
      file,
      previewUrl: URL.createObjectURL(file),
      id: crypto.randomUUID()
    }))
    setStaged(prev => [...prev, ...newItems])
    if (cameraRef.current)  cameraRef.current.value  = ''
    if (galleryRef.current) galleryRef.current.value = ''
  }

  // ── Remove staged photo ─────────────────────────────────────────────────────
  const removeStagedPhoto = (id) => {
    setStaged(prev => prev.filter(p => p.id !== id))
  }

  // ── Delete uploaded photo ───────────────────────────────────────────────────
  const deleteUploadedPhoto = async (photo, index) => {
    setUploaded(prev => prev.filter((_, i) => i !== index))
    setExisting(prev => prev > 0 ? prev - 1 : 0)
    try {
      await fetch('/api/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: photo.id, filename: photo.filename })
      })
    } catch {}
  }

  // ── Upload staged photos ────────────────────────────────────────────────────
  const handleUpload = async () => {
    if (!staged.length || !deviceId) return
    setStage('uploading')

    const newUploaded = []
    for (let i = 0; i < staged.length; i++) {
      const { file } = staged[i]
      setUploadMsg(`מעלה ${i + 1}/${staged.length}...`)
      try {
        const compressed = await compressImage(file)
        const fd = new FormData()
        fd.append('file', compressed)
        fd.append('deviceId', deviceId)

        const res  = await fetch('/api/upload', { method: 'POST', body: fd })
        const data = await res.json()
        if (res.ok) newUploaded.push({ url: data.url || '', id: data.id || '', filename: data.filename || '' })
      } catch {}
    }

    setUploaded(prev => [...prev, ...newUploaded])
    setStaged([])
    setStage(totalUploaded + newUploaded.length >= MAX_UPLOADS ? 'done' : 'select')
  }

  // ── Restart ─────────────────────────────────────────────────────────────────
  const restart = () => {
    // התמונות הקודמות נשארות בדאטהבייס - רק יוצרים device ID חדש
    const newId = crypto.randomUUID()
    localStorage.setItem('wedding_device_id', newId)
    setDeviceId(newId)
    setUploaded([])
    setExisting(0)
    setStaged([])
    setStage('select')
  }

  if (stage === 'loading') return null

  // ── Splash screen ───────────────────────────────────────────────────────────
  if (stage === 'splash') return (
    <main className={s.main}>
      <SamsungBlock />
      <PuzzleBackground />
      <div className={s.card}>
        <div className={s.splashEmoji}>📸</div>
        <h1 className={s.splashTitle}>
          מצלמים רגע מהחתונה
        </h1>
        <p className={s.splashText}>
          והתמונות שלכם מתחברות יחד<br />
          לתמונה אחת גדולה שלנו
        </p>
        <div className={s.splashPuzzle}>🧩</div>
        <button className={s.splashBtn} onClick={() => setStage('select')}>
          בואו נתחיל! ✨
        </button>
      </div>
    </main>
  )

  const allDone = totalUploaded + staged.length === 0 && stage === 'done'

  return (
    <main className={s.main}>
      <SamsungBlock />
      <PuzzleBackground />
      <div className={s.card}>
        <div className={s.emoji}>📸</div>
        <h1 className={s.title}>צלמו רגע מהערב שלנו!</h1>
        <p className={s.desc}>כל רגע שלכם הופך לחלק מהתמונה שלנו 🧩</p>

        {/* ── Uploading ── */}
        {stage === 'uploading' && (
          <div className={s.uploadingBox}>
            <div className={s.spinner}>⏳</div>
            <p className={s.uploadingText}>{uploadMsg}</p>
          </div>
        )}

        {/* ── Select / Done stage ── */}
        {stage !== 'uploading' && (
          <>
            {/* Staged thumbnails */}
            {staged.length > 0 && (
              <div className={s.thumbGrid}>
                {staged.map(item => (
                  <div key={item.id} className={s.thumbWrap}>
                    <img src={item.previewUrl} alt="" className={s.thumb} />
                    <button className={s.removeBtn} onClick={() => removeStagedPhoto(item.id)}>✕</button>
                    <div className={s.thumbLabel}>ממתין</div>
                  </div>
                ))}
              </div>
            )}

            {/* Uploaded thumbnails */}
            {uploaded.length > 0 && (
              <div className={s.thumbGrid}>
                {uploaded.map((item, i) => (
                  <div key={i} className={s.thumbWrap}>
                    {item.url
                      ? <img src={item.url} alt="" className={s.thumb} />
                      : <div className={s.thumbPlaceholder}>✅</div>
                    }
                    {totalUploaded < MAX_UPLOADS && (
                      <button className={s.removeBtn} onClick={() => deleteUploadedPhoto(item, i)}>✕</button>
                    )}
                    <div className={`${s.thumbLabel} ${s.thumbDone}`}>הועלה</div>
                  </div>
                ))}
              </div>
            )}

            {/* Counter */}
            {(staged.length > 0 || totalUploaded > 0) && (
              <p className={s.counterText}>
                {totalUploaded + staged.length}/{MAX_UPLOADS} תמונות
              </p>
            )}

            {/* Add buttons */}
            {remaining > 0 && (
              <div className={s.btnRow}>
                <button className={s.btnCamera} onClick={() => cameraRef.current?.click()}>
                  📷 צלם
                </button>
                <input ref={cameraRef} type="file" accept="image/*" capture="environment"
                  onChange={e => addFiles(e.target.files)} style={{ display: 'none' }} />

                <button className={s.btnGallery} onClick={() => galleryRef.current?.click()}>
                  🖼️ גלריה
                </button>
                <input ref={galleryRef} type="file" accept="image/*" multiple
                  onChange={e => addFiles(e.target.files)} style={{ display: 'none' }} />
              </div>
            )}

            {/* Upload button */}
            {staged.length > 0 && (
              <button className={s.uploadBtn} onClick={handleUpload}>
                העלה {staged.length === 1 ? 'תמונה' : `${staged.length} תמונות`} ✅
              </button>
            )}

            {/* Done message */}
            {stage === 'done' && staged.length === 0 && (
              <div className={s.doneBox}>
                <p className={s.doneText}>🎉 אתם עכשיו חלק מהתמונה הגדולה!</p>
              </div>
            )}

            {/* Restart */}
            {totalUploaded > 0 && staged.length === 0 && (
              <button className={s.restartBtn} onClick={restart}>
                התחל מחדש 🔄
              </button>
            )}
          </>
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
    const url    = URL.createObjectURL(file)
    const timeout = setTimeout(() => { URL.revokeObjectURL(url); resolve(file) }, 8000)
    img.onerror = () => { clearTimeout(timeout); URL.revokeObjectURL(url); resolve(file) }
    img.onload  = () => {
      clearTimeout(timeout)
      URL.revokeObjectURL(url)
      const MAX = 1000
      let w = img.width, h = img.height
      if (w > MAX) { h = Math.round(h * MAX / w); w = MAX }
      canvas.width = w; canvas.height = h
      ctx.drawImage(img, 0, 0, w, h)
      canvas.toBlob(blob => resolve(new File([blob], 'photo.jpg', { type: 'image/jpeg' })), 'image/jpeg', 0.80)
    }
    img.src = url
  })
}
