// ═══════════════════════════════════════════
//  HoloDex v3.1  |  BossHog Gaming  |  app.js
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

// ── CLOUD SYNC STATE ─────────────────────────────────────
let cloudSaveCode = localStorage.getItem('holodex_cloud_code') || '';
let cloudSyncTimer = null;
let cloudSyncMuted = false;
let cloudSyncInFlight = false;

// ── VALUE TIMELINE + BATCH STATE ─────────────────────────
let collectionTimelineChart = null;
let currentTimelineRange = '30d';
let batchScanCancelled = false;
let batchScanRunning = false;

const CONDITIONS = ['NM','LP','MP','HP','DMG'];
const EBAY_COND = { NM:'1000', LP:'1500', MP:'2000', HP:'3000', DMG:'4000' };

// ── INIT ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // eBay keys are stored server-side — no client init needed
  renderCollection();
  loadSets();
  loadHome();
  initCloudSync();
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
  if(name==='settings') renderCloudSyncStatus();
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
  if(!collection.length) { canvas.parentElement.style.display='none'; return; }
  if(valueChartInstance){valueChartInstance.destroy();valueChartInstance=null;}

  const points = getValueHistoryPoints('30d');
  if(points.length < 1) { canvas.parentElement.style.display='none'; return; }
  canvas.parentElement.style.display='block';

  const labels = points.map(v=>formatHistoryDate(v.date));
  const values = points.map(v=>v.value);
  valueChartInstance = createValueLineChart(canvas, labels, values, { mini:true });
}

function currentCollectionValue(){
  return +(collection.reduce((s,c)=>s+(Number(c.avgPrice)||0),0).toFixed(2));
}

function normalizeHistoryDate(date){
  if(!date) return new Date().toISOString().substring(0,10);
  if(date instanceof Date) return date.toISOString().substring(0,10);
  return String(date).substring(0,10);
}

function formatHistoryDate(date){
  const d = new Date(normalizeHistoryDate(date) + 'T12:00:00');
  return d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
}

function normalizeValueHistory(){
  const map = new Map();
  for(const row of (Array.isArray(valueHistory) ? valueHistory : [])){
    if(!row) continue;
    const date = normalizeHistoryDate(row.date);
    const value = Number(row.value);
    if(!Number.isFinite(value)) continue;
    map.set(date, { date, value:+value.toFixed(2) });
  }
  valueHistory = Array.from(map.values()).sort((a,b)=>a.date.localeCompare(b.date)).slice(-730);
  localStorage.setItem('holodex_value_history', JSON.stringify(valueHistory));
  return valueHistory;
}

function snapshotCollectionValue(){
  const today = new Date().toISOString().substring(0,10);
  normalizeValueHistory();
  const total = currentCollectionValue();
  const existing = valueHistory.find(v=>v.date===today);
  if(existing) existing.value = total;
  else valueHistory.push({date:today,value:total});
  valueHistory = valueHistory.sort((a,b)=>a.date.localeCompare(b.date)).slice(-730);
  localStorage.setItem('holodex_value_history', JSON.stringify(valueHistory));
  return {date:today,value:total};
}

function getValueHistoryPoints(range='30d'){
  normalizeValueHistory();
  const todayPoint = { date:new Date().toISOString().substring(0,10), value:currentCollectionValue() };
  const map = new Map(valueHistory.map(v=>[v.date, v]));
  map.set(todayPoint.date, todayPoint);
  let points = Array.from(map.values()).sort((a,b)=>a.date.localeCompare(b.date));

  const cutoff = new Date();
  if(range === '7d') cutoff.setDate(cutoff.getDate()-7);
  else if(range === '30d') cutoff.setDate(cutoff.getDate()-30);
  else cutoff.setFullYear(1970);
  if(range !== 'all'){
    const c = cutoff.toISOString().substring(0,10);
    points = points.filter(p=>p.date >= c);
  }

  if(points.length === 1){
    const d = new Date(points[0].date + 'T12:00:00');
    d.setDate(d.getDate()-1);
    points.unshift({date:d.toISOString().substring(0,10), value:points[0].value});
  }
  return points;
}

