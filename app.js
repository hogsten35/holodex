// ═══════════════════════════════════════════
//  HoloDex v3  |  BossHog Gaming  |  app.js
// ═══════════════════════════════════════════

// ── STATE ────────────────────────────────────────────────
let collection = JSON.parse(localStorage.getItem('holodex_collection') || '[]');
let wishlist = JSON.parse(localStorage.getItem('holodex_wishlist') || '[]');
let valueHistory = JSON.parse(localStorage.getItem('holodex_value_history') || '[]');
let allSets = [], filteredSets = [];
let currentCard = null, currentFilter = 'all', collView = 'grid';
let priceChart = null, modalChart = null;
let ebayToken = null, ebayTokenExp = 0;
let scanAborted = false;
let qrPollTimer = null;

const CONDITIONS = ['NM','LP','MP','HP','DMG'];
const EBAY_COND = { NM:'1000', LP:'1500', MP:'2000', HP:'3000', DMG:'4000' };

// ── INIT ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // eBay keys are stored server-side — no client init needed
  renderCollection();
  loadSets();
  loadHome();
});

// ── KEYS — stored server-side in Netlify env vars ────────
// The browser never receives your secret keys. Netlify Functions read them from environment variables.
function getKeys() { return { clientId: '', clientSecret: '' }; }
function saveKeys() {}
function hasKeys() { return true; } // Always attempt pricing; the server will report missing env vars.

async function testEbayKeys() {
  const statusEl = document.getElementById('ebayStatus');
  if(!statusEl) return;
  statusEl.style.cssText = 'display:block;font-size:13px;padding:8px 4px;color:var(--text2);';
  statusEl.textContent = 'Testing server-side eBay connection…';

  try {
    const res = await fetch('/.netlify/functions/ebay-debug');
    const d = await res.json().catch(() => ({}));

    if (res.ok && d.step === 'search' && !d.errors && (d.itemCount || 0) > 0) {
      statusEl.style.cssText = 'display:block;font-size:13px;padding:8px 4px;color:var(--green);font-weight:600;';
      statusEl.textContent = `✓ Connected! eBay returned ${d.itemCount} test listings.`;
      return;
    }

    if (d.step === 'keys') {
      statusEl.style.cssText = 'display:block;font-size:13px;padding:8px 4px;color:var(--red);';
      statusEl.textContent = '✗ eBay keys are missing in Netlify env vars.';
      return;
    }

    if (d.step === 'token') {
      statusEl.style.cssText = 'display:block;font-size:13px;padding:8px 4px;color:var(--red);';
      statusEl.textContent = '✗ eBay token failed: ' + (d.error || 'check Production Client ID / Client Secret');
      return;
    }

    statusEl.style.cssText = 'display:block;font-size:13px;padding:8px 4px;color:var(--red);';
    statusEl.textContent = '✗ eBay search failed: ' + (d.error || d.errors?.[0]?.message || 'unknown error');
  } catch(e) {
    statusEl.style.cssText = 'display:block;font-size:13px;padding:8px 4px;color:var(--red);';
    statusEl.textContent = '✗ Error: ' + e.message;
  }
}

// ── NAV ───────────────────────────────────────────────────
function showPage(name) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('page-'+name)?.classList.add('active');
  document.getElementById('nav-'+name)?.classList.add('active');
  if(name==='collection') renderCollection();
  if(name==='home') renderHomeStats();
  if(name==='wishlist') renderWishlist();
}

// ── HOME ─────────────────────────────────────────────────
function renderHomeStats() {
  const total = collection.reduce((s,c)=>s+(c.avgPrice||0),0);
  const sets = new Set(collection.map(c=>c.set_id).filter(Boolean)).size;
  const sorted = [...collection].sort((a,b)=>(b.avgPrice||0)-(a.avgPrice||0));
  const top = sorted[0];
  document.getElementById('heroValue').textContent = '$'+total.toFixed(2);
  document.getElementById('heroCards').textContent = collection.length;
  document.getElementById('heroSets').textContent = sets;
  document.getElementById('heroTop').textContent = top ? (top.name.split(' ').slice(0,2).join(' ')) : '—';
  renderValueChart();
  if(sorted.length) {
    document.getElementById('topCardsSection').style.display='block';
    renderTopCards(sorted.slice(0,5));
  }
}

let valueChartInstance = null;
function renderValueChart() {
  const canvas = document.getElementById('valueChartCanvas');
  if(!canvas) return;
  if(valueChartInstance){valueChartInstance.destroy();valueChartInstance=null;}
  if(valueHistory.length < 2) { canvas.parentElement.style.display='none'; return; }
  canvas.parentElement.style.display='block';
  const labels = valueHistory.map(v=>{ const d=new Date(v.date); return d.toLocaleDateString('en-US',{month:'short',day:'numeric'}); });
  const values = valueHistory.map(v=>v.value);
  valueChartInstance = new Chart(canvas,{
    type:'line',
    data:{labels,datasets:[{data:values,borderColor:'#7c3aed',backgroundColor:ctx=>{const g=ctx.chart.ctx.createLinearGradient(0,0,0,100);g.addColorStop(0,'rgba(124,58,237,0.25)');g.addColorStop(1,'rgba(124,58,237,0)');return g;},fill:true,tension:0.4,pointRadius:0,borderWidth:2.5}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{backgroundColor:'#1c2230',callbacks:{label:ctx=>' $'+ctx.parsed.y.toFixed(2)}}},scales:{x:{display:false},y:{display:false}}}
  });
}

function renderTopCards(cards) {
  const el = document.getElementById('topCardsRow');
  if(!el || !cards.length) return;
  el.innerHTML = cards.map(c=>`
    <div class="top-card-item" onclick="openCollCard(${c.id})">
      <img src="${c.image||''}" alt="${c.name}" onerror="this.style.background='var(--bg3)'"/>
      <div class="top-card-name">${c.name.split(' ').slice(0,2).join(' ')}</div>
      <div class="top-card-price">${c.avgPrice?'$'+c.avgPrice.toFixed(2):'—'}</div>
    </div>`).join('');
}

async function loadHome() {
  renderHomeStats();
  loadChaseCards();
  loadNews();
}

async function loadChaseCards() {
  const el = document.getElementById('chaseScroll');
  try {
    // Pull top sets and get their high-value cards
    const res = await fetch('https://api.pokemontcg.io/v2/cards?q=rarity:"Special Illustration Rare" OR rarity:"Illustration Rare" OR rarity:"Secret Rare"&orderBy=-tcgplayer.prices.holofoil.market&pageSize=20');
    const d = await res.json();
    const cards = (d.data||[]).filter(c=>c.tcgplayer?.prices);
    if(!cards.length){el.innerHTML='<p style="color:var(--text3);font-size:13px;padding:12px;">Load chase cards by adding eBay keys.</p>';return;}
    el.innerHTML = cards.slice(0,12).map(c=>{
      const price = getCardPrice(c);
      return `<div class="chase-card" onclick="openCardModal('${c.id}')">
        <img src="${c.images?.small||''}" alt="${c.name}" loading="lazy"/>
        <div class="chase-card-info">
          <div class="chase-name">${c.name}</div>
          <div class="chase-price">${price?'$'+price:'—'}</div>
          <div class="chase-trend">🔥 Hot pull</div>
        </div>
      </div>`;
    }).join('');
  } catch(e) {
    el.innerHTML = '<p style="color:var(--text3);font-size:13px;padding:8px 0;">Could not load chase cards.</p>';
  }
}

function getCardPrice(card) {
  const p = card.tcgplayer?.prices;
  if(!p) return null;
  const v = p.holofoil?.market || p['1stEditionHolofoil']?.market || p.normal?.market || p.reverseHolofoil?.market;
  return v ? v.toFixed(2) : null;
}

