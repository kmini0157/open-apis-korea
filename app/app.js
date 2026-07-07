// 한국 오픈 API 자연어 검색 — 로컬 임베딩(transformers.js) 의미 검색 +
// 무료 LLM(Puter.js) 솔루션 설계 + 라이브 상태 배지 + PWA/즐겨찾기.
// 외부 API 키가 전혀 필요 없습니다.

const MODEL = "Xenova/multilingual-e5-small";
const MODEL_CDN = "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2";
const DB_NAME = "open-apis-ko";
const STORE = "embeddings";
const FAV_KEY = "open-apis-ko:favs";
const RECENT_KEY = "open-apis-ko:recent";
const THEME_KEY = "open-apis-ko:theme";
const PAGE = 30; // 한 번에 렌더링하는 카드 수 ("더 보기"로 추가 로드)

const els = {
  query: document.getElementById("query"),
  searchBtn: document.getElementById("search-btn"),
  results: document.getElementById("results"),
  status: document.getElementById("status"),
  empty: document.getElementById("empty"),
  stats: document.getElementById("stats"),
  category: document.getElementById("f-category"),
  noauth: document.getElementById("f-noauth"),
  https: document.getElementById("f-https"),
  cors: document.getElementById("f-cors"),
  live: document.getElementById("f-live"),
  fav: document.getElementById("f-fav"),
  sort: document.getElementById("f-sort"),
  moreBtn: document.getElementById("more-btn"),
  recent: document.getElementById("recent"),
  themeBtn: document.getElementById("theme-btn"),
  footerCount: document.getElementById("footer-count"),
  shareBtn: document.getElementById("share-btn"),
  aiInput: document.getElementById("ai-input"),
  aiBtn: document.getElementById("ai-btn"),
  aiStatus: document.getElementById("ai-status"),
  aiResult: document.getElementById("ai-result"),
};

let APIS = [];
let STATUS = null; // { results: { url: {ok, code, ms} }, generatedAt }
let FAVS = loadFavs();
let EMB = null; // Float32Array[ N * dim ]
let DIM = 0;
let extractor = null;
let modelState = "idle"; // idle | loading | ready | failed

// ---------- 유틸 ----------
function setStatus(msg, loading = false) {
  els.status.textContent = msg || "";
  els.status.classList.toggle("loading", !!loading && !!msg);
}

function tokenize(s) {
  return (s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter(Boolean);
}

function hashDataset(apis) {
  let h = 2166136261 >>> 0;
  const s = apis.length + "|" + apis.map((a) => a.name).join("");
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(16);
}

function passageText(a) { return `${a.name} · ${a.category} · ${a.description}`; }

function esc(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ---------- 테마 ----------
function applyTheme(pref) {
  // pref: "light" | "dark" | null(시스템 설정 따름)
  const root = document.documentElement;
  if (pref) root.dataset.theme = pref; else delete root.dataset.theme;
  const dark = pref ? pref === "dark" : !matchMedia("(prefers-color-scheme: light)").matches;
  els.themeBtn.textContent = dark ? "🌙" : "☀️";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? "#0f1117" : "#f5f6fa";
}
function toggleTheme() {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === "dark"
    : !matchMedia("(prefers-color-scheme: light)").matches;
  const next = dark ? "light" : "dark";
  try { localStorage.setItem(THEME_KEY, next); } catch {}
  applyTheme(next);
}

// ---------- 최근 검색어 ----------
function loadRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); }
  catch { return []; }
}
function pushRecent(q) {
  if (!q) return;
  const list = [q, ...loadRecent().filter((x) => x !== q)].slice(0, 8);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch {}
  renderRecent();
}
function renderRecent() {
  const list = loadRecent();
  els.recent.classList.toggle("hidden", !list.length);
  if (!list.length) { els.recent.innerHTML = ""; return; }
  els.recent.innerHTML =
    `<span class="recent-label">최근:</span>` +
    list.map((q) => `<button class="chip" type="button" data-q="${esc(q)}">${esc(q)}</button>`).join("") +
    `<button class="chip clear" type="button" data-act="clear-recent" title="최근 검색어 지우기">지우기 ✕</button>`;
}