function createValueLineChart(canvas, labels, values, opts={}){
  return new Chart(canvas,{
    type:'line',
    data:{labels,datasets:[{
      data:values,
      borderColor:'#7c3aed',
      backgroundColor:ctx=>{const g=ctx.chart.ctx.createLinearGradient(0,0,0,opts.mini?90:190);g.addColorStop(0,'rgba(124,58,237,0.28)');g.addColorStop(1,'rgba(124,58,237,0)');return g;},
      fill:true,tension:0.35,pointRadius:opts.mini?0:3,pointHoverRadius:5,borderWidth:2.5
    }]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{backgroundColor:'#1c2230',borderColor:'rgba(255,255,255,0.1)',borderWidth:1,callbacks:{label:ctx=>' $'+Number(ctx.parsed.y).toFixed(2)}}},scales:{x:{display:!opts.mini,ticks:{color:'#484f58',font:{size:10}},grid:{color:'rgba(255,255,255,0.04)'},border:{display:false}},y:{display:!opts.mini,ticks:{color:'#484f58',font:{size:10},callback:v=>'$'+Number(v).toFixed(0)},grid:{color:'rgba(255,255,255,0.05)'},border:{display:false}}}}
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
    const res = await fetch('/.netlify/functions/news?ts=' + Date.now(), { cache: 'no-store' });
    if(!res.ok) throw new Error('news function returned ' + res.status);

    const text = await res.text();
    const parser = new DOMParser();
    const xml = parser.parseFromString(text, 'text/xml');
    const parseError = xml.querySelector('parsererror');
    if(parseError) throw new Error('news XML could not be parsed');

    const channelTitle = xml.querySelector('channel > title')?.textContent?.trim() || 'TCG News';
    const items = Array.from(xml.querySelectorAll('item')).slice(0,6);
    if(!items.length) throw new Error('no news items');

    el.innerHTML = items.map(item=>{
      const title = item.querySelector('title')?.textContent?.trim() || 'Untitled update';
      const link = item.querySelector('link')?.textContent?.trim() || '#';
      const source = item.querySelector('source')?.textContent?.trim() || channelTitle;
      const date = item.querySelector('pubDate')?.textContent?.trim() || '';
      const d = date ? new Date(date).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '';
      const safeLink = link.replace(/'/g, "\'");
      return `<div class="news-item" onclick="openLink('${safeLink}')">
        <div class="news-dot"></div>
        <div><div class="news-title">${title}</div><div class="news-src">${source}${d ? ' · ' + d : ''}</div></div>
      </div>`;
    }).join('');
  } catch(e) {
    console.warn('News load failed:', e.message);
    el.innerHTML = `<div class="news-item">
      <div class="news-dot"></div>
      <div><div class="news-title">TCG news could not load right now</div><div class="news-src">Check Netlify function logs for /.netlify/functions/news</div></div>
    </div>`;
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


// ── BATCH SCAN UPLOAD ─────────────────────────────────────
function triggerBatchUpload(){ document.getElementById('batchFileIn')?.click(); }
function cancelBatchScan(){ batchScanCancelled = true; }

function fileToDataUrl(file){
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Could not read '+file.name));
    reader.readAsDataURL(file);
  });
}

function renderBatchPanel(files){
  const panel = document.getElementById('batchPanel');
  const list = document.getElementById('batchList');
  const progress = document.getElementById('batchProgress');
  if(!panel || !list || !progress) return;
  panel.style.display = 'block';
  progress.style.width = '0%';
  document.getElementById('batchSummary').textContent = `Ready to scan ${files.length} photo${files.length!==1?'s':''}.`;
  list.innerHTML = files.map((f,i)=>`<div class="batch-row" id="batchRow${i}"><span class="batch-dot wait"></span><div class="batch-main"><div class="batch-name">${escapeHtml(f.name)}</div><div class="batch-sub">Waiting…</div></div></div>`).join('');
}

function updateBatchRow(i, state, title, sub=''){
  const row = document.getElementById('batchRow'+i); if(!row) return;
  const dot = row.querySelector('.batch-dot');
  const name = row.querySelector('.batch-name');
  const subEl = row.querySelector('.batch-sub');
  dot.className = 'batch-dot '+state;
  if(title) name.textContent = title;
  subEl.textContent = sub;
}

function escapeHtml(str){
  return String(str||'').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}

async function identifyCardFromBase64(imageBase64){
  const res = await fetch('/.netlify/functions/identify',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({imageBase64})
  });
  const d = await res.json().catch(()=>({}));
  if(d._apiError) throw new Error('API error: ' + d._apiError);
  if(d.error) throw new Error(d.error.message || d.error || 'Identify failed');
  const raw = d.content?.[0]?.text?.trim() || '';
  const m = raw.match(/\{[\s\S]*\}/);
  if(!m) throw new Error('Could not parse card data');
  const parsed = JSON.parse(m[0]);
  parsed._tcgId = null; parsed._prices = null; parsed._history = null;
  return resolveCardWithTcg(parsed);
}

function collectionEntryFromResolvedCard(card, condition='NM', imageUrl=''){
  const prices = buildTcgMarketPrices(card);
  return {
    id: Date.now() + Math.floor(Math.random()*100000),
    added: new Date().toISOString(),
    name: card.name,
    pokemon: card.pokemon,
    set: card.set,
    set_id: card.set_id,
    number: card.number,
    year: card.year,
    rarity: card.rarity,
    hp: card.hp,
    types: card.types,
    artist: card.artist,
    condition,
    search_query: card.search_query,
    image: imageUrl || card._tcgImage || '',
    avgPrice: prices?.[condition]?.avg || null,
    tcgId: card._tcgId || null,
    priceSource: prices ? 'TCGplayer' : null,
    priceVariant: prices?._variantLabel || null
  };
}