async function loadNews() {
  const el = document.getElementById('newsFeed');
  try {
    const res = await fetch('/.netlify/functions/news');
    const text = await res.text();
    const parser = new DOMParser();
    const xml = parser.parseFromString(text, 'text/xml');
    const items = Array.from(xml.querySelectorAll('item')).slice(0,6);
    if(!items.length) throw new Error('no items');
    el.innerHTML = items.map(item=>{
      const title = item.querySelector('title')?.textContent||'';
      const link = item.querySelector('link')?.textContent||'#';
      const date = item.querySelector('pubDate')?.textContent||'';
      const d = date ? new Date(date).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '';
      return `<div class="news-item" onclick="openLink('${link}')">
        <div class="news-dot"></div>
        <div><div class="news-title">${title}</div><div class="news-src">PokéBeach · ${d}</div></div>
      </div>`;
    }).join('');
  } catch(e) {
    // Fallback static headlines
    el.innerHTML = [
      ['New Stellar Crown Set Revealed for 2025','PokéBeach'],
      ['Charizard ex 151 Reaches All-Time High on TCGPlayer','TCG News'],
      ['Pokémon TCG Championship Season Dates Announced','Play Pokémon'],
      ['Prismatic Evolutions Reprint Coming Q3','PokéBeach'],
      ['Mew ex 151 SIR Surges 40% in Past Month','TCG Market'],
    ].map(([t,s])=>`<div class="news-item"><div class="news-dot"></div><div><div class="news-title">${t}</div><div class="news-src">${s}</div></div></div>`).join('');
  }
}

function openLink(url) { window.open(url, '_blank', 'noopener'); }

// ── LIVE CAMERA ──────────────────────────────────────────
let cameraStream = null;
let facingMode = 'environment'; // rear camera by default

async function openCamera() {
  const scanner = document.getElementById('cameraScanner');
  scanner.classList.add('active');
  await startCamera();
}

async function startCamera() {
  // Stop any existing stream
  if(cameraStream) { cameraStream.getTracks().forEach(t=>t.stop()); cameraStream=null; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 }, aspectRatio: { ideal: 16/9 } },
      audio: false
    });
    cameraStream = stream;
    const video = document.getElementById('cameraVideo');
    video.srcObject = stream;
    await video.play();
  } catch(err) {
    console.warn('Camera error:', err.message);
    // Fall back to file input if camera not available
    closeCamera();
    document.getElementById('fileIn').click();
    toast('Camera unavailable — use Gallery instead');
  }
}

async function flipCamera() {
  facingMode = facingMode === 'environment' ? 'user' : 'environment';
  await startCamera();
}

function closeCamera() {
  if(cameraStream) { cameraStream.getTracks().forEach(t=>t.stop()); cameraStream=null; }
  document.getElementById('cameraScanner').classList.remove('active');
}

function capturePhoto() {
  const video = document.getElementById('cameraVideo');
  const canvas = document.getElementById('captureCanvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);

  // Flash effect
  const flash = document.createElement('div');
  flash.style.cssText = 'position:fixed;inset:0;background:#fff;z-index:9999;opacity:0.8;pointer-events:none;transition:opacity 0.3s;';
  document.body.appendChild(flash);
  setTimeout(()=>{ flash.style.opacity='0'; setTimeout(()=>flash.remove(),300); },50);

  // Get the image
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  closeCamera();

  // Show preview and trigger scan
  imgB64 = dataUrl.split(',')[1];
  const img = document.getElementById('previewImg');
  img.src = dataUrl;
  img.style.display = 'block';
  document.querySelector('.sz-icon').style.display = 'none';
  document.querySelector('.sz-label').style.display = 'none';
  document.querySelector('.sz-sub').style.display = 'none';
  document.getElementById('szChange').style.display = 'block';
  document.getElementById('resultArea').classList.remove('show');
  document.getElementById('errBox').classList.remove('show');

  // Auto-trigger scan
  setTimeout(()=>scanCard(), 300);
}

// ── FILE HANDLING ─────────────────────────────────────────
let imgB64 = null;
function triggerUpload() { document.getElementById('fileIn').click(); }

// Compress image to max 1200px and 85% quality before sending to API
function compressImage(dataUrl, maxSize=1200, quality=0.85) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let w = img.width, h = img.height;
      if (w > maxSize || h > maxSize) {
        if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
        else { w = Math.round(w * maxSize / h); h = maxSize; }
      }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality).split(',')[1]);
    };
    img.src = dataUrl;
  });
}

function handleFile(input) {
  const file = input.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    const compressed = await compressImage(e.target.result);
    imgB64 = compressed;
    const img = document.getElementById('previewImg');
    img.src = 'data:image/jpeg;base64,'+compressed; img.style.display = 'block';
    document.querySelector('.sz-icon').style.display = 'none';
    document.querySelector('.sz-label').style.display = 'none';
    document.querySelector('.sz-sub').style.display = 'none';
    document.getElementById('szChange').style.display = 'block';
    document.getElementById('resultArea').classList.remove('show');
    document.getElementById('errBox').classList.remove('show');
    setTimeout(()=>scanCard(), 300);
  };
  reader.readAsDataURL(file);
}

// ── MANUAL SEARCH ─────────────────────────────────────────
function toggleManual() {
  const el = document.getElementById('manualArea');
  el.classList.toggle('show');
}

async function manualSearch() {
  const name = document.getElementById('mName').value.trim();
  const number = document.getElementById('mNumber').value.trim();
  const set = document.getElementById('mSet').value.trim();
  if(!name) { showErr('Enter at least a card name.'); return; }
  imgB64 = null;
  currentCard = {
    name, number: number||null, set: set||null, set_id: null,
    year: document.getElementById('mYear').value.trim()||null,
    rarity: null, condition: 'NM', condition_notes: null,
    search_query: `Pokemon ${name}${number?' '+number:''}${set?' '+set:''}`
  };
  await showCardResults(currentCard);
}

// ── EBAY PRICING ─────────────────────────────────────────
// Pricing requests go through /.netlify/functions/ebay-search so secrets stay on Netlify.
function parseMoney(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function titleLooksRelevant(title, cardName) {
  const t = String(title || '').toLowerCase();
  const nameWords = String(cardName || '').toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const bad = /\b(proxy|custom|digital|code card|online code|empty pack|pack fresh only|jumbo|oversized|sticker|art card)\b/i;
  if (bad.test(t)) return false;
  // Avoid large mixed lots because they inflate/deflate card value. Keep tiny lots because some sellers say "lot 1".
  if (/\b(lot|bundle|collection)\b/i.test(t) && !/\b(single|individual)\b/i.test(t)) return false;
  if (!nameWords.length) return true;
  return nameWords.some(w => t.includes(w));
}

function inferCondition(item) {
  const txt = `${item.title || ''} ${item.condition || ''} ${item.conditionId || ''}`.toLowerCase();
  if (/\b(dmg|damaged|poor)\b/.test(txt)) return 'DMG';
  if (/\b(hp|heavy played|heavily played)\b/.test(txt)) return 'HP';
  if (/\b(mp|moderate played|moderately played)\b/.test(txt)) return 'MP';
  if (/\b(lp|light played|lightly played|excellent)\b/.test(txt)) return 'LP';
  if (/\b(nm|near mint|mint|ungraded|raw)\b/.test(txt)) return 'NM';
  return 'NM';
}

function aggregatePrices(items) {
  const buckets = { NM: [], LP: [], MP: [], HP: [], DMG: [] };
  for (const item of items) {
    const price = parseMoney(item.price?.value || item.currentBidPrice?.value);
    if (!price) continue;
    if (item.price?.currency && item.price.currency !== 'USD') continue;
    const shipping = parseMoney(item.shippingOptions?.[0]?.shippingCost?.value) || 0;
    const total = +(price + shipping).toFixed(2);
    buckets[inferCondition(item)].push(total);
  }

  const out = {};
  for (const cond of CONDITIONS) {
    const arr = buckets[cond].filter(Number.isFinite).sort((a,b)=>a-b);
    if (!arr.length) continue;
    // Trim extreme outliers when we have enough listings.
    const trimmed = arr.length >= 8 ? arr.slice(1, -1) : arr;
    const avg = trimmed.reduce((s,n)=>s+n,0) / trimmed.length;
    out[cond] = {
      avg: +avg.toFixed(2),
      low: +trimmed[0].toFixed(2),
      high: +trimmed[trimmed.length - 1].toFixed(2),
      count: trimmed.length
    };
  }
  return Object.keys(out).length ? out : null;
}

async function callEbaySearch(query, limit = 50) {
  const res = await fetch('/.netlify/functions/ebay-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit })
  });

  let data = {};
  try { data = await res.json(); } catch(e) {}

  if (!res.ok || data.error) {
    throw new Error(data.error || `eBay search failed (${res.status})`);
  }
  return data;
}

