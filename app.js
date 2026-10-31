const $ = (selector) => document.querySelector(selector);
const state = { from: null, to: null, busy: false, version: 0 };
let config;
let lastSearch = 0;
let searching = false;
const memoryCache = new Map();
const status = (message = '') => { $('#status').textContent = message; };
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

for (const [key, letter, title, placeholder] of [['from', 'A', '출발지', '예: 서울역, 경복궁'], ['to', 'B', '도착지', '예: 남산서울타워, 부산역']]) {
  const form = document.createElement('form');
  form.className = 'place';
  form.innerHTML = `<label for="${key}"><span class="point">${letter}</span>${title}</label><div class="input-row"><input id="${key}" type="search" placeholder="${placeholder}" autocomplete="off" maxlength="160" required minlength="2"><button class="search-button" type="submit">검색</button></div><p class="selection" id="${key}-selection"></p><ul class="results" id="${key}-results" aria-label="${title} 검색 결과"></ul>`;
  $('#places').append(form);
  form.addEventListener('submit', event => { event.preventDefault(); search(key); });
  $(`#${key}`).addEventListener('input', () => {
    state[key] = null;
    $(`#${key}-selection`).textContent = '';
    $(`#${key}-results`).replaceChildren();
    invalidate();
  });
}

function invalidate() {
  state.version++;
  $('#calculate').disabled = !state.from || !state.to || state.busy;
  $('#result-label').textContent = 'YOUR DISTANCE';
  $('#result').innerHTML = '<h2>두 장소 사이,<br>새로운 여정의 시작.</h2><p>장소를 선택하면 이곳에 총거리가 표시됩니다.</p>';
  status();
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), referrerPolicy: 'strict-origin-when-cross-origin' });
  if (!response.ok) throw new Error(response.status === 429 ? '요청이 많습니다. 잠시 후 다시 시도해 주세요.' : '지도 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.');
  return response.json();
}

async function search(key) {
  const query = $(`#${key}`).value.trim();
  if (query.length < 2) return status('장소 이름을 두 글자 이상 입력해 주세요.');
  if (searching) return status('현재 검색이 끝난 뒤 다시 검색해 주세요.');
  searching = true;
  document.querySelectorAll('.search-button').forEach(button => { button.disabled = true; });
  const list = $(`#${key}-results`);
  list.replaceChildren();
  status('장소를 검색하고 있습니다…');
  try {
    const cacheKey = `sai-place-v1:${query.toLowerCase()}`;
    let cached = memoryCache.get(cacheKey);
    try { cached ||= JSON.parse(localStorage.getItem(cacheKey)); } catch { /* Storage may be unavailable. */ }
    let places;
    if (cached && Date.now() - cached.time < 86400000 && Array.isArray(cached.places)) {
      places = cached.places;
    } else {
      const request = async () => {
        let previous = lastSearch;
        try { previous = Math.max(previous, Number(localStorage.getItem('sai-last-search')) || 0); } catch {}
        await new Promise(resolve => setTimeout(resolve, Math.max(0, 1100 - (Date.now() - previous))));
        lastSearch = Date.now();
        try { localStorage.setItem('sai-last-search', String(lastSearch)); } catch {}
        const url = new URL(config.geocodingUrl);
        url.search = new URLSearchParams({ q: query, format: 'jsonv2', limit: '5', 'accept-language': 'ko,en' });
        return fetchJson(url);
      };
      places = navigator.locks ? await navigator.locks.request('sai-geocoding', request) : await request();
      if (!Array.isArray(places)) throw new Error('검색 결과를 읽을 수 없습니다.');
      places = places.filter(p => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon)) && typeof p.display_name === 'string');
      const entry = { time: Date.now(), places };
      memoryCache.set(cacheKey, entry);
      try { localStorage.setItem(cacheKey, JSON.stringify(entry)); } catch {}
    }
    if ($(`#${key}`).value.trim() !== query) return;
    status(places.length ? '검색 결과에서 원하는 장소를 선택해 주세요.' : '검색 결과가 없습니다. 상세 주소나 다른 이름으로 검색해 주세요.');
    for (const place of places) {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = place.display_name;
      button.addEventListener('click', () => {
        state[key] = { lat: Number(place.lat), lon: Number(place.lon), name: place.display_name };
        $(`#${key}`).value = place.display_name;
        $(`#${key}-selection`).textContent = `✓ ${place.display_name}`;
        list.replaceChildren();
        invalidate();
      });
      li.append(button);
      list.append(li);
    }
  } catch (error) { status(error.name === 'TimeoutError' ? '검색 응답이 늦습니다. 다시 시도해 주세요.' : error.message); }
  finally {
    searching = false;
    document.querySelectorAll('.search-button').forEach(button => { button.disabled = !config; });
  }
}