// ---------- 즐겨찾기 ----------
function loadFavs() {
  try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || "[]")); }
  catch { return new Set(); }
}
function saveFavs() {
  try { localStorage.setItem(FAV_KEY, JSON.stringify([...FAVS])); } catch {}
}
function toggleFav(url) {
  if (FAVS.has(url)) FAVS.delete(url); else FAVS.add(url);
  saveFavs();
}

// ---------- 상태 ----------
function statusOf(url) {
  return STATUS && STATUS.results ? STATUS.results[url] : undefined;
}
function statusBadge(url) {
  const s = statusOf(url);
  if (!s) return "";
  if (s.ok) return `<span class="badge ok" title="응답 ${s.ms}ms">🟢 동작중${s.ms != null ? " " + s.ms + "ms" : ""}</span>`;
  if (s.code >= 400 && s.code < 500) return `<span class="badge auth" title="HTTP ${s.code}">🟡 ${s.code}</span>`;
  return `<span class="badge down" title="HTTP ${s.code}">🔴 응답없음</span>`;
}

// ---------- IndexedDB 임베딩 캐시 ----------
function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(key) {
  try {
    const db = await idbOpen();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      tx.onsuccess = () => resolve(tx.result);
      tx.onerror = () => reject(tx.error);
    });
  } catch { return null; }
}
async function idbSet(key, val) {
  try {
    const db = await idbOpen();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite").objectStore(STORE).put(val, key);
      tx.onsuccess = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
}

// ---------- 모델 / 임베딩 ----------
async function ensureModel() {
  if (modelState === "ready") return true;
  if (modelState === "failed") return false;
  modelState = "loading";
  setStatus("의미 검색 모델을 준비하는 중… (최초 1회, 약 25MB)", true);
  try {
    const { pipeline, env } = await import(/* @vite-ignore */ `${MODEL_CDN}`);
    env.allowLocalModels = false;
    extractor = await pipeline("feature-extraction", MODEL, { quantized: true });
    modelState = "ready";
    return true;
  } catch (e) {
    console.warn("모델 로드 실패, 키워드 검색으로 폴백합니다.", e);
    modelState = "failed";
    setStatus("⚠️ 의미 검색 모델을 불러오지 못해 키워드 검색으로 동작합니다.");
    return false;
  }
}
async function embed(texts) {
  return extractor(texts, { pooling: "mean", normalize: true });
}
async function buildEmbeddings() {
  if (EMB) return;
  const key = `${MODEL}:${hashDataset(APIS)}`;
  const cached = await idbGet(key);
  if (cached && cached.dim && cached.data instanceof ArrayBuffer) {
    EMB = new Float32Array(cached.data); DIM = cached.dim; return;
  }
  setStatus("API 설명을 임베딩하는 중… (최초 1회)", true);
  const passages = APIS.map((a) => "passage: " + passageText(a));
  const BATCH = 64;
  let result = null;
  for (let i = 0; i < passages.length; i += BATCH) {
    const tensor = await embed(passages.slice(i, i + BATCH));
    DIM = tensor.dims[1];
    if (!result) result = new Float32Array(APIS.length * DIM);
    result.set(tensor.data, i * DIM);
    setStatus(`임베딩 생성 중… ${Math.min(i + BATCH, passages.length)}/${passages.length}`, true);
  }
  EMB = result;
  await idbSet(key, { dim: DIM, data: EMB.buffer });
}
async function semanticScores(query) {
  const tensor = await embed(["query: " + query]);
  const q = tensor.data;
  const n = APIS.length;
  const scores = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let dot = 0; const off = i * DIM;
    for (let d = 0; d < DIM; d++) dot += q[d] * EMB[off + d];
    scores[i] = dot;
  }
  return scores;
}
// 키워드 폴백용 동의어 — 데이터 표기와 어긋나는 흔한 검색어를 보정합니다.
// (의미 검색 모델이 준비되기 전이나 로드 실패 시에도 자주 쓰는 질의가 0건이 되지 않도록)
const SYNONYMS = {
  "환율": ["환전", "통화", "exchange"],
  "날씨": ["기상", "일기", "weather"],
  "사진": ["이미지", "그림", "photo", "image"],
  "그림": ["이미지", "사진", "image"],
  "책": ["도서", "book"],
  "영화": ["비디오", "movie"],
  "음악": ["노래", "music"],
  "지도": ["지오코딩", "좌표", "map"],
  "주소": ["지오코딩", "좌표", "geocoding"],
  "문자": ["sms", "메시지"],
  "메일": ["이메일", "email"],
  "자동차": ["차량", "car"],
  "미세먼지": ["대기", "공기", "air"],
  "버스": ["교통", "정류장"],
  "지하철": ["교통", "전철"],
  "주식": ["금융", "증권", "stock"],
  "코인": ["암호화폐", "비트코인"],
  "비트코인": ["암호화폐", "bitcoin"],
  "번역": ["언어", "translat"],
  "기사": ["뉴스", "news"],
  "유머": ["농담", "joke"],
  "농담": ["유머", "joke"],
  "강아지": ["개", "dog"],
  "고양이": ["cat"],
  "채용": ["직업", "구인", "취업"],
  "취업": ["직업", "구인", "채용"],
  "공휴일": ["달력", "휴일", "holiday"],
  "휴일": ["공휴일", "달력", "holiday"],
  "식당": ["음식", "레스토랑"],
  "맛집": ["음식", "식당", "레스토랑"],
  "우주": ["천문", "nasa"],
};