async function fetchEbayPrices(query) {
  const srcEl = document.getElementById('priceSrc');
  const cardName = currentCard?.name || String(query || '').replace(/^pokemon\s+/i,'').split(/\s+/).slice(0,3).join(' ');
  const cardNumber = currentCard?.number ? String(currentCard.number).split('/')[0] : '';
  const setName = currentCard?.set || '';

  const queries = [
    query,
    `Pokemon ${cardName} ${cardNumber} ${setName}`.trim(),
    `Pokemon ${cardName} ${cardNumber}`.trim(),
    `Pokemon ${cardName} holo`,
    `Pokemon ${cardName}`
  ].filter(Boolean);

  const seen = new Set();
  let lastError = null;

  for (const q of queries) {
    if (seen.has(q.toLowerCase())) continue;
    seen.add(q.toLowerCase());
    try {
      const data = await callEbaySearch(q, 75);
      const rawItems = data.itemSummaries || [];
      const items = rawItems.filter(item => titleLooksRelevant(item.title, cardName));
      const prices = aggregatePrices(items);
      if (prices) {
        if(srcEl) srcEl.textContent = `eBay market listings · ${items.length} matches`;
        return prices;
      }
    } catch(e) {
      lastError = e;
      break;
    }
  }

  if(srcEl) srcEl.textContent = lastError ? `eBay unavailable: ${lastError.message}` : 'No eBay matches found';
  return null;
}

async function fetchPriceHistory(query) {
  // The current eBay Browse endpoint returns current market listings, not historical sold data.
  // Returning null lets the existing chart render a smooth estimate based on the current average.
  return null;
}



