import { useEffect, useRef, useState } from 'react';
import api, { getErrorMessage } from '../services/api';
import Spinner from '../components/Spinner';
import Toast from '../components/Toast';

const THEME_LABELS = {
  navy: { label: 'Navy Blue (official)', color: '#0f2a5c' },
  green: { label: 'Green', color: '#14532d' },
  maroon: { label: 'Maroon Red', color: '#7f1d1d' },
  teal: { label: 'Teal', color: '#134e4a' },
};

// Card canvas in PDF points (matches the backend). The drag canvas renders at
// this width so 1 point ~ 1px — what the admin drags is what prints.
const CARD_W = 480;
const CARD_H = 300;
const MAX_ELEMENTS = 10;

// Font choices must match the backend enum ['sans','serif','mono'] and the PDF
// font mapping in idCardService (sans=Helvetica, serif=Times, mono=Courier).
const FONT_FAMILIES = {
  sans: { label: 'Clean (sans)', css: 'Helvetica, Arial, sans-serif' },
  serif: { label: 'Official (serif)', css: 'Times New Roman, Georgia, serif' },
  mono: { label: 'Typewriter (mono)', css: 'Courier New, monospace' },
};

const uid = () => Math.random().toString(36).slice(2, 9);

export default function IdCardDesigner() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notify, setNotify] = useState(null);
  const [design, setDesign] = useState(null);
  const [values, setValues] = useState({});
  const [previewKey, setPreviewKey] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const canvasRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data } = await api.get('/api/settings/idcard');
        if (!cancelled) {
          setDesign(data.data.design);
          setValues(data.data.values || {});
        }
      } catch (err) {
        if (!cancelled) setNotify({ message: getErrorMessage(err), type: 'error' });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const set = (key, value) => setDesign((prev) => ({ ...prev, [key]: value }));

  const setField = (list, idx, patch) => {
    setDesign((prev) => {
      const arr = [...(prev[list] || [])];
      arr[idx] = { ...arr[idx], ...patch };
      return { ...prev, [list]: arr };
    });
  };

  // ---- freeform elements (drag + drop) ----------------------------------
  const addText = () => {
    setDesign((prev) => {
      const els = [...(prev.elements || [])];
      if (els.length >= MAX_ELEMENTS) {
        setNotify({ message: `You can add up to ${MAX_ELEMENTS} custom items.`, type: 'error' });
        return prev;
      }
      const id = uid();
      els.push({ id, type: 'text', show: true, x: 30, y: 210, width: 170, height: 28, rotation: 0, text: 'Your text here', fontSize: 12, color: '#111111', fontWeight: 'normal', align: 'left' });
      setSelectedId(id);
      return { ...prev, elements: els };
    });
  };

  const uploadAsset = async (file) => {
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) {
      setNotify({ message: 'Only PNG or JPEG images are allowed.', type: 'error' });
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('image', file);
      const { data } = await api.post('/api/settings/idcard/asset', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      const id = uid();
      setDesign((prev) => {
        const els = [...(prev.elements || [])];
        els.push({ id, type: 'image', show: true, x: 30, y: 40, width: 90, height: 60, rotation: 0, src: data.data.src });
        setSelectedId(id);
        return { ...prev, elements: els };
      });
      setNotify({ message: 'Image added — drag it into place, then Save.', type: 'success', duration: 6000 });
    } catch (err) {
      setNotify({ message: getErrorMessage(err), type: 'error' });
    } finally {
      setUploading(false);
    }
  };

  const updateEl = (id, patch) => {
    setDesign((prev) => ({ ...prev, elements: (prev.elements || []).map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
  };
  const removeEl = (id) => {
    setDesign((prev) => ({ ...prev, elements: (prev.elements || []).filter((e) => e.id !== id) }));
    setSelectedId(null);
  };

  // Duplicate a placed item (handy to reuse one signature/stamp in two spots).
  const duplicateEl = (id) => {
    setDesign((prev) => {
      const els = [...(prev.elements || [])];
      const i = els.findIndex((e) => e.id === id);
      if (i < 0 || els.length >= MAX_ELEMENTS) return prev;
      const copy = { ...els[i], id: uid(), x: Math.min(CARD_W - 10, els[i].x + 16), y: Math.min(CARD_H - 10, els[i].y + 16) };
      els.splice(i + 1, 0, copy);
      setSelectedId(copy.id);
      return { ...prev, elements: els };
    });
  };

  // Bring-to-front / send-to-back (z-order = array order, last renders on top).
  const stackEl = (id, dir) => {
    setDesign((prev) => {
      const els = [...(prev.elements || [])];
      const i = els.findIndex((e) => e.id === id);
      const j = dir === 'front' ? els.length - 1 : 0;
      if (i < 0 || i === j) return prev;
      const [item] = els.splice(i, 1);
      els.splice(j, 0, item);
      return { ...prev, elements: els };
    });
  };

  const onPointerDown = (e, el) => {
    e.preventDefault();
    setSelectedId(el.id);
    if (el.locked) return; // locked items can't be dragged (accidental-drag guard)
    const rect = canvasRef.current.getBoundingClientRect();
    const scale = rect.width / CARD_W;
    dragRef.current = { id: el.id, scale, offX: (e.clientX - rect.left) / scale - el.x, offY: (e.clientY - rect.top) / scale - el.y };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };
  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / d.scale - d.offX;
    const ny = (e.clientY - rect.top) / d.scale - d.offY;
    updateEl(d.id, { x: Math.round(Math.max(0, Math.min(CARD_W, nx))), y: Math.round(Math.max(0, Math.min(CARD_H, ny))) });
  };
  const onPointerUp = () => {
    dragRef.current = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
  };

  const selected = (design?.elements || []).find((e) => e.id === selectedId) || null;

  const doSave = async () => {
    setSaving(true);
    try {
      const { data } = await api.put('/api/settings/idcard', design);
      setNotify({ message: `${data.message}. New cards use it now.`, type: 'success', duration: 8000 });
      setPreviewKey((k) => k + 1);
    } catch (err) {
      setNotify({ message: getErrorMessage(err), type: 'error', duration: 8000 });
    } finally {
      setSaving(false);
    }
  };

  const doReset = async () => {
    if (!window.confirm('Bring back the original card design?')) return;
    try {
      const { data } = await api.post('/api/settings/idcard/reset');
      setDesign(data.data);
      setNotify({ message: 'Original design restored.', type: 'success' });
      setPreviewKey((k) => k + 1);
    } catch (err) {
      setNotify({ message: getErrorMessage(err), type: 'error' });
    }
  };

  if (loading || !design) {
    return <div className="page"><Spinner label="Loading card designer…" /></div>;
  }

  const visibleOfficer = (design.officerFields || []).filter((f) => f.show !== false).slice(0, 5);
  const visibleDuty = (design.dutyFields || []).filter((f) => f.show !== false).slice(0, 8);
  const themeColor = (THEME_LABELS[design.theme] || THEME_LABELS.navy).color;

  const fieldEditor = (listName, title, hint) => (
    <div className="card" style={{ marginTop: 12 }}>
      <h3 className="card-title">{title}</h3>
      <p className="muted">{hint}</p>
      {(design[listName] || []).map((f, i) => (
        <div key={`${f.key}-${i}`} className="field-row">
          <label className="form-check" title="Show this line on the card">
            <input type="checkbox" checked={f.show !== false} onChange={(e) => setField(listName, i, { show: e.target.checked })} />
          </label>
          <span className="mono muted" style={{ minWidth: 100 }}>{f.key}</span>
          <input className="input" value={f.label || ''} onChange={(e) => setField(listName, i, { label: e.target.value })} aria-label={`Heading for ${f.key}`} />
          <span className="muted" style={{ minWidth: 110 }}>{values[f.key] || ''}</span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="page">
      {notify ? <Toast {...notify} onClose={() => setNotify(null)} /> : null}
      <div className="page-head">
        <div>
          <h1 className="page-title">ID Card Designer</h1>
          <p className="page-subtitle">Step 1: Edit any block. Step 2: Pick a color. Step 3: Save. Card shape never changes.</p>
        </div>
      </div>
      <div className="register-grid">
        <div>
          <div className="card">
            <h3 className="card-title">Block 1 — Top heading</h3>
            <label className="login-label" htmlFor="hdrTitle">Main title</label>
            <input id="hdrTitle" className="input" value={design.headerTitle || ''} onChange={(e) => set('headerTitle', e.target.value)} />
            <label className="login-label" htmlFor="hdrSub" style={{ marginTop: 10 }}>Small line below (empty = election name)</label>
            <input id="hdrSub" className="input" value={design.headerSubtitle || ''} onChange={(e) => set('headerSubtitle', e.target.value)} />
          </div>
          {fieldEditor('officerFields', 'Block 2 — Officer details', 'Tick to show; rename heading.')}
          {fieldEditor('dutyFields', 'Block 3 — Duty details', 'Tick to show; rename heading.')}

          <div className="card" style={{ marginTop: 12 }}>
            <h3 className="card-title">Block 4 — Stamp, signature and bottom note</h3>
            <label className="form-check">
              <input type="checkbox" checked={design.showStamp !== false} onChange={(e) => set('showStamp', e.target.checked)} />
              {' '}Show round stamp seal
            </label>
            <label className="login-label" htmlFor="stampText" style={{ marginTop: 8 }}>Stamp words</label>
            <input id="stampText" className="input" value={design.stampText || ''} onChange={(e) => set('stampText', e.target.value)} />
            <label className="login-label" htmlFor="sigName" style={{ marginTop: 10 }}>Sign person name (empty = none)</label>
            <input id="sigName" className="input" value={design.signatureName || ''} onChange={(e) => set('signatureName', e.target.value)} />
            <label className="login-label" htmlFor="sigTitle" style={{ marginTop: 10 }}>Sign person title</label>
            <input id="sigTitle" className="input" value={design.signatureTitle || ''} onChange={(e) => set('signatureTitle', e.target.value)} />
            <label className="login-label" htmlFor="footerNote" style={{ marginTop: 10 }}>Bottom instruction line</label>
            <textarea id="footerNote" className="input" rows={3} value={design.footerNote || ''} onChange={(e) => set('footerNote', e.target.value)} />
            <div className="btn-row" style={{ marginTop: 8 }}>
              <label className="form-check">
                <input type="checkbox" checked={design.showPhoto !== false} onChange={(e) => set('showPhoto', e.target.checked)} />
                {' '}Photo box
              </label>
              <label className="form-check">
                <input type="checkbox" checked={design.showFooter !== false} onChange={(e) => set('showFooter', e.target.checked)} />
                {' '}Bottom band
              </label>
            </div>
          </div>
          <div className="card" style={{ marginTop: 12 }}>
            <h3 className="card-title">Block 5 — Custom text, signature &amp; stamp images</h3>
            <p className="muted">Add extra text boxes or upload the collector's signature / official stamp image, then drag it on the card.</p>
            <div className="btn-row" style={{ flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-secondary" onClick={addText}>+ Add custom text</button>
              <label className="btn btn-secondary" style={{ opacity: uploading ? 0.6 : 1 }}>
                {uploading ? 'Uploading…' : '+ Upload signature / stamp image'}
                <input type="file" accept="image/png,image/jpeg" style={{ display: 'none' }} disabled={uploading} onChange={(e) => { uploadAsset(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
            </div>

            <label className="login-label" htmlFor="textScale" style={{ marginTop: 12 }}>Overall text size: {Math.round((design.baseTextScale || 1) * 100)}%</label>
            <input id="textScale" type="range" min="0.7" max="1.5" step="0.05" value={design.baseTextScale || 1} onChange={(e) => set('baseTextScale', Number(e.target.value))} />

            <label className="login-label" htmlFor="watermark" style={{ marginTop: 10 }}>Watermark (empty = none) — e.g. SPECIMEN or election name</label>
            <input id="watermark" className="input" value={design.watermark || ''} onChange={(e) => set('watermark', e.target.value)} placeholder="SPECIMEN" />

            {(design.elements || []).length ? (
              <div style={{ marginTop: 12 }}>
                <strong>Custom items on this card</strong>
                {(design.elements || []).map((el) => (
                  <div key={el.id} className="field-row">
                    <label className="form-check" title="Show this item">
                      <input type="checkbox" checked={el.show !== false} onChange={(e) => updateEl(el.id, { show: e.target.checked })} />
                    </label>
                    <button type="button" className={`tab-btn ${selectedId === el.id ? 'active' : ''}`} onClick={() => setSelectedId(el.id)}>
                      {el.type === 'image' ? 'Image' : (el.text || 'Text').slice(0, 18)}
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            {selected ? (
              <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                <strong>Edit selected item</strong>
                {selected.type === 'text' ? (
                  <>
                    <label className="login-label" htmlFor="elText" style={{ marginTop: 8 }}>Text</label>
                    <input id="elText" className="input" value={selected.text || ''} onChange={(e) => updateEl(selected.id, { text: e.target.value })} />
                    <label className="login-label" htmlFor="elSize" style={{ marginTop: 8 }}>Text size: {selected.fontSize}pt</label>
                    <input id="elSize" type="range" min="4" max="48" step="1" value={selected.fontSize} onChange={(e) => updateEl(selected.id, { fontSize: Number(e.target.value) })} />
                    <div className="field-row" style={{ marginTop: 8 }}>
                      <label className="login-label" htmlFor="elColor" style={{ margin: 0 }}>Color</label>
                      <input id="elColor" type="color" value={selected.color || '#111111'} onChange={(e) => updateEl(selected.id, { color: e.target.value })} />
                      <label className="form-check"><input type="checkbox" checked={selected.fontWeight === 'bold'} onChange={(e) => updateEl(selected.id, { fontWeight: e.target.checked ? 'bold' : 'normal' })} /> Bold</label>
                      <select className="input" style={{ width: 120 }} value={selected.align || 'left'} onChange={(e) => updateEl(selected.id, { align: e.target.value })} aria-label="Text alignment">
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                      </select>
                    </div>
                    <label className="login-label" htmlFor="elFont" style={{ marginTop: 8 }}>Font style</label>
                    <select id="elFont" className="input" value={selected.fontFamily || 'sans'} onChange={(e) => updateEl(selected.id, { fontFamily: e.target.value })}>
                      {Object.entries(FONT_FAMILIES).map(([id, f]) => (
                        <option key={id} value={id}>{f.label}</option>
                      ))}
                    </select>
                  </>
                ) : null}
                <label className="login-label" htmlFor="elW" style={{ marginTop: 8 }}>Width: {selected.width}px</label>
                <input id="elW" type="range" min="20" max="440" step="2" value={selected.width} onChange={(e) => updateEl(selected.id, { width: Number(e.target.value) })} />
                <label className="login-label" htmlFor="elRot" style={{ marginTop: 8 }}>Rotation: {selected.rotation || 0}°</label>
                <input id="elRot" type="range" min="-180" max="180" step="1" value={selected.rotation || 0} onChange={(e) => updateEl(selected.id, { rotation: Number(e.target.value) })} />
                {selected.type === 'image' ? (
                  <>
                    <label className="login-label" htmlFor="elH" style={{ marginTop: 8 }}>Height: {selected.height}px</label>
                    <input id="elH" type="range" min="16" max="260" step="2" value={selected.height} onChange={(e) => updateEl(selected.id, { height: Number(e.target.value) })} />
                  </>
                ) : null}
                <label className="login-label" htmlFor="elOpacity" style={{ marginTop: 8 }}>Transparency: {Math.round((selected.opacity ?? 1) * 100)}% solid</label>
                <input id="elOpacity" type="range" min="0.1" max="1" step="0.05" value={selected.opacity ?? 1} onChange={(e) => updateEl(selected.id, { opacity: Number(e.target.value) })} />
                <p className="muted">Tip: lower it for a signature or stamp so it blends like a real one.</p>
                <div className="form-grid" style={{ marginTop: 8 }}>
                  <div>
                    <label className="login-label" htmlFor="elX">Left (X): {selected.x}</label>
                    <input id="elX" className="input" type="number" min="0" max={CARD_W} value={selected.x} onChange={(e) => updateEl(selected.id, { x: clamp(Number(e.target.value), 0, CARD_W, selected.x) })} />
                  </div>
                  <div>
                    <label className="login-label" htmlFor="elY">Top (Y): {selected.y}</label>
                    <input id="elY" className="input" type="number" min="0" max={CARD_H} value={selected.y} onChange={(e) => updateEl(selected.id, { y: clamp(Number(e.target.value), 0, CARD_H, selected.y) })} />
                  </div>
                </div>
                <div className="btn-row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
                  <button type="button" className={`tab-btn ${selected.locked ? 'active' : ''}`} onClick={() => updateEl(selected.id, { locked: !selected.locked })} title="Lock its position so a stray click can't move it">
                    {selected.locked ? '🔒 Locked' : '🔓 Unlocked'}
                  </button>
                  <button type="button" className="tab-btn" onClick={() => duplicateEl(selected.id)} title="Make a copy of this item">Duplicate</button>
                  <button type="button" className="tab-btn" onClick={() => stackEl(selected.id, 'front')} title="Bring on top of other items">Bring to front</button>
                  <button type="button" className="tab-btn" onClick={() => stackEl(selected.id, 'back')} title="Send behind other items">Send to back</button>
                </div>
                <div className="form-actions" style={{ marginTop: 8 }}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeEl(selected.id)}>Delete this item</button>
                </div>
              </div>
            ) : null}
          </div>
          <div className="card" style={{ marginTop: 12 }}>
            <h3 className="card-title">Block 6 — Color (pick one)</h3>
            <div className="btn-row" style={{ flexWrap: 'wrap' }}>
              {Object.entries(THEME_LABELS).map(([id, t]) => (
                <button key={id} type="button" className={`tab-btn ${design.theme === id ? 'active' : ''}`} onClick={() => set('theme', id)}>
                  <span className="theme-dot" style={{ background: t.color }} /> {t.label}
                </button>
              ))}
            </div>
            <div className="form-actions" style={{ marginTop: 14 }}>
              <button type="button" className="btn btn-primary" disabled={saving} onClick={doSave}>
                {saving ? 'Saving…' : 'Save Card Design'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={doReset}>
                Reset to Original
              </button>
            </div>
          </div>
        </div>
        <div>
          <div className="card">
            <h3 className="card-title">Step 1: Drag to arrange — click an item to edit</h3>
            <p className="muted">Drag any custom text or signature/stamp image. Click it to change size, rotation, color or delete it.</p>
            <div className="idcard-canvas" ref={canvasRef} style={{ '--card-navy': themeColor, width: CARD_W, height: CARD_H }}>
              {design.watermark ? <div className="idcard-watermark">{design.watermark}</div> : null}
              <div className="idcard-header">
                <div>
                  <strong>{design.headerTitle || 'POLLING DUTY OFFICER ID CARD'}</strong>
                  <div className="idcard-sub">{design.headerSubtitle || 'General Elections - Election Administration'}</div>
                </div>
                <span className="idcard-official">OFFICIAL</span>
              </div>
              <div className="idcard-body">
                {design.showPhoto !== false ? <div className="idcard-photo">RK</div> : null}
                <div className="idcard-officer">
                  <div className="muted">NAME</div>
                  <strong>{values.officerName || 'Ravi Kumar'}</strong>
                  {visibleOfficer.map((f) => (
                    <div key={f.key} className="idcard-line">
                      <span className="muted">{(f.label || f.key).toUpperCase()}</span>
                      <span>{values[f.key] || '-'}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="idcard-duty">
                <strong>DUTY ALLOCATION</strong>
                <div className="idcard-duty-grid">
                  {visibleDuty.map((f) => (
                    <div key={f.key} className="idcard-line">
                      <span className="muted">{(f.label || f.key).toUpperCase()}</span>
                      <span>{values[f.key] || '-'}</span>
                    </div>
                  ))}
                </div>
                {design.showStamp !== false ? <div className="idcard-stamp">{design.stampText || 'ELECTION DUTY'}</div> : null}
                {design.signatureName ? <div className="idcard-sign">{design.signatureName}{design.signatureTitle ? `, ${design.signatureTitle}` : ''}</div> : null}
              </div>
              {design.showFooter !== false ? (
                <div className="idcard-footer">
                  <div>{design.footerNote}</div>
                </div>
              ) : null}
              {(design.elements || []).filter((e) => e.show !== false).map((el) => (
                <div
                  key={el.id}
                  className={`idcard-el ${el.type === 'image' ? 'is-image' : ''} ${selectedId === el.id ? 'selected' : ''}`}
                  style={{ left: el.x, top: el.y, width: el.width, minHeight: el.height, transform: `rotate(${el.rotation || 0}deg)`, color: el.color, fontSize: el.fontSize, fontWeight: el.fontWeight, fontFamily: (FONT_FAMILIES[el.fontFamily] || FONT_FAMILIES.sans).css, textAlign: el.align }}
                  onPointerDown={(e) => onPointerDown(e, el)}
                >
                  {el.type === 'image'
                    ? <img src={el.src} alt="" draggable={false} style={{ opacity: el.opacity ?? 1 }} />
                    : <span style={{ opacity: el.opacity ?? 1 }}>{el.text}</span>}
                </div>
              ))}
            </div>
            <a className="btn btn-secondary btn-sm" style={{ marginTop: 10 }} href={`/api/settings/idcard/preview.pdf?theme=${design.theme}&t=${previewKey}`} target="_blank" rel="noreferrer">
              Open Real PDF Preview
            </a>
            <p className="muted">Tip: Save first, then open the PDF — it shows the exact print output.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