function keywordScores(query) {
  const qt = tokenize(query);
  const n = APIS.length;
  const scores = new Float32Array(n);
  if (!qt.length) return scores;
  // 동의어는 0.8 가중치로 확장 (원래 토큰이 우선)
  const terms = qt.flatMap((t) => [{ t, w: 1 }, ...(SYNONYMS[t] || []).map((s) => ({ t: s, w: 0.8 }))]);
  for (let i = 0; i < n; i++) {
    const a = APIS[i];
    const name = a.name.toLowerCase();
    const hay = (a.name + " " + a.description + " " + a.category).toLowerCase();
    let s = 0;
    for (const { t, w } of terms) {
      if (name.includes(t)) s += 3 * w;
      else if (hay.includes(t)) s += 1 * w;
    }
    scores[i] = s / (qt.length * 3);
  }
  return scores;
}

// 의미 점수 확보(모델 준비+임베딩). 실패 시 null.
async function getSemantic(query) {
  if (!(await ensureModel())) return null;
  try { await buildEmbeddings(); return await semanticScores(query); }
  catch (e) { console.warn(e); return null; }
}

// ---------- 검색 ----------
function passesFilters(a) {
  if (els.noauth.checked && a.needsAuth) return false;
  if (els.https.checked && !a.https) return false;
  if (els.cors.checked && !a.cors) return false;
  if (els.live.checked) { const s = statusOf(a.url); if (!s || !s.ok) return false; }
  if (els.fav.checked && !FAVS.has(a.url)) return false;
  if (els.category.value && a.category !== els.category.value) return false;
  return true;
}

// 정렬 적용 — rel(관련도)은 점수순(탐색 모드에서는 이름순과 동일), name은 이름순, speed는 응답속도순
function applySort(list, hasQuery) {
  const mode = els.sort.value;
  if (mode === "name" || (mode === "rel" && !hasQuery)) {
    list.sort((x, y) => x.a.name.localeCompare(y.a.name, "ko"));
  } else if (mode === "speed") {
    const ms = (r) => { const s = statusOf(r.a.url); return s && s.ok && s.ms != null ? s.ms : Infinity; };
    list.sort((x, y) => ms(x) - ms(y) || y.score - x.score);
  } else {
    list.sort((x, y) => y.score - x.score);
  }
  return list;
}

