// ═══════════════════════════════════════════
//  HoloDex v2  |  BossHog Gaming  |  app.js
// ═══════════════════════════════════════════

// ── STATE ────────────────────────────────────────────────
let collection = JSON.parse(localStorage.getItem('holodex_collection') || '[]');
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
// No client-side key storage needed — ebay-token function handles auth
function getKeys() { return { clientId: '', clientSecret: '' }; }
function saveKeys() {}
function hasKeys() { return true; } // always try — server will handle missing keys gracefully

async function testEbayKeys() {
  const statusEl = document.getElementById('ebayStatus');
  statusEl.style.cssText = 'display:block;font-size:13px;padding:8px 4px;color:var(--text2);';
  statusEl.textContent = 'Testing connection…';
  const { clientId, clientSecret } = getKeys();
  if (!clientId || !clientSecret) {
    statusEl.style.color = 'var(--red)';
    statusEl.textContent = '⚠️ Enter both App ID and Cert ID first.';
    return;
  }
  try {
    const res = await fetch('/.netlify/functions/ebay-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, clientSecret })
    });
    const d = await res.json();
    if (d.access_token) {
      statusEl.style.cssText = 'display:block;font-size:13px;padding:8px 4px;color:var(--green);font-weight:600;';
      statusEl.textContent = '✓ Connected! Real eBay sold prices are now active.';
    } else {
      statusEl.style.cssText = 'display:block;font-size:13px;padding:8px 4px;color:var(--red);';
      statusEl.textContent = '✗ Auth failed: ' + (d.error_description || d.error || 'Check your keys — make sure you are using Production keys');
    }
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
}

// ── HOME ─────────────────────────────────────────────────
function renderHomeStats() {
  const total = collection.reduce((s,c)=>s+(c.avgPrice||0),0);
  const sets = new Set(collection.map(c=>c.set_id).filter(Boolean)).size;
  const top = collection.sort((a,b)=>(b.avgPrice||0)-(a.avgPrice||0))[0];
  document.getElementById('heroValue').textContent = '$'+total.toFixed(2);
  document.getElementById('heroCards').textContent = collection.length;
  document.getElementById('heroSets').textContent = sets;
  document.getElementById('heroTop').textContent = top ? '$'+top.avgPrice?.toFixed(2)||'—' : '—';
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

// ── EBAY TOKEN ────────────────────────────────────────────
// Token handling moved to ebay-search Netlify function — no client-side token needed

async function fetchEbayPrices(query) {
  const token = await getEbayToken();
  if(!token) {
    document.getElementById('priceSrc').textContent = 'eBay token failed — check Netlify env vars';
    return null;
  }

  // Build fallback queries from specific to broad
  const cardName = currentCard?.name || query.split(' ').slice(0,3).join(' ');
  const queries = [
    query,                                          // full optimized query
    `Pokemon ${cardName} holo`,                     // name + holo
    `Pokemon ${cardName}`,                          // just name
    cardName                                        // bare name
  ];





async function fetchCardImage(card) {
  try {
    const setQ = card.set_id?`set.id:${card.set_id} `:'';
    const res = await fetch(`https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(setQ+'name:"'+card.name+'"')}&pageSize=1`);
    const d = await res.json();
    if(d.data?.[0]){currentCard._tcgId=d.data[0].id;return d.data[0].images?.large||d.data[0].images?.small;}
    const res2 = await fetch(`https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent('name:"'+card.name+'"')}&pageSize=1`);
    const d2 = await res2.json();
    if(d2.data?.[0]){currentCard._tcgId=d2.data[0].id;return d2.data[0].images?.large||d2.data[0].images?.small;}
  } catch(e){}
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
  if(prices) document.getElementById('priceSrc').textContent='eBay sold data';
  document.getElementById('resultArea').scrollIntoView({behavior:'smooth',block:'start'});
}

// ── PRICE TABLE ───────────────────────────────────────────
function renderPriceTable(prices) {
  document.getElementById('priceSpinner').style.display='none';
  if(!prices){
    document.getElementById('noKeys').textContent='No eBay sold listings found for this card.';
    document.getElementById('noKeys').style.display='block';
    return;
  }
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
function saveCollection(){localStorage.setItem('holodex_collection',JSON.stringify(collection));}

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
  return `<div class="coll-item" onclick="openCollCard(${card.id})"><img src="${card.image||''}" alt="${card.name}" onerror="this.style.background='var(--bg3)'"/><div class="coll-item-foot"><div class="coll-item-name">${card.name}</div>${price?`<div class="coll-item-price">${price}</div>`:`<div style="margin-top:2px;"><span class="badge badge-${card.condition.toLowerCase()}" style="font-size:9px;padding:2px 7px;">${card.condition}</span></div>`}</div></div>`;
}
function collListHtml(card){
  const price=card.avgPrice?'$'+card.avgPrice.toFixed(2):'—';
  return `<div class="coll-list-item" onclick="openCollCard(${card.id})"><div class="coll-list-img"><img src="${card.image||''}" alt="" onerror="this.style.background='var(--bg3)'"/></div><div class="coll-list-info"><div class="coll-list-name">${card.name}</div><div class="coll-list-meta">${[card.set,card.number?'#'+card.number:null,card.rarity].filter(Boolean).join(' · ')}</div><div style="margin-top:4px;"><span class="badge badge-${card.condition.toLowerCase()}" style="font-size:10px;">${card.condition}</span></div></div><div class="coll-list-price">${price}</div></div>`;
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
function importCollection(input){const r=new FileReader();r.onload=e=>{try{const d=JSON.parse(e.target.result);if(Array.isArray(d)){collection=d;saveCollection();toast('Collection imported!');renderCollection();}}catch(e){toast('Invalid file');}};r.readAsText(input.files[0]);}
function clearCollection(){if(confirm('Clear your entire HoloDex collection?')){collection=[];saveCollection();renderCollection();toast('Collection cleared.');}}

// ── UTILITY ───────────────────────────────────────────────
function showErr(msg){const el=document.getElementById('errBox');el.textContent=msg;el.classList.add('show');}
function toast(msg){const el=document.getElementById('toast');el.textContent=msg;el.style.opacity='1';setTimeout(()=>el.style.opacity='0',2800);}