// ── CARD RESOLUTION ─────────────────────────────────────
// Vision can read the card name but still guess the wrong set/collector number.
// Before showing a result, we validate the scan against PokémonTCG.io and keep the
// exact printing with the best score.
function cleanText(v) {
  return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function firstCardNumber(v) {
  const m = String(v || '').match(/[A-Z]*\d+[a-z]?/i);
  return m ? m[0].replace(/^0+(?=\d)/, '') : '';
}

function displayTcgNumber(apiCard) {
  const n = apiCard?.number;
  if (!n) return null;
  const total = apiCard?.set?.printedTotal;
  if (total && /^\d+$/.test(String(n))) {
    const pad = String(total).length;
    return `${String(n).padStart(pad, '0')}/${total}`;
  }
  return n;
}

function cardTextBlob(apiCard) {
  const abilities = (apiCard.abilities || []).map(a => `${a.name} ${a.text}`).join(' ');
  const attacks = (apiCard.attacks || []).map(a => `${a.name} ${a.text} ${a.damage}`).join(' ');
  return cleanText(`${apiCard.name} ${apiCard.hp || ''} ${(apiCard.types || []).join(' ')} ${apiCard.rarity || ''} ${abilities} ${attacks}`);
}

function scannedTextBlob(card) {
  const abilities = Array.isArray(card.abilities) ? card.abilities.join(' ') : (card.ability || '');
  const attacks = Array.isArray(card.attacks) ? card.attacks.join(' ') : (card.attack || '');
  return cleanText(`${card.visible_text || ''} ${card.hp || ''} ${(card.types || []).join(' ')} ${card.rarity || ''} ${abilities} ${attacks}`);
}

function scoreTcgCandidate(apiCard, scan) {
  const apiName = cleanText(apiCard.name);
  const scanName = cleanText(scan.name || scan.pokemon);
  const apiNum = firstCardNumber(apiCard.number);
  const scanNum = firstCardNumber(scan.number);
  const apiSet = cleanText(apiCard.set?.name);
  const scanSet = cleanText(scan.set);
  const scanSetId = cleanText(scan.set_id);
  const apiBlob = cardTextBlob(apiCard);
  const scanBlob = scannedTextBlob(scan);

  let score = 0;
  if (scanName && apiName === scanName) score += 70;
  else if (scanName && (apiName.includes(scanName) || scanName.includes(apiName))) score += 35;
  else score -= 90;

  // Number/set are useful, but vision models often hallucinate them on blurry photos.
  // Treat them as hints, not truth.
  if (scanNum && apiNum) {
    if (scanNum === apiNum) score += 45;
    else score -= 10;
  }

  if (scan.set_id && apiCard.set?.id && cleanText(apiCard.set.id) === scanSetId) score += 25;
  if (scanSet && apiSet.includes(scanSet)) score += 20;
  if (scan.year && apiCard.set?.releaseDate?.startsWith(String(scan.year))) score += 10;
  if (scan.hp && String(apiCard.hp || '') === String(scan.hp)) score += 18;

  for (const t of (scan.types || [])) {
    if ((apiCard.types || []).map(cleanText).includes(cleanText(t))) score += 8;
  }

  // Visible move/ability text is the strongest way to select the exact printing.
  // Example: the photographed Psyduck shows “Damp” and “Ram 20”; that beats a
  // guessed collector number from another Psyduck card.
  const signalSource = [
    ...(Array.isArray(scan.abilities) ? scan.abilities : [scan.ability || '']),
    ...(Array.isArray(scan.attacks) ? scan.attacks : [scan.attack || ''])
  ].join(' ');
  const stop = new Set(['pokemon','ability','attack','damage','weakness','resistance','retreat','card','near','mint','condition','sleeve','protective','colorless','energy']);
  const signals = cleanText(signalSource).split(' ').filter(w => w.length >= 3 && !stop.has(w) && !/^\d+$/.test(w));
  let signalMatches = 0;
  for (const w of new Set(signals)) {
    if (apiBlob.includes(w)) { score += 34; signalMatches++; }
  }
  if (signals.length >= 1 && signalMatches === 0) score -= 70;

  // visible_text is weaker because it may contain generic card-template words.
  if (scanBlob) {
    const important = scanBlob.split(' ').filter(w => w.length >= 4 && !stop.has(w) && !/^\d+$/.test(w));
    for (const w of new Set(important).values()) {
      if (apiBlob.includes(w)) score += 4;
    }
  }

  return score;
}

function tcgToHoloDexCard(apiCard, scan = {}) {
  const displayNumber = displayTcgNumber(apiCard) || scan.number || null;
  return {
    ...scan,
    name: apiCard.name || scan.name,
    pokemon: scan.pokemon || apiCard.name?.split(' ')?.[0] || scan.name,
    set: apiCard.set?.name || scan.set || null,
    set_id: apiCard.set?.id || scan.set_id || null,
    number: displayNumber,
    year: apiCard.set?.releaseDate?.substring(0, 4) || scan.year || null,
    rarity: apiCard.rarity || scan.rarity || null,
    hp: apiCard.hp || scan.hp || null,
    types: apiCard.types || scan.types || [],
    artist: apiCard.artist || scan.artist || null,
    condition: scan.condition || 'NM',
    condition_notes: scan.condition_notes || null,
    search_query: `Pokemon ${apiCard.name || scan.name || ''} ${displayNumber || ''} ${apiCard.set?.name || scan.set || ''}`.trim(),
    _tcgId: apiCard.id || scan._tcgId || null,
    _tcgImage: apiCard.images?.large || apiCard.images?.small || scan._tcgImage || null,
    _resolvedScore: apiCard._score || null
  };
}

async function fetchTcgCandidates(scan) {
  const attempts = [];
  const name = String(scan.name || scan.pokemon || '').trim();
  const num = firstCardNumber(scan.number);

  if (scan.set_id && num) attempts.push(`set.id:${scan.set_id} number:${num}`);
  if (name && num) attempts.push(`name:"${name}" number:${num}`);
  if (scan.set_id && name) attempts.push(`set.id:${scan.set_id} name:"${name}"`);
  if (name) attempts.push(`name:"${name}"`);
  if (scan.pokemon && cleanText(scan.pokemon) !== cleanText(name)) attempts.push(`name:"${scan.pokemon}"`);

  const seenQueries = new Set();
  const seenCards = new Set();
  const out = [];

  for (const q of attempts) {
    const key = q.toLowerCase();
    if (seenQueries.has(key)) continue;
    seenQueries.add(key);
    try {
      const res = await fetch(`https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q)}&pageSize=250`);
      if (!res.ok) continue;
      const d = await res.json();
      for (const c of (d.data || [])) {
        if (seenCards.has(c.id)) continue;
        seenCards.add(c.id);
        out.push(c);
      }
    } catch(e) {
      console.warn('TCG candidate lookup failed:', q, e.message);
    }
  }
  return out;
}

async function resolveCardWithTcg(scan) {
  const srcEl = document.getElementById('priceSrc');
  const candidates = await fetchTcgCandidates(scan);
  if (!candidates.length) {
    if (srcEl) srcEl.textContent = 'Could not verify exact print from PokémonTCG.io';
    return scan;
  }

  const scored = candidates.map(c => ({ ...c, _score: scoreTcgCandidate(c, scan) }))
    .sort((a, b) => b._score - a._score);
  const best = scored[0];
  const second = scored[1];

  // If the top result is not clearly better, keep the AI result but still use the best image.
  // This prevents false “corrections” on blurry photos.
  const confident = best._score >= 70 && (!second || best._score - second._score >= 12);
  if (!confident && srcEl) {
    srcEl.textContent = 'Best match not fully certain — retake photo straight-on for exact print';
  }

  const resolved = tcgToHoloDexCard(best, scan);
  resolved._matchWarning = !confident;
  console.log('HoloDex resolved scan:', {
    ai: { name: scan.name, set: scan.set, number: scan.number, set_id: scan.set_id },
    selected: { name: resolved.name, set: resolved.set, number: resolved.number, set_id: resolved.set_id, tcgId: resolved._tcgId, score: best._score },
    runnerUp: second ? { name: second.name, set: second.set?.name, number: second.number, score: second._score } : null
  });
  return resolved;
}

async function fetchCardImage(card) {
  try {
    if (card?._tcgImage) return card._tcgImage;
    if (card?._tcgId) {
      const res = await fetch(`https://api.pokemontcg.io/v2/cards/${card._tcgId}`);
      const d = await res.json();
      if (d.data?.images) return d.data.images.large || d.data.images.small;
    }

    const resolved = await resolveCardWithTcg(card);
    if (resolved?._tcgImage) {
      if (currentCard && card === currentCard) Object.assign(currentCard, resolved);
      return resolved._tcgImage;
    }
  } catch(e) { console.warn('Card image error:', e.message); }
  return null;
}

// ── SCAN OVERLAY ──────────────────────────────────────────
function showScanOverlay(dataUrl) {
  document.getElementById('scanOverlayImg').src = dataUrl;
  document.getElementById('scanOverlayPanel').classList.add('active');
  document.getElementById('scanProgressFill').style.width = '0%';
  for(let i=0;i<4;i++) setStep(i,'wait');
}
function hideScanOverlay() {
  document.getElementById('scanOverlayPanel').classList.remove('active');
  document.getElementById('scanLine').classList.remove('active');
  document.getElementById('holoOverlay').classList.remove('active');
  document.getElementById('scanDataGrid').classList.remove('active');
  // Reset hint text
  const hint = document.getElementById('scanHintText');
  if(hint) { hint.style.opacity='1'; hint.textContent='Align card within corners'; }
}
function cancelScan(){hideScanOverlay();scanAborted=true;}
function setStep(i,s){
  const ic=document.getElementById('si'+i),ti=document.getElementById('st'+i),sub=document.getElementById('ss'+i);
  ic.className='step-icon '+s;
  ti.className='step-title'+(s==='wait'?' wait':'');
  if(sub) sub.className='step-sub'+(s==='active'?' live':'');
  ic.textContent=s==='done'?'✓':i+1;
}
function setProgress(p){document.getElementById('scanProgressFill').style.width=p+'%';}
function setScanStatus(t){document.getElementById('scanStatusText').textContent=t;}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

// ── SCAN CARD ─────────────────────────────────────────────
async function scanCard() {
  if(!imgB64){showErr('Take or upload a photo first.');return;}
  scanAborted=false;
  document.getElementById('errBox').classList.remove('show');
  const dataUrl = document.getElementById('previewImg').src;
  showScanOverlay(dataUrl);
  setStep(0,'active'); setScanStatus('Processing image…'); setProgress(5);
  document.getElementById('scanDataGrid').classList.add('active');
  await sleep(600); if(scanAborted) return;
  setStep(0,'done'); setStep(1,'active'); setScanStatus('Analyzing card…'); setProgress(20);
  document.getElementById('scanLine').classList.add('active');
  document.getElementById('holoOverlay').classList.add('active');
  // Hide alignment hint once scanning begins
  const hint = document.getElementById('scanHintText');
  if(hint) { hint.style.opacity='0'; hint.style.transition='opacity 0.4s'; }
  try {
    const identifyPromise = fetch('/.netlify/functions/identify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({imageBase64:imgB64})});
    await sleep(1400); if(scanAborted) return;
    setStep(1,'done'); setStep(2,'active'); setScanStatus('Searching records…'); setProgress(55);
    const res = await identifyPromise;
    const d = await res.json();
    if(scanAborted) return;
    setStep(2,'done'); setStep(3,'active'); setScanStatus('Getting value…'); setProgress(75);
    // Check for API-level errors passed through from function
    if(d._apiError) throw new Error('API error: ' + d._apiError);
    if(d.error) throw new Error('Server error: ' + (d.error.message || d.error));
    const raw = d.content?.[0]?.text?.trim()||'';
    if(!raw) throw new Error('Empty response from AI — check ANTHROPIC_API_KEY is set in Netlify environment variables');
    const m = raw.match(/\{[\s\S]*\}/);
    if(!m) throw new Error('Could not parse card data. Raw response: ' + raw.substring(0, 100));
    currentCard = JSON.parse(m[0]);
    currentCard._tcgId=null; currentCard._prices=null; currentCard._history=null;

    setScanStatus('Matching exact print…'); setProgress(65);
    currentCard = await resolveCardWithTcg(currentCard);
    if(scanAborted) return;

    const imgPromise = fetchCardImage(currentCard);
    let prices=null, history=null;
    if(hasKeys()) [prices,history]=await Promise.all([fetchEbayPrices(currentCard.search_query),fetchPriceHistory(currentCard.search_query)]);
    if(scanAborted) return;
    setStep(3,'done'); setProgress(100); setScanStatus('Complete!');
    await sleep(500);
    hideScanOverlay();
    currentCard._prices=prices; currentCard._history=history;
    const cardImgUrl = await imgPromise;
    if(cardImgUrl) document.getElementById('resultImg').src=cardImgUrl;
    showScanResults(prices, history);
  } catch(err){
    hideScanOverlay();
    document.getElementById('resultArea').classList.remove('show');
    showErr('Error: '+err.message);
  }
}

async function showCardResults(card) {
  card = await resolveCardWithTcg(card);
  currentCard = card;
  document.getElementById('resultArea').classList.add('show');
  document.getElementById('scanResult') && (document.getElementById('scanResult').style.display='block');
  document.getElementById('resultName').textContent = card.name||'Unknown';
  document.getElementById('resultMeta').textContent = [card.set,card.number?'#'+card.number:null,card.year].filter(Boolean).join('  ·  ');
  const rBadge=document.getElementById('rarityBadge');
  if(card.rarity){rBadge.textContent=card.rarity;rBadge.style.display='inline-flex';}else rBadge.style.display='none';
  const cond=card.condition||'NM';
  const cBadge=document.getElementById('condBadge');
  cBadge.textContent=cond+(card.condition_notes?'  —  '+card.condition_notes:'');
  cBadge.className='badge badge-'+cond.toLowerCase();
  fetchCardImage(card).then(url=>{if(url)document.getElementById('resultImg').src=url;});
  document.getElementById('priceSpinner').style.display='flex';
  document.getElementById('priceTable').style.display='none';
  document.getElementById('noKeys').style.display='none';
  if(!hasKeys()){document.getElementById('priceSpinner').style.display='none';document.getElementById('noKeys').style.display='block';renderMockChart('priceChart');}
  else {
    const [prices,history]=await Promise.all([fetchEbayPrices(card.search_query),fetchPriceHistory(card.search_query)]);
    card._prices=prices;card._history=history;
    showScanResults(prices,history);
  }
}

function showScanResults(prices,history) {
  document.getElementById('resultArea').classList.add('show');
  document.getElementById('resultName').textContent=currentCard.name||'Unknown';
  document.getElementById('resultMeta').textContent=[currentCard.set,currentCard.number?'#'+currentCard.number:null,currentCard.year].filter(Boolean).join('  ·  ');
  const rBadge=document.getElementById('rarityBadge');
  if(currentCard.rarity){rBadge.textContent=currentCard.rarity;rBadge.style.display='inline-flex';}else rBadge.style.display='none';
  const cond=currentCard.condition||'NM';
  document.getElementById('condBadge').textContent=cond+(currentCard.condition_notes?'  —  '+currentCard.condition_notes:'');
  document.getElementById('condBadge').className='badge badge-'+cond.toLowerCase();
  document.getElementById('priceSpinner').style.display='none';
  document.getElementById('noKeys').style.display='none';
  renderPriceTable(prices);
  renderHistoryChart('priceChart',history,'3m',true);
  if(prices && !document.getElementById('priceSrc').textContent) document.getElementById('priceSrc').textContent='eBay market data';
  document.getElementById('resultArea').scrollIntoView({behavior:'smooth',block:'start'});
}

// ── PRICE TABLE ───────────────────────────────────────────
function renderPriceTable(prices) {
  document.getElementById('priceSpinner').style.display='none';
  if(!prices){
    document.getElementById('priceTable').style.display='none';
    document.getElementById('noKeys').textContent='No eBay listings found for this card yet. Try manual search with the card number/set.';
    document.getElementById('noKeys').style.display='block';
    return;
  }
  document.getElementById('noKeys').style.display='none';
  document.getElementById('priceTable').style.display='table';
  document.getElementById('priceTbody').innerHTML=CONDITIONS.map(c=>{
    const p=prices[c];
    if(!p) return `<tr><td><span class="badge badge-${c.toLowerCase()}">${c}</span></td><td colspan="4" class="pm">No data</td></tr>`;
    return `<tr><td><span class="badge badge-${c.toLowerCase()}">${c}</span></td><td class="pv">$${p.avg.toFixed(2)}</td><td class="phi">$${p.high.toFixed(2)}</td><td class="plo">$${p.low.toFixed(2)}</td><td class="pm">${p.count}</td></tr>`;
  }).join('');
}

// ── CHARTS ────────────────────────────────────────────────
function renderHistoryChart(canvasId, history, range, isMain) {
  const canvas = document.getElementById(canvasId); if(!canvas) return;
  if(isMain&&priceChart){priceChart.destroy();priceChart=null;}
  if(!isMain&&modalChart){modalChart.destroy();modalChart=null;}
  let labels,values;
  if(history&&history.length>=3){
    const mo=range==='3m'?3:range==='6m'?6:12;
    const cutoff=new Date();cutoff.setMonth(cutoff.getMonth()-mo);
    const f=history.filter(h=>h.date>=cutoff);
    if(f.length>=2){labels=f.map(h=>h.date.toLocaleDateString('en-US',{month:'short',day:'numeric'}));values=f.map(h=>h.price);}
  }
  if(!labels){
    const base=(currentCard?._prices?.NM?.avg)||18;
    labels=range==='3m'?['3mo','10w','8w','6w','4w','2w','Now']:range==='6m'?['6mo','5mo','4mo','3mo','2mo','1mo','Now']:['12mo','10mo','8mo','6mo','4mo','2mo','Now'];
    values=labels.map((_,i,a)=>+(base*(0.68+(i/a.length)*0.45)+Math.sin(i*.9)*base*.08+(Math.random()-.5)*base*.05).toFixed(2));
    values[values.length-1]=+base.toFixed(2);
  }
  const ref=new Chart(canvas,{type:'line',data:{labels,datasets:[{data:values,borderColor:'#7c3aed',backgroundColor:ctx=>{const g=ctx.chart.ctx.createLinearGradient(0,0,0,160);g.addColorStop(0,'rgba(124,58,237,0.22)');g.addColorStop(1,'rgba(124,58,237,0)');return g;},fill:true,tension:.4,pointRadius:3,pointBackgroundColor:'#a78bfa',pointBorderColor:'#0d1117',pointBorderWidth:1.5,borderWidth:2.5}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{backgroundColor:'#1c2230',titleColor:'#e6edf3',bodyColor:'#8b949e',borderColor:'rgba(255,255,255,0.1)',borderWidth:1,callbacks:{label:ctx=>' $'+ctx.parsed.y.toFixed(2)}}},scales:{x:{ticks:{color:'#484f58',font:{size:10,family:'Inter'},maxTicksLimit:6},grid:{color:'rgba(255,255,255,0.04)'},border:{display:false}},y:{ticks:{color:'#484f58',font:{size:10,family:'Inter'},callback:v=>'$'+v.toFixed(0)},grid:{color:'rgba(255,255,255,0.05)'},border:{display:false}}}}});
  if(isMain) priceChart=ref; else modalChart=ref;
}
function renderMockChart(id){renderHistoryChart(id,null,'3m',id==='priceChart');}
function switchChart(range,btn){document.querySelectorAll('.chart-tab').forEach(t=>t.classList.remove('active'));btn.classList.add('active');if(priceChart){priceChart.destroy();priceChart=null;}renderHistoryChart('priceChart',currentCard?._history,range,true);}

// ── ADD TO COLLECTION ─────────────────────────────────────
function addToCollection() {
  if(!currentCard) return;
  const cond=document.getElementById('addCond').value;
  pushCard({name:currentCard.name,pokemon:currentCard.pokemon,set:currentCard.set,set_id:currentCard.set_id,number:currentCard.number,year:currentCard.year,rarity:currentCard.rarity,hp:currentCard.hp,types:currentCard.types,artist:currentCard.artist,condition:cond,search_query:currentCard.search_query,image:document.getElementById('resultImg').src,avgPrice:currentCard._prices?.[cond]?.avg||null,tcgId:currentCard._tcgId||null});
  toast('✓ '+currentCard.name+' added to collection');
}
function pushCard(data){collection.push({id:Date.now(),added:new Date().toISOString(),...data});saveCollection();}

function addToWishlist(card) {
  if(!card) return;
  const already = wishlist.find(w=>w.name===card.name && w.set===card.set);
  if(already) { toast(card.name+' already in wishlist'); return; }
  wishlist.push({id:Date.now(),name:card.name,pokemon:card.pokemon,set:card.set,set_id:card.set_id,number:card.number,rarity:card.rarity,image:card.image||'',avgPrice:card.avgPrice||null,tcgId:card.tcgId||null,added:new Date().toISOString()});
  saveWishlist();
  toast('✓ Added to wishlist');
}

function removeFromWishlist(id) {
  wishlist = wishlist.filter(w=>w.id!==id);
  saveWishlist();
  renderWishlist();
}

function renderWishlist() {
  const el = document.getElementById('wishlistContent');
  if(!el) return;
  document.getElementById('wishCount').textContent = wishlist.length+' card'+(wishlist.length!==1?'s':'');
  if(!wishlist.length){
    el.innerHTML='<div class="empty"><div class="empty-icon">🎯</div><h3>Wishlist empty</h3><p>Browse sets and tap Want on any card to add it here.</p></div>';
    return;
  }
  el.innerHTML = wishlist.map(w=>`
    <div class="coll-list-item">
      <div class="coll-list-img"><img src="${w.image||''}" alt="" onerror="this.style.background='var(--bg3)'"/></div>
      <div class="coll-list-info">
        <div class="coll-list-name">${w.name}</div>
        <div class="coll-list-meta">${[w.set,w.number?'#'+w.number:null].filter(Boolean).join(' · ')}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">
        <div class="coll-list-price">${w.avgPrice?'$'+w.avgPrice.toFixed(2):'—'}</div>
        <button onclick="removeFromWishlist(${w.id})" style="background:var(--red-bg);border:none;border-radius:6px;padding:4px 10px;color:var(--red);font-size:11px;cursor:pointer;">Remove</button>
      </div>
    </div>`).join('');
}
function removeFromCollection(id) {
  const card = collection.find(c=>c.id===id);
  if(!card) return;
  if(!confirm(`Remove ${card.name} from your collection?`)) return;
  collection = collection.filter(c=>c.id!==id);
  saveCollection();
  renderCollection();
  toast('Removed '+card.name);
}

function removeFromCollection(id) {
  const card = collection.find(c=>c.id===id);
  if(!card) return;
  if(!confirm(`Remove ${card.name} from your collection?`)) return;
  collection = collection.filter(c=>c.id!==id);
  saveCollection();
  renderCollection();
  toast('Removed '+card.name);
}

function saveCollection(){
  localStorage.setItem('holodex_collection',JSON.stringify(collection));
  // Track daily value for history graph
  const total = collection.reduce((s,c)=>s+(c.avgPrice||0),0);
  const today = new Date().toISOString().substring(0,10);
  valueHistory = valueHistory.filter(v=>v.date!==today);
  valueHistory.push({date:today,value:total});
  if(valueHistory.length>365) valueHistory=valueHistory.slice(-365);
  localStorage.setItem('holodex_value_history',JSON.stringify(valueHistory));
}
function saveWishlist(){localStorage.setItem('holodex_wishlist',JSON.stringify(wishlist));}

// ── COLLECTION ────────────────────────────────────────────
let currentCollView = 'grid';
function setView(v,el){
  currentCollView=v;
  document.getElementById('vtGrid').classList.toggle('active',v==='grid');
  document.getElementById('vtList').classList.toggle('active',v==='list');
  renderCollection();
}

function setFilter(f,el){
  currentFilter=f;
  document.querySelectorAll('#filterBar .chip').forEach(c=>c.classList.remove('active'));
  el.classList.add('active');
  renderCollection();
}

function renderCollection() {
  const el = document.getElementById('collContent');
  const q = (document.getElementById('collSearch')?.value||'').toLowerCase();
  const total = collection.reduce((s,c)=>s+(c.avgPrice||0),0);
  const sets = new Set(collection.map(c=>c.set_id).filter(Boolean)).size;
  const top = [...collection].sort((a,b)=>(b.avgPrice||0)-(a.avgPrice||0))[0];
  document.getElementById('collValue').textContent='$'+total.toFixed(2);
  document.getElementById('collCards').textContent=collection.length;
  document.getElementById('collSets').textContent=sets;
  document.getElementById('collTop').textContent=top?(top.name.split(' ').slice(0,2).join(' ')):('—');

  // Dynamic pokemon chips
  document.querySelectorAll('#filterBar .dyn').forEach(e=>e.remove());
  const pokemons=[...new Set(collection.map(c=>c.pokemon).filter(Boolean))].sort();
  const bar=document.getElementById('filterBar');
  pokemons.forEach(p=>{
    const chip=document.createElement('div');
    chip.className='chip dyn'+(currentFilter===p?' active':'');
    chip.textContent=p;
    chip.onclick=()=>setFilter(p,chip);
    bar.appendChild(chip);
  });

  let filtered = collection;
  if(q) filtered=filtered.filter(c=>(c.name||'').toLowerCase().includes(q)||(c.set||'').toLowerCase().includes(q)||(c.number||'').toLowerCase().includes(q));
  if(currentFilter==='_poke'){
    const groups={};
    filtered.forEach(c=>{const k=c.pokemon||'Other';(groups[k]||(groups[k]=[])).push(c);});
    if(!filtered.length){el.innerHTML=emptyHtml();return;}
    el.innerHTML=Object.entries(groups).sort((a,b)=>a[0].localeCompare(b[0])).map(([p,cards])=>
      `<div><div class="grp-label">${p}<span>${cards.length} card${cards.length>1?'s':''}</span></div>${currentCollView==='grid'?`<div class="coll-grid">${cards.map(collGridHtml).join('')}</div>`:cards.map(collListHtml).join('')}</div>`
    ).join('');
    return;
  }
  if(currentFilter!=='all') filtered=filtered.filter(c=>c.pokemon===currentFilter);
  if(!filtered.length){el.innerHTML=emptyHtml();return;}
  el.innerHTML=currentCollView==='grid'?`<div class="coll-grid">${filtered.map(collGridHtml).join('')}</div>`:filtered.map(collListHtml).join('');
}

function collGridHtml(card){
  const price=card.avgPrice?'$'+card.avgPrice.toFixed(2):'';
  return `<div class="coll-item" style="position:relative;">
    <div onclick="openCollCard(${card.id})">
      <img src="${card.image||''}" alt="${card.name}" onerror="this.style.background='var(--bg3)'"/>
      <div class="coll-item-foot">
        <div class="coll-item-name">${card.name}</div>
        ${price?`<div class="coll-item-price">${price}</div>`:`<div style="margin-top:2px;"><span class="badge badge-${card.condition.toLowerCase()}" style="font-size:9px;padding:2px 7px;">${card.condition}</span></div>`}
      </div>
    </div>
    <button onclick="event.stopPropagation();removeFromCollection(${card.id})" class="coll-remove-btn" title="Remove">✕</button>
  </div>`;
}
function collListHtml(card){
  const price=card.avgPrice?'$'+card.avgPrice.toFixed(2):'—';
  return `<div class="coll-list-item">
    <div class="coll-list-img" onclick="openCollCard(${card.id})"><img src="${card.image||''}" alt="" onerror="this.style.background='var(--bg3)'"/></div>
    <div class="coll-list-info" onclick="openCollCard(${card.id})">
      <div class="coll-list-name">${card.name}</div>
      <div class="coll-list-meta">${[card.set,card.number?'#'+card.number:null,card.rarity].filter(Boolean).join(' · ')}</div>
      <div style="margin-top:4px;"><span class="badge badge-${card.condition.toLowerCase()}" style="font-size:10px;">${card.condition}</span></div>
    </div>
    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;">
      <div class="coll-list-price">${price}</div>
      <button onclick="removeFromCollection(${card.id})" class="remove-list-btn">✕ Remove</button>
    </div>
  </div>`;
}
function emptyHtml(){return `<div class="empty"><div class="empty-icon">📦</div><h3>No cards yet</h3><p>Scan a card and tap Add to start your collection.</p></div>`;}

async function openCollCard(cardId){
  const card=collection.find(c=>c.id===cardId); if(!card) return;
  if(card.tcgId){openCardModal(card.tcgId);return;}
  try{const q=encodeURIComponent(`name:"${card.name}"${card.set_id?' set.id:'+card.set_id:''}`);const res=await fetch(`https://api.pokemontcg.io/v2/cards?q=${q}&pageSize=1`);const d=await res.json();if(d.data?.[0]){openCardModal(d.data[0].id);return;}}catch(e){}
  toast('Could not load card details');
}

// ── SETS ──────────────────────────────────────────────────
async function loadSets(){
  try{const res=await fetch('https://api.pokemontcg.io/v2/sets?orderBy=-releaseDate&pageSize=250');const d=await res.json();allSets=d.data||[];filteredSets=allSets;renderSetList(allSets);}
  catch(e){document.getElementById('setsList').innerHTML='<p style="color:var(--text3);font-size:13px;padding:12px 0;">Could not load sets.</p>';}
}
function filterSets(q){filteredSets=q?allSets.filter(s=>s.name.toLowerCase().includes(q.toLowerCase())||s.series.toLowerCase().includes(q.toLowerCase())):allSets;renderSetList(filteredSets);}
function renderSetList(sets){
  const el=document.getElementById('setsList'); if(!el) return;
  el.innerHTML=sets.map(s=>{
    const owned=collection.filter(c=>c.set_id===s.id||c.set===s.name).length;
    const total=s.total||s.printedTotal||0;
    const pct=total?Math.round(owned/total*100):0;
    return `<div class="set-item" onclick="openSetDetail('${s.id}')"><img class="set-logo" src="${s.images?.symbol||''}" alt="" onerror="this.style.opacity='0'"/><div style="flex:1;min-width:0;"><div class="set-name">${s.name}</div><div class="set-sub">${s.series} · ${s.releaseDate?.substring(0,4)||''}</div></div><div class="set-prog"><div class="set-frac"><span class="own">${owned}</span>/${total||'?'}</div><div class="prog-bar"><div class="prog-fill" style="width:${pct}%"></div></div></div></div>`;
  }).join('');
}

let _setCards=[],_ownedNums=new Set(),_activeSetId='';
async function openSetDetail(setId){
  const set=allSets.find(s=>s.id===setId); if(!set) return;
  const container=document.getElementById('setsContent');
  container.innerHTML=`<button class="back-btn" onclick="backToSets()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>All Sets</button>
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;"><img src="${set.images?.logo||''}" style="height:36px;object-fit:contain;" alt="" onerror="this.style.display='none'"/></div>
  <div style="font-family:var(--fh);font-size:22px;font-weight:700;">${set.name}</div>
  <div style="font-size:13px;color:var(--text2);margin-bottom:14px;">${set.series} · ${set.releaseDate||''}</div>
  <div class="stat-row"><div class="stat-box"><div class="stat-val" id="sTot">—</div><div class="stat-lbl">Total</div></div><div class="stat-box"><div class="stat-val g" id="sOwn">—</div><div class="stat-lbl">Owned</div></div><div class="stat-box"><div class="stat-val r" id="sMiss">—</div><div class="stat-lbl">Missing</div></div></div>
  <div class="filter-row"><button class="btn btn-ghost btn-sm" id="fAll" onclick="filterSetCards('all')">All</button><button class="btn btn-ghost btn-sm" id="fOwned" onclick="filterSetCards('owned')">Owned</button><button class="btn btn-primary btn-sm" id="fMissing" onclick="filterSetCards('missing')">Missing</button></div>
  <div class="spin-row" id="setLoader"><div class="spin"></div> Loading cards…</div>
  <div class="cards-grid" id="setGrid" style="display:none;"></div>`;
  try{
    let page=1,all=[];
    while(true){const res=await fetch(`https://api.pokemontcg.io/v2/cards?q=set.id:${setId}&orderBy=number&pageSize=250&page=${page}`);const d=await res.json();all=all.concat(d.data||[]);if(all.length>=d.totalCount||!d.data?.length) break;page++;}
    _setCards=all;_ownedNums=new Set(collection.filter(c=>c.set_id===setId||c.set===set.name).map(c=>c.number));_activeSetId=setId;
    const owned=all.filter(c=>_ownedNums.has(c.number)).length;
    document.getElementById('sTot').textContent=all.length;document.getElementById('sOwn').textContent=owned;document.getElementById('sMiss').textContent=all.length-owned;
    document.getElementById('setLoader').style.display='none';filterSetCards('missing');
  }catch(e){document.getElementById('setLoader').innerHTML='<p style="color:var(--text3);font-size:13px;">Could not load cards.</p>';}
}

function filterSetCards(mode){
  ['All','Owned','Missing'].forEach(m=>{const b=document.getElementById('f'+m);if(b)b.className='btn btn-sm '+(mode===m.toLowerCase()?'btn-primary':'btn-ghost');});
  const grid=document.getElementById('setGrid'); if(!grid) return;
  let show=_setCards;
  if(mode==='owned') show=_setCards.filter(c=>_ownedNums.has(c.number));
  if(mode==='missing') show=_setCards.filter(c=>!_ownedNums.has(c.number));
  grid.style.display='grid';
  grid.innerHTML=show.map(c=>{const own=_ownedNums.has(c.number);return `<div class="card-tile${own?'':' missing'}" onclick="openCardModal('${c.id}')"><img src="${c.images?.small||''}" alt="${c.name}" loading="lazy"/>${own?'<div class="owned-pip">✓</div>':''}<div class="card-tile-num">#${c.number}</div></div>`;}).join('');
}
function backToSets(){
  const c=document.getElementById('setsContent');
  c.innerHTML=`<div class="sec-head"><h2>Sets</h2></div><div class="search-wrap" style="margin-bottom:14px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);width:16px;height:16px;stroke-width:2;color:var(--text3);"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg><input type="text" class="field" id="setsSearch" placeholder="Search sets…" oninput="filterSets(this.value)" style="padding-left:36px;"/></div><div id="setsList"></div>`;
  renderSetList(filteredSets.length?filteredSets:allSets);
}

// ── PACK SCANNER ──────────────────────────────────────────
async function handlePackScan(input){
  const file=input.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=async e=>{
    const b64=e.target.result.split(',')[1];
    toast('Identifying pack…');
    try{
      const res=await fetch('/.netlify/functions/identify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({imageBase64:b64,isPack:true})});
      const d=await res.json();
      const raw=d.content?.[0]?.text?.trim()||'';
      const m=raw.match(/\{[\s\S]*\}/);
      if(m){const info=JSON.parse(m[0]);document.getElementById('packSearch').value=info.set||info.name||'';searchPack();}
    }catch(e){toast('Could not identify pack — try searching manually');}
  };
  reader.readAsDataURL(file);
}

async function searchPack(){
  const q=(document.getElementById('packSearch').value||'').trim(); if(!q) return;
  const result=document.getElementById('packResult');
  result.className='pack-result';result.innerHTML='<div class="spin-row"><div class="spin"></div> Loading set data…</div>';result.classList.add('show');
  try{
    const res=await fetch(`https://api.pokemontcg.io/v2/sets?q=name:"${encodeURIComponent(q)}"&pageSize=5`);
    const d=await res.json();
    let set=d.data?.[0];
    if(!set){
      const res2=await fetch(`https://api.pokemontcg.io/v2/sets?pageSize=250`);
      const d2=await res2.json();
      set=(d2.data||[]).find(s=>s.name.toLowerCase().includes(q.toLowerCase()));
    }
    if(!set){result.innerHTML='<p style="padding:16px;color:var(--text3);font-size:13px;">Set not found. Try a different name.</p>';return;}

    // Get chase cards for this set
    const cardsRes=await fetch(`https://api.pokemontcg.io/v2/cards?q=set.id:${set.id}&orderBy=-tcgplayer.prices.holofoil.market&pageSize=20`);
    const cardsD=await cardsRes.json();
    const cards=(cardsD.data||[]).filter(c=>c.tcgplayer?.prices);

    const odds=[
      {label:'Rare+',val:'1:3 packs'},{label:'Holo Rare',val:'1:5'},{label:'Ultra Rare',val:'1:18'},
      {label:'Full Art',val:'1:36'},{label:'Secret Rare',val:'1:72'},{label:'Special IR',val:'1:120'}
    ];

    result.innerHTML=`
      <div class="pack-result-head">
        <img id="packSetLogo" src="${set.images?.logo||''}" alt="" onerror="this.style.display='none'"/>
        <div><div class="pack-name">${set.name}</div><div class="pack-sub">${set.series} · ${set.total||'?'} cards · ${set.releaseDate||''}</div></div>
      </div>
      <div class="odds-grid">${odds.map(o=>`<div class="odds-item"><div class="odds-val">${o.val.split(' ')[0]}</div><div class="odds-label">${o.label}</div></div>`).join('')}</div>
      <div style="padding:14px 16px;">
        <div class="sec-label" style="margin-bottom:10px;">🔥 Chase Cards</div>
        ${cards.length?cards.slice(0,8).map(c=>{
          const price=getCardPrice(c);
          return `<div class="coll-list-item" onclick="openCardModal('${c.id}')"><div class="coll-list-img"><img src="${c.images?.small||''}" alt="" loading="lazy"/></div><div class="coll-list-info"><div class="coll-list-name">${c.name}</div><div class="coll-list-meta">${c.rarity||''} · #${c.number}</div></div><div class="coll-list-price">${price?'$'+price:'—'}</div></div>`;
        }).join(''):'<p style="color:var(--text3);font-size:13px;">Price data unavailable.</p>'}
      </div>`;
  }catch(e){result.innerHTML='<p style="padding:16px;color:var(--red);font-size:13px;">Error: '+e.message+'</p>';}
}

// ── CARD MODAL ────────────────────────────────────────────
async function openCardModal(tcgCardId){
  const modal=document.getElementById('cardModal');modal.classList.add('open');
  document.getElementById('modalImg').src='';document.getElementById('modalName').textContent='Loading…';document.getElementById('modalMeta').textContent='';
  document.getElementById('modalPriceTbody').innerHTML='';document.getElementById('modalSetContent').innerHTML='<div class="spin-row"><div class="spin"></div></div>';document.getElementById('modalInfoRows').innerHTML='';
  if(modalChart){modalChart.destroy();modalChart=null;}
  document.querySelectorAll('.tab-strip .tab').forEach(t=>t.classList.remove('active'));document.querySelectorAll('.tab-pane').forEach(p=>p.classList.remove('active'));
  document.querySelector('.tab-strip .tab').classList.add('active');document.getElementById('tab-prices').classList.add('active');
  try{
    const res=await fetch(`https://api.pokemontcg.io/v2/cards/${tcgCardId}`);
    const d=await res.json();const card=d.data;
    document.getElementById('modalImg').src=card.images?.large||card.images?.small||'';
    document.getElementById('modalName').textContent=card.name;
    document.getElementById('modalMeta').textContent=[card.set?.name,card.number?'#'+card.number:null,card.rarity].filter(Boolean).join('  ·  ');
    const tcp=card.tcgplayer?.prices;
    const condMap={holofoil:'Holo',reverseHolofoil:'Reverse Holo',normal:'Normal','1stEditionHolofoil':'1st Ed Holo',unlimitedHolofoil:'Unlimited Holo'};
    const priceRows=[];
    if(tcp) Object.entries(tcp).forEach(([t,p])=>{if(p?.market) priceRows.push({label:condMap[t]||t,nm:p.market,low:p.low,high:p.high});});
    document.getElementById('modalPriceTbody').innerHTML=priceRows.length
      ?priceRows.map(r=>`<tr><td style="font-weight:600;">${r.label}</td><td class="pv">$${r.nm?.toFixed(2)||'—'}</td><td class="plo">${r.low?'$'+r.low.toFixed(2):'—'}</td><td class="phi">${r.high?'$'+r.high.toFixed(2):'—'}</td></tr>`).join('')
      :'<tr><td colspan="4" class="pm" style="padding:12px 14px;">Prices unavailable</td></tr>';
    const basePx=priceRows[0]?.nm;
    if(basePx&&currentCard) currentCard._prices={NM:{avg:basePx}};
    renderHistoryChart('modalChart',null,'6m',false);
    const tcgUrl=card.tcgplayer?.url||`https://www.tcgplayer.com/search/pokemon/product?q=${encodeURIComponent(card.name)}`;
    document.getElementById('tcgLink').href=tcgUrl;
    document.getElementById('modalInfoRows').innerHTML=[
      card.hp&&['HP',card.hp],card.types?.length&&['Type',card.types.join(', ')],
      card.rarity&&['Rarity',card.rarity],card.artist&&['Illustrator',card.artist],
      card.set?.name&&['Set',card.set.name],card.set?.releaseDate&&['Released',card.set.releaseDate],
      card.number&&['Number',`${card.number} / ${card.set?.printedTotal||'?'}`],
      card.nationalPokedexNumbers?.length&&['Pokédex','#'+card.nationalPokedexNumbers.join(', #')]
    ].filter(Boolean).map(([k,v])=>`<div class="info-row"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');
    loadModalSet(card);
    document.getElementById('modalAddBtn').onclick=()=>{
      const cond=document.getElementById('modalCond').value;
      pushCard({name:card.name,pokemon:card.name.split(' ')[0],set:card.set?.name,set_id:card.set?.id,number:card.number,year:card.set?.releaseDate?.substring(0,4),rarity:card.rarity,hp:card.hp,types:card.types,artist:card.artist,condition:cond,search_query:`Pokemon ${card.name} ${card.number} ${card.set?.name}`,image:card.images?.large||card.images?.small||'',avgPrice:priceRows[0]?.nm||null,tcgId:card.id});
      toast('✓ '+card.name+' added!');closeModal();
    };
    document.getElementById('modalWantBtn').onclick=()=>{
      addToWishlist({name:card.name,pokemon:card.name.split(' ')[0],set:card.set?.name,set_id:card.set?.id,number:card.number,rarity:card.rarity,image:card.images?.large||card.images?.small||'',avgPrice:priceRows[0]?.nm||null,tcgId:card.id});
      closeModal();
    };
  }catch(e){document.getElementById('modalName').textContent='Error loading card';}
}

async function loadModalSet(card){
  const setId=card.set?.id; if(!setId){document.getElementById('modalSetContent').innerHTML='<p style="color:var(--text3);font-size:13px;">Set unavailable.</p>';return;}
  try{
    const res=await fetch(`https://api.pokemontcg.io/v2/cards?q=set.id:${setId}&orderBy=number&pageSize=250`);
    const d=await res.json();const cards=d.data||[];
    const ownedInSet=new Set(collection.filter(c=>c.set_id===setId||c.set===card.set?.name).map(c=>c.number));
    document.getElementById('modalSetContent').innerHTML=`<p style="font-size:12px;color:var(--text3);margin-bottom:10px;">${card.set.name} · ${cards.length} cards · <span style="color:var(--purple2);">${ownedInSet.size} owned</span></p><div class="set-scroll">${cards.map(c=>`<div class="scroll-tile" onclick="openCardModal('${c.id}')"><img src="${c.images?.small||''}" alt="${c.name}" class="${c.id===card.id?'cur':''}" loading="lazy"/><div class="stname">${c.name}</div></div>`).join('')}</div>`;
  }catch(e){document.getElementById('modalSetContent').innerHTML='<p style="color:var(--text3);font-size:13px;">Could not load set.</p>';}
}

function closeModal(){document.getElementById('cardModal').classList.remove('open');}
document.getElementById('cardModal').addEventListener('click',e=>{if(e.target===document.getElementById('cardModal'))closeModal();});
function switchTab(name,btn){document.querySelectorAll('.tab-strip .tab').forEach(t=>t.classList.remove('active'));document.querySelectorAll('.tab-pane').forEach(p=>p.classList.remove('active'));btn.classList.add('active');document.getElementById('tab-'+name).classList.add('active');}

// ── QR MODAL ─────────────────────────────────────────────
async function showQRModal(){
  const wrap=document.getElementById('qrModalWrap');wrap.classList.add('open');
  document.getElementById('qrCanvas').innerHTML='';
  document.getElementById('qrStatus').textContent='Generating session…';
  document.getElementById('qrStatus').className='qr-status';
  try{
    const res=await fetch('/.netlify/functions/upload-session?action=create',{method:'POST'});
    if(!res.ok) throw new Error('Server returned '+res.status+' — check Netlify function is deployed');
    let d;
    try{ d=await res.json(); } catch(e){ throw new Error('Invalid response from server. Make sure the site is deployed on Netlify (not opened locally).'); }
    const sessionId=d.sessionId;
    if(!sessionId) throw new Error('No session ID returned from server');
    const uploadUrl=`${location.origin}/scan-phone.html?s=${sessionId}`;
    document.getElementById('qrCanvas').innerHTML='';
    new QRCode(document.getElementById('qrCanvas'),{text:uploadUrl,width:180,height:180,colorDark:'#000000',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.M});
    document.getElementById('qrStatus').textContent='Waiting for photo from phone…';
    let pollCount = 0;
    qrPollTimer=setInterval(async()=>{
      pollCount++;
      // Stop polling after 5 minutes
      if(pollCount > 150){ clearInterval(qrPollTimer); document.getElementById('qrStatus').textContent='Session expired. Close and try again.'; return; }
      try{
        const pr=await fetch(`/.netlify/functions/upload-session?action=poll&id=${sessionId}`);
        if(!pr.ok){
          document.getElementById('qrStatus').textContent='⚠️ Poll error '+pr.status+' — retrying…';
          return;
        }
        const pd=await pr.json();
        if(pd.status==='waiting'){
          // Still waiting — show a heartbeat so user knows it's alive
          const dots='.'.repeat((pollCount%3)+1);
          document.getElementById('qrStatus').textContent='Waiting for photo'+dots;
        } else if(pd.status==='ready'){
          clearInterval(qrPollTimer);
          document.getElementById('qrStatus').textContent='✓ Photo received — scanning now…';
          document.getElementById('qrStatus').className='qr-status ok';
          imgB64=pd.imageBase64;
          const img=document.getElementById('previewImg');
          img.src='data:image/jpeg;base64,'+imgB64;
          img.style.display='block';
          document.querySelector('.sz-icon').style.display='none';
          document.querySelector('.sz-label').style.display='none';
          document.querySelector('.sz-sub').style.display='none';
          document.getElementById('szChange').style.display='block';
          closeQRModal();
          showPage('scan');
          setTimeout(()=>scanCard(),500);
        }
      }catch(e){
        document.getElementById('qrStatus').textContent='⚠️ Network error — retrying…';
      }
    },2000);
  }catch(e){
    document.getElementById('qrStatus').textContent='Error: '+e.message;
    document.getElementById('qrStatus').className='qr-status err';
  }
}
function closeQRModal(){clearInterval(qrPollTimer);document.getElementById('qrModalWrap').classList.remove('open');}

// ── EXPORT / IMPORT ───────────────────────────────────────
function exportCollection(){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(collection,null,2)],{type:'application/json'}));a.download='holodex_'+new Date().toISOString().substring(0,10)+'.json';a.click();}
function exportCSV(){
  const rows=[['Name','Set','Number','Rarity','Condition','Value','Added']];
  collection.forEach(c=>rows.push([c.name,c.set||'',c.number||'',c.rarity||'',c.condition,c.avgPrice?c.avgPrice.toFixed(2):'',c.added?.substring(0,10)||'']));
  const csv=rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='holodex_'+new Date().toISOString().substring(0,10)+'.csv';a.click();
}
function importCollection(input){const r=new FileReader();r.onload=e=>{try{const d=JSON.parse(e.target.result);if(Array.isArray(d)){collection=d;saveCollection();toast('Collection imported!');renderCollection();}}catch(e){toast('Invalid file');}};r.readAsText(input.files[0]);}
function clearCollection(){if(confirm('Clear your entire HoloDex collection?')){collection=[];saveCollection();renderCollection();toast('Collection cleared.');}}

// ── UTILITY ───────────────────────────────────────────────
function showErr(msg){const el=document.getElementById('errBox');el.textContent=msg;el.classList.add('show');}
function toast(msg){const el=document.getElementById('toast');el.textContent=msg;el.style.opacity='1';setTimeout(()=>el.style.opacity='0',2800);}