async function search() {
  const query = els.query.value.trim();
  writeURL();

  // 검색어 없음 → 탐색 모드: 필터를 적용한 전체 카탈로그를 보여줍니다.
  if (!query) {
    const list = applySort(APIS.filter(passesFilters).map((a) => ({ a, score: 0 })), false);
    const label = els.fav.checked ? "⭐ 즐겨찾기"
      : els.category.value ? `${els.category.value} 탐색` : "전체 탐색";
    render(list, false, label);
    return;
  }

  els.empty.classList.add("hidden");
  els.searchBtn.disabled = true;

  const kw = keywordScores(query);
  const sem = await getSemantic(query);
  if (sem) setStatus("");

  // 관련도 기준으로 상위 100개를 추린 뒤, 선택한 정렬(이름/속도)을 표시 순서에 적용
  const ranked = applySort(
    APIS.map((a, i) => {
      const score = sem ? 0.75 * sem[i] + 0.25 * kw[i] : kw[i];
      return { a, i, score };
    })
      .filter((r) => passesFilters(r.a))
      .filter((r) => r.score > (sem ? 0.3 : 0.0001))
      .sort((x, y) => y.score - x.score)
      .slice(0, 100),
    true
  );

  render(ranked, !!sem);
  els.searchBtn.disabled = false;
}

// ---------- 렌더링 ----------
function badge(text, cls = "") { return `<span class="badge ${cls}">${text}</span>`; }

let LAST = { list: [], semantic: false, shown: 0 }; // 현재 결과 (페이지네이션 상태)

function render(ranked, semantic, label) {
  els.stats.textContent =
    `${ranked.length}건 · ${label || (semantic ? "의미 검색" : "키워드 검색")}`;
  LAST = { list: ranked, semantic, shown: 0 };
  els.results.innerHTML = "";
  if (!ranked.length) {
    updateMoreBtn();
    els.empty.classList.remove("hidden");
    els.empty.innerHTML = els.fav.checked
      ? "아직 즐겨찾기가 없습니다. 카드의 ☆를 눌러 추가해 보세요."
      : "조건에 맞는 API가 없습니다. 필터를 풀거나 다른 표현을 시도해 보세요.";
    return;
  }
  els.empty.classList.add("hidden");
  appendMore();
}

// 다음 페이지 분량을 기존 목록 뒤에 덧붙입니다 (열린 코드 스니펫 유지)
function appendMore() {
  const chunk = LAST.list.slice(LAST.shown, LAST.shown + PAGE);
  els.results.insertAdjacentHTML(
    "beforeend",
    chunk.map(({ a, score }) => card(a, score, LAST.semantic)).join("")
  );
  LAST.shown += chunk.length;
  updateMoreBtn();
}

function updateMoreBtn() {
  const left = LAST.list.length - LAST.shown;
  els.moreBtn.classList.toggle("hidden", left <= 0);
  if (left > 0) els.moreBtn.textContent = `더 보기 (${left}개 남음)`;
}