async function handleBatchFiles(input){
  const files = Array.from(input.files || []).filter(f=>f.type.startsWith('image/'));
  input.value = '';
  if(!files.length) return;
  if(batchScanRunning){ toast('Batch scan already running'); return; }
  if(files.length > 75 && !confirm(`You selected ${files.length} photos. This may take a while and use API credits. Continue?`)) return;

  batchScanRunning = true;
  batchScanCancelled = false;
  renderBatchPanel(files);

  // Prevent a cloud write after every single card; sync once at the end.
  const prevCloudMuted = cloudSyncMuted;
  cloudSyncMuted = true;

  const cond = document.getElementById('batchCond')?.value || 'NM';
  let added = 0, failed = 0;

  for(let i=0;i<files.length;i++){
    if(batchScanCancelled) break;
    const file = files[i];
    const pct = Math.round((i / files.length) * 100);
    document.getElementById('batchProgress').style.width = pct + '%';
    document.getElementById('batchSummary').textContent = `Scanning ${i+1} of ${files.length}… ${added} added, ${failed} failed.`;
    updateBatchRow(i, 'run', file.name, 'Compressing photo…');

    try{
      const dataUrl = await fileToDataUrl(file);
      const b64 = await compressImage(dataUrl, 1200, 0.84);
      updateBatchRow(i, 'run', file.name, 'Identifying card…');
      const card = await identifyCardFromBase64(b64);
      updateBatchRow(i, 'run', card.name || file.name, 'Matching print and price…');
      const img = card._tcgImage || await fetchCardImage(card) || ('data:image/jpeg;base64,'+b64);
      collection.push(collectionEntryFromResolvedCard(card, cond, img));
      added++;
      updateBatchRow(i, 'ok', card.name || 'Added card', [card.set, card.number?'#'+card.number:null, `$${(collection[collection.length-1].avgPrice||0).toFixed(2)}`].filter(Boolean).join(' · '));
      saveCollection();
      renderCollection();
      renderHomeStats();
    }catch(e){
      failed++;
      updateBatchRow(i, 'err', file.name, e.message || 'Could not identify');
    }
    await sleep(350);
  }

  cloudSyncMuted = prevCloudMuted;
  if(added) saveCollection();

  document.getElementById('batchProgress').style.width = '100%';
  document.getElementById('batchSummary').textContent = batchScanCancelled
    ? `Batch stopped. ${added} added, ${failed} failed.`
    : `Batch complete. ${added} added, ${failed} failed.`;
  batchScanRunning = false;
  if(added) toast(`✓ Batch added ${added} card${added!==1?'s':''}`);
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

function titleHasCardNumber(title, number) {
  const t = String(title || '').toLowerCase();
  const raw = String(number || '').toLowerCase().trim();
  if (!raw) return true;
  const full = raw.match(/\d+\s*\/\s*\d+/)?.[0]?.replace(/\s+/g, '') || '';
  const base = firstCardNumber(raw);
  if (full && t.replace(/\s+/g, '').includes(full)) return true;
  if (!base) return true;
  const unpadded = base.replace(/^0+(?=\d)/, '');
  return new RegExp(`(^|[^0-9])#?0*${unpadded}([^0-9]|$)`).test(t);
}

function titleLooksRelevant(title, cardName) {
  const t = String(title || '').toLowerCase();
  const nameWords = String(cardName || '').toLowerCase().split(/\s+/).filter(w => w.length > 2);

  // Pricing must stay raw-card focused. Graded/slabbed/sealed/lots are what caused
  // cards like Pikachu 42/146 to jump to $170 when the raw TCG market is ~$2.
  const bad = /\b(proxy|custom|digital|code card|online code|empty pack|pack fresh only|jumbo|oversized|sticker|art card|graded|slab|slabbed|psa|cgc|bgs|sgc|tag graded|ace grading|beckett|black label|gem mint|booster|sealed|pack|tin|box)\b/i;
  if (bad.test(t)) return false;

  // Avoid mixed lots/bundles because they inflate/deflate single-card value.
  if (/\b(lot|bundle|collection)\b/i.test(t) && !/\b(single|individual|1 card)\b/i.test(t)) return false;

  if (currentCard?.number && !titleHasCardNumber(t, currentCard.number)) return false;
  if (!nameWords.length) return true;
  return nameWords.every(w => t.includes(w));
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

function getEbayListingDate(item) {
  const raw = item?.itemCreationDate || item?.itemOriginDate || item?.itemEndDate || item?.marketingPrice?.priceTreatmentDate;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatActivityDate(dateLike) {
  const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function buildEbayActivity(items, totalChecked = 0) {
  const dated = items
    .map(item => ({ item, date: getEbayListingDate(item) }))
    .filter(x => x.date)
    .sort((a,b) => b.date - a.date);

  const latest = dated[0] || null;
  return {
    latestListingDate: latest ? latest.date.toISOString() : null,
    latestListingLabel: latest ? formatActivityDate(latest.date) : null,
    latestListingTitle: latest?.item?.title || null,
    matchCount: items.length,
    totalChecked,
    checkedAt: new Date().toISOString(),
    note: 'Active eBay market listings, not completed sold comps'
  };
}

function ensureEbayActivityEl() {
  let el = document.getElementById('ebayActivity');
  if (el) return el;
  const table = document.getElementById('priceTable');
  if (!table || !table.parentNode) return null;
  el = document.createElement('div');
  el.id = 'ebayActivity';
  el.className = 'ebay-activity';
  table.parentNode.insertBefore(el, table.nextSibling);
  return el;
}

function renderEbayActivity(activity) {
  const el = ensureEbayActivityEl();
  if (!el) return;
  if (!activity || !activity.matchCount) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }

  const dateLine = activity.latestListingLabel
    ? `Latest listing seen: <strong>${activity.latestListingLabel}</strong>`
    : 'Latest listing date not provided by eBay';

  el.style.display = 'block';
  el.innerHTML = `
    <div class="ea-top">
      <div>
        <div class="ea-label">eBay Activity</div>
        <div>${dateLine}</div>
        <div class="ea-note">Active listings only — not completed sold comps.</div>
      </div>
      <div class="ea-pill">${activity.matchCount} matches</div>
    </div>`;
}

function fetchWithTimeout(url, options = {}, timeoutMs = 8500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function callEbaySearch(query, limit = 35) {
  const res = await fetchWithTimeout('/.netlify/functions/ebay-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit })
  }, 8500);

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

  // Keep this tight so scan results are not delayed. If these miss, the user can use manual search.
  const queries = [
    query,
    `Pokemon ${cardName} ${cardNumber} ${setName}`.trim(),
    cardNumber ? `Pokemon ${cardName} ${cardNumber}`.trim() : `Pokemon ${cardName}`
  ].filter(Boolean);

  const seen = new Set();
  let lastError = null;

  for (const q of queries) {
    if (seen.has(q.toLowerCase())) continue;
    seen.add(q.toLowerCase());
    try {
      const data = await callEbaySearch(q, 35);
      const rawItems = data.itemSummaries || [];
      const items = rawItems.filter(item => titleLooksRelevant(item.title, cardName));
      const prices = aggregatePrices(items);
      if (prices) {
        prices._activity = buildEbayActivity(items, rawItems.length);
        const newest = prices._activity.latestListingLabel ? ` · newest ${prices._activity.latestListingLabel}` : '';
        if(srcEl) srcEl.textContent = `eBay market listings · ${items.length} matches${newest}`;
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


function selectTcgPriceVariant(card) {
  const prices = card?._tcgPrices || null;
  if (!prices) return null;

  const text = cleanText(`${card?.rarity || ''} ${card?.condition_notes || ''} ${card?.visible_text || ''}`);
  const preferReverse = /reverse/.test(text);
  const preferHolo = /holo|foil|shiny/.test(text) && !preferReverse;

  const order = preferReverse
    ? ['reverseHolofoil', 'holofoil', 'normal', '1stEditionHolofoil']
    : preferHolo
      ? ['holofoil', 'normal', 'reverseHolofoil', '1stEditionHolofoil']
      : ['normal', 'holofoil', 'reverseHolofoil', '1stEditionHolofoil'];

  for (const key of order) {
    const v = prices[key];
    if (v && (parseMoney(v.market) || parseMoney(v.mid) || parseMoney(v.low))) return { key, data: v };
  }
  return null;
}

function prettyTcgVariant(key) {
  return ({ normal: 'normal', holofoil: 'holofoil', reverseHolofoil: 'reverse holo', '1stEditionHolofoil': '1st edition holo' })[key] || key;
}

function buildTcgMarketPrices(card) {
  const selected = selectTcgPriceVariant(card);
  if (!selected) return null;

  const market = parseMoney(selected.data.market) || parseMoney(selected.data.mid) || parseMoney(selected.data.low);
  if (!market) return null;

  const low = parseMoney(selected.data.low) || market;
  const high = parseMoney(selected.data.high) || market;
  const multipliers = { NM: 1, LP: 0.85, MP: 0.70, HP: 0.55, DMG: 0.40 };
  const out = {
    _source: 'tcgplayer',
    _variant: selected.key,
    _variantLabel: prettyTcgVariant(selected.key),
    _tcgUrl: card?._tcgUrl || null,
    _note: 'TCGplayer market is used as the primary raw-card value. Non-NM rows are estimates from the NM market.'
  };

  for (const cond of CONDITIONS) {
    const mult = multipliers[cond] || 1;
    out[cond] = {
      avg: +(market * mult).toFixed(2),
      low: +(low * mult).toFixed(2),
      high: +(high * mult).toFixed(2),
      count: cond === 'NM' ? 'TCG' : 'Est.',
      estimated: cond !== 'NM'
    };
  }
  return out;
}

function renderTcgNote(prices) {
  const el = ensureEbayActivityEl();
  if (!el) return;
  if (!prices || prices._source !== 'tcgplayer') return;
  el.style.display = 'block';
  el.innerHTML = `
    <div class="ea-top">
      <div>
        <div class="ea-label">Pricing Source</div>
        <div>TCGplayer market: <strong>${prices._variantLabel || 'market'}</strong></div>
        <div class="ea-note">Raw-card market used first. Condition rows below NM are estimates, not sold comps.</div>
      </div>
      <div class="ea-pill">Primary</div>
    </div>`;
}

function showScanResultsLoading() {
  document.getElementById('resultArea').classList.add('show');
  document.getElementById('resultName').textContent = currentCard?.name || 'Unknown';
  document.getElementById('resultMeta').textContent = [currentCard?.set, currentCard?.number ? '#' + currentCard.number : null, currentCard?.year].filter(Boolean).join('  ·  ');

  const rBadge = document.getElementById('rarityBadge');
  if (currentCard?.rarity) { rBadge.textContent = currentCard.rarity; rBadge.style.display = 'inline-flex'; }
  else rBadge.style.display = 'none';

  const cond = currentCard?.condition || 'NM';
  const cBadge = document.getElementById('condBadge');
  cBadge.textContent = cond + (currentCard?.condition_notes ? '  —  ' + currentCard.condition_notes : '');
  cBadge.className = 'badge badge-' + cond.toLowerCase();

  document.getElementById('priceSpinner').style.display = 'flex';
  document.getElementById('priceTable').style.display = 'none';
  document.getElementById('noKeys').style.display = 'none';
  const srcEl = document.getElementById('priceSrc');
  if (srcEl) srcEl.textContent = 'Loading eBay market listings…';
  renderEbayActivity(null);
  renderMockChart('priceChart');
  document.getElementById('resultArea').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function loadEbayForCurrentCard(card) {
  if (!card) return;
  const srcEl = document.getElementById('priceSrc');

  // Use the verified PokémonTCG.io / TCGplayer market as the primary card value.
  // eBay Browse is active listings only, so it is useful for activity, but it can be
  // badly inflated by PSA/CGC slabs and seller outliers.
  const tcgPrices = buildTcgMarketPrices(card);
  if (tcgPrices) {
    card._prices = tcgPrices;
    card._history = null;
    if (currentCard === card) {
      currentCard._prices = tcgPrices;
      currentCard._history = null;
    }
    renderPriceTable(tcgPrices);
    renderHistoryChart('priceChart', null, '3m', true);
    if (srcEl) srcEl.textContent = `TCGplayer market · ${tcgPrices._variantLabel || 'market'}`;
  }

  if (!hasKeys()) {
    if (!tcgPrices) {
      document.getElementById('priceSpinner').style.display = 'none';
      document.getElementById('noKeys').textContent = 'Market pricing is not configured on the server.';
      document.getElementById('noKeys').style.display = 'block';
    }
    return;
  }

  try {
    const [ebayPrices, history] = await Promise.all([
      fetchEbayPrices(card.search_query),
      fetchPriceHistory(card.search_query)
    ]);

    // Ignore stale results if another scan started while eBay was loading.
    if (currentCard !== card) return;

    if (tcgPrices) {
      // Keep TCGplayer as the displayed value. Only attach eBay activity metadata.
      if (ebayPrices?._activity) {
        tcgPrices._activity = ebayPrices._activity;
        renderPriceTable(tcgPrices);
      } else {
        renderTcgNote(tcgPrices);
      }
      if (srcEl) {
        const matches = ebayPrices?._activity?.matchCount;
        srcEl.textContent = `TCGplayer market · ${tcgPrices._variantLabel || 'market'}${matches ? ` · eBay activity ${matches} matches` : ''}`;
      }
      return;
    }

    // Fallback only: if TCGplayer has no market price, show filtered active eBay listings.
    card._prices = ebayPrices;
    card._history = history;
    currentCard._prices = ebayPrices;
    currentCard._history = history;
    renderPriceTable(ebayPrices);
    renderHistoryChart('priceChart', history, '3m', true);
    if (ebayPrices && srcEl && !srcEl.textContent) srcEl.textContent = 'Filtered eBay market listings';
  } catch (e) {
    if (currentCard !== card) return;
    console.warn('eBay background lookup failed:', e.message);
    if (!tcgPrices) {
      document.getElementById('priceSpinner').style.display = 'none';
      if (srcEl) srcEl.textContent = 'eBay lookup timed out — try again or use manual search';
      renderPriceTable(null);
    } else {
      renderTcgNote(tcgPrices);
    }
  }
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
    _tcgPrices: apiCard.tcgplayer?.prices || scan._tcgPrices || null,
    _tcgUrl: apiCard.tcgplayer?.url || scan._tcgUrl || null,
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
    if(scanAborted) return;

    // Do not make the full-screen scanner wait on eBay. Show the card first, then load pricing in the result panel.
    setScanStatus('Starting market lookup…'); setProgress(92);
    await sleep(250);
    setStep(3,'done'); setProgress(100); setScanStatus('Complete!');
    await sleep(300);
    hideScanOverlay();

    showScanResultsLoading();
    const cardImgUrl = await imgPromise;
    if(cardImgUrl) document.getElementById('resultImg').src=cardImgUrl;

    loadEbayForCurrentCard(currentCard);
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
    showScanResultsLoading();
    loadEbayForCurrentCard(card);
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
    renderEbayActivity(null);
    document.getElementById('priceTable').style.display='none';
    document.getElementById('noKeys').textContent='No market pricing found for this card yet. Try manual search with the exact card number/set.';
    document.getElementById('noKeys').style.display='block';
    return;
  }
  document.getElementById('noKeys').style.display='none';
  document.getElementById('priceTable').style.display='table';
  if (prices._activity) renderEbayActivity(prices._activity);
  else if (prices._source === 'tcgplayer') renderTcgNote(prices);
  else renderEbayActivity(null);
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
  snapshotCollectionValue();
  markLocalSave();
  scheduleCloudSync();
  renderCollectionTimeline();
}
function saveWishlist(){
  localStorage.setItem('holodex_wishlist',JSON.stringify(wishlist));
  markLocalSave();
  scheduleCloudSync();
}

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
  renderCollectionTimeline();

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


// ── COLLECTION VALUE TIMELINE ─────────────────────────────
function switchCollectionTimeline(range, btn){
  currentTimelineRange = range;
  document.querySelectorAll('#collectionTimelineTabs .chart-tab').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  renderCollectionTimeline();
}

function renderCollectionTimeline(){
  const canvas = document.getElementById('collectionValueChart');
  if(!canvas) return;
  const total = currentCollectionValue();
  const points = getValueHistoryPoints(currentTimelineRange);
  const labels = points.map(p=>formatHistoryDate(p.date));
  const values = points.map(p=>p.value);

  if(collectionTimelineChart){ collectionTimelineChart.destroy(); collectionTimelineChart = null; }
  collectionTimelineChart = createValueLineChart(canvas, labels, values, { mini:false });

  const first = values[0] ?? total;
  const change = +(total - first).toFixed(2);
  const pct = first ? ((change / first) * 100) : 0;
  const high = values.length ? Math.max(...values) : total;
  const low = values.length ? Math.min(...values) : total;
  const lastSnap = valueHistory.length ? valueHistory[valueHistory.length-1].date : new Date().toISOString().substring(0,10);

  setText('timelineToday', '$'+total.toFixed(2));
  setText('timelineChange', `${change>=0?'+':''}$${change.toFixed(2)} ${first?`(${pct>=0?'+':''}${pct.toFixed(1)}%)`:''}`);
  setText('timelineHigh', '$'+high.toFixed(2));
  setText('timelineLow', '$'+low.toFixed(2));
  setText('timelineLastSnap', 'Last snapshot: '+formatHistoryDate(lastSnap));

  const changeEl = document.getElementById('timelineChange');
  if(changeEl) changeEl.style.color = change >= 0 ? 'var(--green)' : 'var(--red)';
}

function setText(id, txt){ const el=document.getElementById(id); if(el) el.textContent=txt; }

async function refreshCollectionValues(){
  if(!collection.length){ toast('No cards to refresh yet'); return; }
  const status = document.getElementById('refreshValueStatus');
  const btn = document.getElementById('refreshValuesBtn');
  if(btn) btn.disabled = true;
  if(status) status.textContent = 'Refreshing TCGplayer market values…';

  let updated = 0, skipped = 0;
  for(let i=0;i<collection.length;i++){
    const c = collection[i];
    if(status) status.textContent = `Refreshing ${i+1} of ${collection.length}: ${c.name || 'card'}…`;
    try{
      let apiCard = null;
      if(c.tcgId){
        const res = await fetch(`https://api.pokemontcg.io/v2/cards/${encodeURIComponent(c.tcgId)}`);
        const d = await res.json();
        apiCard = d.data || null;
      }
      if(!apiCard){
        const q = [`name:"${c.name}"`, c.set_id ? `set.id:${c.set_id}` : '', c.number ? `number:${firstCardNumber(c.number)}` : ''].filter(Boolean).join(' ');
        const res = await fetch(`https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q)}&pageSize=1`);
        const d = await res.json();
        apiCard = d.data?.[0] || null;
      }
      if(!apiCard){ skipped++; continue; }
      const resolved = tcgToHoloDexCard(apiCard, c);
      const prices = buildTcgMarketPrices(resolved);
      const cond = c.condition || 'NM';
      if(prices?.[cond]?.avg){
        c.avgPrice = prices[cond].avg;
        c.priceSource = 'TCGplayer';
        c.priceVariant = prices._variantLabel || c.priceVariant || null;
        c.tcgId = resolved._tcgId || c.tcgId || null;
        c.image = c.image || resolved._tcgImage || '';
        updated++;
      } else skipped++;
    }catch(e){
      console.warn('Value refresh failed:', c.name, e.message);
      skipped++;
    }
    await sleep(120);
  }

  saveCollection();
  renderCollection();
  renderHomeStats();
  if(status) status.textContent = `Done. Updated ${updated}, skipped ${skipped}.`;
  if(btn) btn.disabled = false;
  toast(`Values refreshed · ${updated} updated`);
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


// ── CLOUD SYNC ────────────────────────────────────────────
function initCloudSync(){
  renderCloudSyncStatus();
  if(cloudSaveCode){
    setTimeout(()=>cloudPull({silent:true, auto:true}), 900);
  }
}

function normalizeCloudCode(code){
  return String(code||'').trim().toUpperCase().replace(/\s+/g,'').replace(/[^A-Z0-9-]/g,'');
}

function markLocalSave(){
  if(cloudSyncMuted) return localStorage.getItem('holodex_last_save') || '';
  const now = new Date().toISOString();
  localStorage.setItem('holodex_last_save', now);
  renderCloudSyncStatus();
  return now;
}

function buildCloudPayload(){
  return {
    app: 'HoloDex',
    version: 1,
    updatedAt: new Date().toISOString(),
    collection,
    wishlist,
    valueHistory
  };
}

function renderCloudSyncStatus(message){
  const box = document.getElementById('cloudSyncBox');
  const status = document.getElementById('cloudStatus');
  const copyRow = document.getElementById('cloudCopyRow');
  const codeText = document.getElementById('cloudCodeText');
  if(!box || !status) return;

  if(cloudSaveCode){
    box.innerHTML = `<strong>Cloud Sync is connected.</strong><br/>Your collection saves to your private cloud save code. Keep this code safe — anyone with the code can load that collection.`;
    status.style.display = 'block';
    const last = localStorage.getItem('holodex_cloud_updated') || localStorage.getItem('holodex_last_save') || '';
    const lastTxt = last ? new Date(last).toLocaleString([], {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'}) : 'Not synced yet';
    status.style.cssText = 'display:block;font-size:13px;padding:8px 4px;color:var(--green);';
    status.textContent = message || `✓ Connected · Last sync: ${lastTxt}`;
    if(copyRow) copyRow.style.display = 'flex';
    if(codeText) codeText.textContent = cloudSaveCode;
  } else {
    box.innerHTML = `<strong>Cloud Sync is off.</strong><br/>Create a free cloud save code so cards auto-save online and can be opened on another device without importing files.`;
    status.style.display = message ? 'block' : 'none';
    if(message){
      status.style.cssText = 'display:block;font-size:13px;padding:8px 4px;color:var(--text2);';
      status.textContent = message;
    }
    if(copyRow) copyRow.style.display = 'none';
    if(codeText) codeText.textContent = '—';
  }
}

function setCloudStatus(text, kind='info'){
  const status = document.getElementById('cloudStatus');
  if(!status) return;
  const color = kind === 'ok' ? 'var(--green)' : kind === 'err' ? 'var(--red)' : 'var(--text2)';
  status.style.cssText = `display:block;font-size:13px;padding:8px 4px;color:${color};`;
  status.textContent = text;
}

function scheduleCloudSync(){
  if(cloudSyncMuted || !cloudSaveCode) return;
  clearTimeout(cloudSyncTimer);
  cloudSyncTimer = setTimeout(()=>cloudPush({silent:true}), 1400);
}

async function cloudRequest(payload){
  const res = await fetch('/.netlify/functions/cloud-save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(()=>({}));
  if(!res.ok || data.error) throw new Error(data.error || `Cloud sync failed (${res.status})`);
  return data;
}

async function createCloudSave(){
  if(cloudSaveCode && !confirm('You already have a cloud save code connected. Create a new one anyway?')) return;
  try{
    setCloudStatus('Creating cloud save…');
    const data = await cloudRequest({ action:'create', data: buildCloudPayload() });
    cloudSaveCode = data.code;
    localStorage.setItem('holodex_cloud_code', cloudSaveCode);
    localStorage.setItem('holodex_cloud_updated', data.updatedAt || new Date().toISOString());
    renderCloudSyncStatus('✓ Cloud save created and synced.');
    copyCloudCode(false);
    alert('Your HoloDex Cloud Save Code:\n\n' + cloudSaveCode + '\n\nSave this code somewhere safe. You can use it to open this collection on another device.');
  }catch(e){
    setCloudStatus('✗ '+e.message, 'err');
  }
}

async function connectCloudSave(){
  const entered = prompt('Enter your HoloDex Cloud Save Code:');
  const code = normalizeCloudCode(entered);
  if(!code) return;
  try{
    setCloudStatus('Checking cloud save…');
    const res = await cloudRequest({ action:'load', code });
    const remote = res.data || {};
    const localCount = collection.length + wishlist.length;
    const remoteCount = (remote.collection?.length || 0) + (remote.wishlist?.length || 0);
    let merge = false;
    if(localCount && remoteCount){
      merge = confirm(`This device has ${collection.length} collection cards and the cloud save has ${remote.collection?.length || 0}.\n\nPress OK to MERGE them.\nPress Cancel to replace this device with the cloud save.`);
    }
    cloudSaveCode = code;
    localStorage.setItem('holodex_cloud_code', cloudSaveCode);
    applyCloudData(remote, { merge });
    localStorage.setItem('holodex_cloud_updated', res.updatedAt || remote.updatedAt || new Date().toISOString());
    renderCloudSyncStatus('✓ Connected to cloud save.');
    if(merge) await cloudPush({silent:true});
    toast('Cloud save connected');
  }catch(e){
    setCloudStatus('✗ '+e.message, 'err');
  }
}

async function cloudPull(opts={}){
  if(!cloudSaveCode){ if(!opts.silent) toast('Create or connect a cloud save first.'); return; }
  if(cloudSyncInFlight) return;
  try{
    cloudSyncInFlight = true;
    if(!opts.silent) setCloudStatus('Loading from cloud…');
    const res = await cloudRequest({ action:'load', code: cloudSaveCode });
    const remote = res.data || {};
    const remoteUpdated = new Date(res.updatedAt || remote.updatedAt || 0).getTime();
    const localUpdated = new Date(localStorage.getItem('holodex_last_save') || 0).getTime();

    // On startup, avoid overwriting newer local work. Push local if it is newer.
    if(opts.auto && localUpdated && localUpdated > remoteUpdated){
      await cloudPush({silent:true});
      return;
    }

    applyCloudData(remote, { merge:false });
    localStorage.setItem('holodex_cloud_updated', res.updatedAt || remote.updatedAt || new Date().toISOString());
    renderCloudSyncStatus('✓ Synced from cloud.');
    if(!opts.silent) toast('Synced from cloud');
  }catch(e){
    if(!opts.silent) setCloudStatus('✗ '+e.message, 'err');
  }finally{
    cloudSyncInFlight = false;
  }
}

async function cloudPush(opts={}){
  if(!cloudSaveCode){ if(!opts.silent) toast('Create or connect a cloud save first.'); return; }
  if(cloudSyncInFlight && !opts.force) return;
  try{
    cloudSyncInFlight = true;
    if(!opts.silent) setCloudStatus('Saving to cloud…');
    const data = await cloudRequest({ action:'save', code: cloudSaveCode, data: buildCloudPayload() });
    localStorage.setItem('holodex_cloud_updated', data.updatedAt || new Date().toISOString());
    renderCloudSyncStatus('✓ Synced to cloud.');
    if(!opts.silent) toast('Saved to cloud');
  }catch(e){
    if(!opts.silent) setCloudStatus('✗ '+e.message, 'err');
  }finally{
    cloudSyncInFlight = false;
  }
}

function applyCloudData(data, opts={}){
  cloudSyncMuted = true;
  try{
    const remoteCollection = Array.isArray(data.collection) ? data.collection : [];
    const remoteWishlist = Array.isArray(data.wishlist) ? data.wishlist : [];
    const remoteHistory = Array.isArray(data.valueHistory) ? data.valueHistory : [];

    if(opts.merge){
      collection = mergeById(collection, remoteCollection);
      wishlist = mergeById(wishlist, remoteWishlist);
      valueHistory = mergeHistory(valueHistory, remoteHistory);
    } else {
      collection = remoteCollection;
      wishlist = remoteWishlist;
      valueHistory = remoteHistory;
    }

    localStorage.setItem('holodex_collection', JSON.stringify(collection));
    localStorage.setItem('holodex_wishlist', JSON.stringify(wishlist));
    localStorage.setItem('holodex_value_history', JSON.stringify(valueHistory));
    localStorage.setItem('holodex_last_save', data.updatedAt || new Date().toISOString());
    renderCollection();
    renderWishlist();
    renderHomeStats();
    renderCollectionTimeline();
  } finally {
    cloudSyncMuted = false;
  }
}

function mergeById(a,b){
  const map = new Map();
  [...(b||[]), ...(a||[])].forEach(item=>{
    if(!item) return;
    const key = String(item.id || `${item.name||''}|${item.set_id||item.set||''}|${item.number||''}|${item.condition||''}|${item.added||''}`);
    map.set(key, item);
  });
  return Array.from(map.values());
}

function mergeHistory(a,b){
  const map = new Map();
  [...(b||[]), ...(a||[])].forEach(v=>{ if(v?.date) map.set(v.date, v); });
  return Array.from(map.values()).sort((x,y)=>String(x.date).localeCompare(String(y.date))).slice(-365);
}

function copyCloudCode(showToast=true){
  if(!cloudSaveCode) return;
  if(navigator.clipboard?.writeText){
    navigator.clipboard.writeText(cloudSaveCode).then(()=>{ if(showToast) toast('Cloud code copied'); }).catch(()=>{});
  } else if(showToast){
    alert(cloudSaveCode);
  }
}

function disconnectCloudSave(){
  if(!cloudSaveCode) return;
  if(!confirm('Disconnect this device from Cloud Sync? Your cloud save will not be deleted.')) return;
  cloudSaveCode = '';
  localStorage.removeItem('holodex_cloud_code');
  localStorage.removeItem('holodex_cloud_updated');
  renderCloudSyncStatus('Cloud Sync disconnected on this device.');
  toast('Cloud Sync disconnected');
}

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