export function straightDistance(a, b) {
  const radians = n => n * Math.PI / 180;
  const h = Math.sin(radians(b.lat - a.lat) / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(radians(b.lon - a.lon) / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

$('#swap').addEventListener('click', () => {
  [state.from, state.to] = [state.to, state.from];
  const fromValue = $('#from').value;
  $('#from').value = $('#to').value;
  $('#to').value = fromValue;
  for (const key of ['from', 'to']) {
    $(`#${key}-selection`).textContent = state[key] ? `✓ ${state[key].name}` : '';
    $(`#${key}-results`).replaceChildren();
  }
  invalidate();
});
document.querySelectorAll('[name=mode]').forEach(input => input.addEventListener('change', invalidate));
$('#calculate').addEventListener('click', async () => {
  if (!state.from || !state.to || state.busy) return;
  const { from, to, version } = state;
  const mode = $('[name=mode]:checked').value;
  state.busy = true;
  $('#calculate').disabled = true;
  status('거리를 계산하고 있습니다…');
  try {
    let meters;
    let duration;
    if (mode === 'straight') meters = straightDistance(from, to);
    else if (from.lat === to.lat && from.lon === to.lon) { meters = 0; duration = 0; }
    else {
      const url = new URL(`${from.lon},${from.lat};${to.lon},${to.lat}`, config.routingUrl);
      url.search = new URLSearchParams({ overview: 'false', alternatives: 'false', steps: 'false' });
      const data = await fetchJson(url);
      if (data.code !== 'Ok' || !data.routes?.length) throw new Error('자동차 경로를 찾지 못했습니다. 직선 거리로 측정해 보세요.');
      meters = data.routes[0].distance;
      duration = data.routes[0].duration;
      if (!Number.isFinite(meters) || meters < 0) throw new Error('올바른 거리 정보를 받지 못했습니다.');
    }
    if (version !== state.version) return;
    const mapUrl = new URL('https://www.openstreetmap.org/directions');
    mapUrl.search = new URLSearchParams({ engine: 'fossgis_osrm_car', route: `${from.lat},${from.lon};${to.lat},${to.lon}` });
    const value = meters < 1000 ? Math.round(meters).toLocaleString('ko-KR') : (meters / 1000).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
    $('#result-label').textContent = mode === 'straight' ? '총 직선 거리' : '총 자동차 도로 거리';
    $('#result').innerHTML = `<div class="distance">${value}<small>${meters < 1000 ? 'm' : 'km'}</small></div><p>${mode === 'straight' ? '두 좌표 사이의 직선 거리입니다. 지도 링크에서는 자동차 경로를 확인할 수 있어요.' : `예상 주행 시간 약 ${Math.max(0, Math.round(duration / 60)).toLocaleString('ko-KR')}분 · 교통 상황 미반영<br>도로에 연결된 지점을 기준으로 계산합니다.`}</p><a class="map-link" href="${escapeHtml(mapUrl.href)}" target="_blank" rel="noopener noreferrer">지도에서 보기 <span>↗</span></a>`;
    status('거리 계산이 완료되었습니다.');
  } catch (error) {
    if (version === state.version) status(error.name === 'TimeoutError' ? '경로 서비스 응답이 늦습니다. 다시 시도해 주세요.' : error.message);
  } finally {
    state.busy = false;
    $('#calculate').disabled = !state.from || !state.to;
  }
});

document.querySelectorAll('.search-button').forEach(button => { button.disabled = true; });
try {
  config = await fetchJson('./config.json');
  for (const key of ['geocodingUrl', 'routingUrl']) {
    if (new URL(config[key]).protocol !== 'https:') throw new Error('지도 서비스 설정이 올바르지 않습니다.');
  }
  document.querySelectorAll('.search-button').forEach(button => { button.disabled = false; });
} catch { status('지도 서비스 설정을 불러오지 못했습니다. 페이지를 새로고침해 주세요.'); }