function card(a, score, semantic) {
  const badges = [
    statusBadge(a.url),
    badge(a.category, "cat"),
    a.needsAuth ? badge("인증: " + a.auth, "auth") : badge("인증 불필요", "ok"),
    a.https ? badge("HTTPS", "ok") : badge("HTTP"),
    a.cors ? badge("CORS", "ok") : badge("CORS ?"),
  ].filter(Boolean).join("");

  const id = "s" + Math.abs(hashStr(a.url + a.name));
  const fav = FAVS.has(a.url);
  return `
  <li class="card" data-id="${id}" data-name="${esc(a.name)}">
    <div class="card-head">
      <h3>
        <button class="fav ${fav ? "on" : ""}" data-act="fav" data-url="${esc(a.url)}"
                title="즐겨찾기" aria-label="즐겨찾기">${fav ? "⭐" : "☆"}</button>
        ${esc(a.name)}
      </h3>
      ${semantic ? `<span class="score">유사도 ${(score * 100).toFixed(0)}%</span>` : ""}
    </div>
    <p class="desc">${esc(a.description)}</p>
    <div class="badges">${badges}</div>
    <div class="card-actions">
      <a class="btn" href="${esc(a.url)}" target="_blank" rel="noopener">📄 문서 열기</a>
      <button type="button" data-act="snippet" data-id="${id}">⚡ 호출 코드</button>
    </div>
    <div class="snippet hidden" id="${id}"
         data-url="${esc(a.url)}" data-auth="${a.needsAuth ? "1" : "0"}"></div>
  </li>`;
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

// ---------- 코드 스니펫 ----------
function snippets(url, needsAuth) {
  const authComment = needsAuth ? "  // 이 API는 인증이 필요합니다. API 키/토큰을 헤더 또는 쿼리에 추가하세요.\n" : "";
  const authHeaderJs = needsAuth ? '\n  headers: { "Authorization": "Bearer <API_KEY>" },' : "";
  const authHeaderPy = needsAuth ? '\nheaders = {"Authorization": "Bearer <API_KEY>"}' : "headers = {}";
  const authCurl = needsAuth ? ' \\\n  -H "Authorization: Bearer <API_KEY>"' : "";
  return {
    fetch: `${authComment}const res = await fetch("${url}", {${authHeaderJs}
});
const data = await res.json();
console.log(data);`,
    curl: `curl "${url}"${authCurl}`,
    python: `import requests
${authHeaderPy}
res = requests.get("${url}", headers=headers)
print(res.json())`,
  };
}
function renderSnippet(box) {
  const url = box.dataset.url;
  const needsAuth = box.dataset.auth === "1";
  const snips = snippets(url, needsAuth);
  let lang = "fetch";
  const draw = () => {
    box.innerHTML = `
      <div class="snippet-tabs">
        ${["fetch", "curl", "python"].map((l) =>
          `<button data-lang="${l}" class="${l === lang ? "active" : ""}">${l}</button>`).join("")}
      </div>
      <pre><button class="copy" type="button">복사</button><code>${esc(snips[lang])}</code></pre>`;
    box.querySelectorAll(".snippet-tabs button").forEach((b) =>
      b.addEventListener("click", () => { lang = b.dataset.lang; draw(); }));
    attachCopy(box.querySelector(".copy"), () => snips[lang]);
  };
  draw();
}

// 클립보드 복사 버튼 공통 동작
function attachCopy(btn, getText) {
  if (!btn) return;
  btn.addEventListener("click", () => {
    navigator.clipboard.writeText(getText());
    const prev = btn.textContent;
    btn.textContent = "복사됨!";
    setTimeout(() => { btn.textContent = prev; }, 1200);
  });
}

// 마크다운 코드블록에 복사 버튼 주입
function enhanceCodeBlocks(container) {
  container.querySelectorAll("pre.md-code").forEach((pre) => {
    if (pre.querySelector(".copy")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "copy";
    btn.textContent = "복사";
    attachCopy(btn, () => pre.querySelector("code").textContent);
    pre.prepend(btn);
  });
}

// ---------- AI 솔루션 설계 (Puter.js) ----------
async function topCandidates(desc, k = 8) {
  const kw = keywordScores(desc);
  const sem = await getSemantic(desc);
  return APIS.map((a, i) => ({ a, score: sem ? 0.75 * sem[i] + 0.25 * kw[i] : kw[i] }))
    .sort((x, y) => y.score - x.score)
    .slice(0, k)
    .map((r) => r.a);
}

function buildPrompt(desc, cands) {
  const list = cands.map((a, i) =>
    `${i + 1}. ${a.name} (${a.category}) — ${a.description} | 인증: ${a.needsAuth ? a.auth : "불필요"} | URL: ${a.url}`
  ).join("\n");
  return `당신은 한국 개발자를 돕는 시니어 엔지니어입니다. 아래 "한국 오픈 API 후보" 중에서 사용자가 만들려는 것에 가장 적합한 API를 골라 조합 방법을 설계하세요.

[사용자가 만들려는 것]
${desc}

[한국 오픈 API 후보]
${list}

[지시]
- 후보 중 실제로 필요한 API만 선택하고, 각 API를 어디에 쓰는지 한 줄로 설명하세요.
- 데이터 흐름(아키텍처)을 간단히 단계별로 제시하세요.
- 동작하는 예시 코드(JavaScript fetch 기준)를 코드블록으로 제시하세요. 인증이 필요한 API는 <API_KEY> 자리표시자를 쓰세요.
- 한국어로, 간결하게 답하세요. 후보에 없는 API는 지어내지 마세요.`;
}

// 아주 작은 마크다운 렌더러 (코드블록/제목/목록/굵게/인라인코드/링크)
function renderMarkdown(md) {
  const parts = md.split(/```/);
  let html = "";
  parts.forEach((seg, i) => {
    if (i % 2 === 1) {
      const nl = seg.indexOf("\n");
      const code = nl >= 0 ? seg.slice(nl + 1) : seg;
      html += `<pre class="md-code"><code>${esc(code.replace(/\n$/, ""))}</code></pre>`;
    } else {
      html += renderInlineBlock(seg);
    }
  });
  return html;
}
function renderInlineBlock(text) {
  const lines = text.split("\n");
  let html = "", inList = false;
  const inline = (s) =>
    esc(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  for (let raw of lines) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    const li = line.match(/^\s*[-*]\s+(.*)$/) || line.match(/^\s*\d+\.\s+(.*)$/);
    if (h) { if (inList) { html += "</ul>"; inList = false; } html += `<h4>${inline(h[2])}</h4>`; }
    else if (li) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${inline(li[1])}</li>`; }
    else if (line === "") { if (inList) { html += "</ul>"; inList = false; } }
    else { if (inList) { html += "</ul>"; inList = false; } html += `<p>${inline(line)}</p>`; }
  }
  if (inList) html += "</ul>";
  return html;
}

async function askAI() {
  const desc = els.aiInput.value.trim();
  if (!desc) { els.aiInput.focus(); return; }
  if (typeof puter === "undefined" || !puter.ai) {
    els.aiStatus.textContent = "⚠️ LLM(Puter.js)을 불러오지 못했습니다. 네트워크를 확인하세요.";
    return;
  }
  els.aiBtn.disabled = true;
  els.aiStatus.textContent = "관련 API를 고르는 중…";
  els.aiResult.innerHTML = "";
  try {
    const cands = await topCandidates(desc, 8);
    // 후보 카드 미리보기
    els.aiResult.innerHTML =
      `<div class="ai-cands"><h4>선택된 후보 API <span class="muted">(클릭하면 검색에서 보기)</span></h4><ul>` +
      cands.map((a) =>
        `<li><button class="link-like" data-act="show-api" data-name="${esc(a.name)}">${esc(a.name)}</button>` +
        ` <span class="muted">· ${esc(a.category)}</span>` +
        ` <a class="ext" href="${esc(a.url)}" target="_blank" rel="noopener" title="문서 열기">↗</a></li>`).join("") +
      `</ul></div><div id="ai-answer" class="ai-answer"></div>`;

    els.aiStatus.textContent = "LLM이 솔루션을 설계하는 중…";
    const prompt = buildPrompt(desc, cands);
    const answerEl = document.getElementById("ai-answer");
    answerEl.classList.add("streaming");

    let text = "";
    let streamed = false;
    try {
      // 스트리밍: 토큰이 들어오는 대로 점진적으로 렌더링
      const stream = await puter.ai.chat(prompt, { stream: true });
      if (stream && typeof stream[Symbol.asyncIterator] === "function") {
        streamed = true;
        let last = 0;
        for await (const part of stream) {
          const chunk = typeof part === "string" ? part : (part?.text ?? "");
          if (!chunk) continue;
          text += chunk;
          // 과도한 렌더 방지: 일정 길이마다 갱신
          if (text.length - last > 40) { answerEl.innerHTML = renderMarkdown(text); last = text.length; }
        }
        answerEl.innerHTML = renderMarkdown(text || "(빈 응답)");
        enhanceCodeBlocks(answerEl);
      }
    } catch (streamErr) {
      console.warn("스트리밍 미지원 — 일반 응답으로 폴백", streamErr);
    }

    if (!streamed) {
      const resp = await puter.ai.chat(prompt);
      text = typeof resp === "string" ? resp
        : resp?.message?.content ?? resp?.text ?? (resp?.toString ? resp.toString() : String(resp));
      answerEl.innerHTML = renderMarkdown(text || "(빈 응답)");
      enhanceCodeBlocks(answerEl);
    }
    answerEl.classList.remove("streaming");
    els.aiStatus.textContent = "";
  } catch (e) {
    console.warn(e);
    els.aiStatus.textContent = "⚠️ 솔루션 생성 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.";
  } finally {
    els.aiBtn.disabled = false;
  }
}

// ---------- URL 상태 (공유 가능한 검색) ----------
function readURL() {
  const p = new URLSearchParams(location.search);
  if (p.has("q")) els.query.value = p.get("q");
  if (p.get("cat")) els.category.value = p.get("cat");
  els.noauth.checked = p.get("noauth") === "1";
  els.https.checked = p.get("https") === "1";
  els.cors.checked = p.get("cors") === "1";
  els.live.checked = p.get("live") === "1";
  els.fav.checked = p.get("fav") === "1";
  if (p.get("sort")) els.sort.value = p.get("sort");
}
function writeURL() {
  const p = new URLSearchParams();
  const q = els.query.value.trim();
  if (q) p.set("q", q);
  if (els.category.value) p.set("cat", els.category.value);
  if (els.noauth.checked) p.set("noauth", "1");
  if (els.https.checked) p.set("https", "1");
  if (els.cors.checked) p.set("cors", "1");
  if (els.live.checked) p.set("live", "1");
  if (els.fav.checked) p.set("fav", "1");
  if (els.sort.value !== "rel") p.set("sort", els.sort.value);
  const qs = p.toString();
  history.replaceState(null, "", qs ? "?" + qs : location.pathname);
}

// ---------- 이벤트 ----------
els.results.addEventListener("click", (e) => {
  const favBtn = e.target.closest("button[data-act='fav']");
  if (favBtn) {
    toggleFav(favBtn.dataset.url);
    favBtn.classList.toggle("on");
    favBtn.textContent = favBtn.classList.contains("on") ? "⭐" : "☆";
    if (els.fav.checked) search(); // 즐겨찾기 필터 중이면 갱신
    return;
  }
  const snipBtn = e.target.closest("button[data-act='snippet']");
  if (snipBtn) {
    const box = document.getElementById(snipBtn.dataset.id);
    box.classList.toggle("hidden");
    if (!box.classList.contains("hidden") && !box.innerHTML) renderSnippet(box);
  }
});

// 명시적 검색(버튼/Enter/칩)일 때만 최근 검색어로 저장 — 타이핑 중 부분 입력은 저장하지 않음
function searchExplicit() {
  pushRecent(els.query.value.trim());
  search();
}
els.searchBtn.addEventListener("click", searchExplicit);
els.query.addEventListener("keydown", (e) => { if (e.key === "Enter") { clearTimeout(debounceTimer); searchExplicit(); } });

// 입력 중 디바운스 검색 (2글자 이상부터, 비우면 탐색 모드로 복귀)
let debounceTimer;
els.query.addEventListener("input", () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const q = els.query.value.trim();
    if (q.length >= 2 || !q) search();
  }, 350);
});

[els.noauth, els.https, els.cors, els.live, els.fav, els.category, els.sort].forEach((el) =>
  el.addEventListener("change", search));

// "더 보기" — 다음 페이지 추가
els.moreBtn.addEventListener("click", appendMore);

// 최근 검색어 칩
els.recent.addEventListener("click", (e) => {
  const clear = e.target.closest("button[data-act='clear-recent']");
  if (clear) {
    try { localStorage.removeItem(RECENT_KEY); } catch {}
    renderRecent();
    return;
  }
  const chip = e.target.closest("button.chip[data-q]");
  if (chip) { els.query.value = chip.dataset.q; els.query.focus(); searchExplicit(); }
});

// 테마 전환
els.themeBtn.addEventListener("click", toggleTheme);

// 단축키: / → 검색창 포커스, Esc → 검색어 지우고 탐색 모드
document.addEventListener("keydown", (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
  if (e.key === "/" && !typing) { e.preventDefault(); els.query.focus(); els.query.select(); }
  else if (e.key === "Escape" && document.activeElement === els.query && els.query.value) {
    els.query.value = ""; search();
  }
});

// 예시 칩 → 검색어 채우고 검색
document.querySelectorAll(".chips:not(.recent) .chip").forEach((c) =>
  c.addEventListener("click", () => { els.query.value = c.dataset.q || c.textContent; els.query.focus(); searchExplicit(); }));

// 뒤로/앞으로 가기 → URL 상태 복원
window.addEventListener("popstate", () => { readURL(); search(); });

els.aiBtn.addEventListener("click", askAI);

// 현재 검색 상태를 링크로 복사
els.shareBtn.addEventListener("click", () => {
  writeURL();
  navigator.clipboard.writeText(location.href);
  const prev = els.shareBtn.textContent;
  els.shareBtn.textContent = "✅ 복사됨";
  setTimeout(() => { els.shareBtn.textContent = prev; }, 1400);
});

// AI 후보 API → 검색 결과 카드로 역링크
els.aiResult.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-act='show-api']");
  if (b) showApiInSearch(b.dataset.name);
});

// 탭 전환
function activateTab(which) {
  document.querySelectorAll(".tab").forEach((x) => {
    const on = x.dataset.tab === which;
    x.classList.toggle("active", on);
    x.setAttribute("aria-selected", on ? "true" : "false");
  });
  document.getElementById("tab-search").classList.toggle("hidden", which !== "search");
  document.getElementById("tab-ai").classList.toggle("hidden", which !== "ai");
}
document.querySelectorAll(".tab").forEach((t) =>
  t.addEventListener("click", () => activateTab(t.dataset.tab)));

// 특정 API를 검색 탭에서 찾아 강조 표시
async function showApiInSearch(name) {
  activateTab("search");
  els.query.value = name;
  await search();
  const card =
    [...els.results.querySelectorAll(".card")].find((c) => c.dataset.name === name) ||
    els.results.querySelector(".card");
  if (card) {
    card.classList.add("flash");
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => card.classList.remove("flash"), 1600);
  }
}

// ---------- 초기화 ----------
async function init() {
  applyTheme((() => { try { return localStorage.getItem(THEME_KEY); } catch { return null; } })());
  renderRecent();
  setStatus("API 카탈로그 불러오는 중…", true);
  try {
    APIS = await fetch("./data/apis.json").then((r) => r.json());
  } catch {
    setStatus("❌ 카탈로그를 불러오지 못했습니다.");
    return;
  }
  // 상태 데이터(선택) — 없으면 배지/필터는 조용히 비활성
  try {
    STATUS = await fetch("./data/status.json").then((r) => (r.ok ? r.json() : null));
  } catch { STATUS = null; }
  if (!STATUS) els.live.parentElement.style.display = "none";

  const cats = [...new Set(APIS.map((a) => a.category))].sort((a, b) => a.localeCompare(b, "ko"));
  els.category.insertAdjacentHTML("beforeend",
    cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join(""));

  const okCount = STATUS ? STATUS.ok : null;
  els.footerCount.textContent =
    `API ${APIS.length}개 · 카테고리 ${cats.length}개` + (okCount != null ? ` · 동작중 ${okCount}개` : "");

  setStatus("");

  // URL 상태 복원 (공유 링크) — 카테고리 옵션 생성 후.
  // 검색어가 없으면 탐색 모드로 전체 카탈로그를 보여줍니다.
  readURL();
  search();

  // 모델 백그라운드 사전 로드
  ensureModel().then((ok) => { if (ok) buildEmbeddings().catch(() => {}); });

  // 서비스 워커 등록 (PWA)
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

init();
