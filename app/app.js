// 한국 오픈 API 자연어 검색 — 로컬 임베딩(transformers.js) + 키워드 하이브리드 검색.
// 외부 API 키가 전혀 필요 없고, 의미 검색은 브라우저에서만 수행됩니다.

const MODEL = "Xenova/multilingual-e5-small";
const MODEL_CDN = "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2";
const DB_NAME = "open-apis-ko";
const STORE = "embeddings";

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
  footerCount: document.getElementById("footer-count"),
};

let APIS = [];
let EMB = null; // Float32Array[ N * dim ]
let DIM = 0;
let extractor = null; // transformers.js pipeline
let modelState = "idle"; // idle | loading | ready | failed

// ---------- 유틸 ----------
function setStatus(msg, loading = false) {
  els.status.textContent = msg || "";
  els.status.classList.toggle("loading", !!loading && !!msg);
}

function tokenize(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter(Boolean);
}

// 데이터셋 변경을 감지하기 위한 가벼운 해시
function hashDataset(apis) {
  let h = 2166136261 >>> 0;
  const s = apis.length + "|" + apis.map((a) => a.name).join("");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16);
}

function passageText(a) {
  return `${a.name} · ${a.category} · ${a.description}`;
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
  } catch {
    return null;
  }
}

async function idbSet(key, val) {
  try {
    const db = await idbOpen();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite").objectStore(STORE).put(val, key);
      tx.onsuccess = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* 캐시 실패는 무시 — 매번 재계산 */
  }
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
  const out = await extractor(texts, { pooling: "mean", normalize: true });
  return out; // Tensor: dims [n, dim]
}

async function buildEmbeddings() {
  if (EMB) return;
  const key = `${MODEL}:${hashDataset(APIS)}`;
  const cached = await idbGet(key);
  if (cached && cached.dim && cached.data instanceof ArrayBuffer) {
    EMB = new Float32Array(cached.data);
    DIM = cached.dim;
    return;
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
  const q = tensor.data; // Float32Array(DIM), 정규화됨
  const n = APIS.length;
  const scores = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let dot = 0;
    const off = i * DIM;
    for (let d = 0; d < DIM; d++) dot += q[d] * EMB[off + d];
    scores[i] = dot; // 코사인 유사도 (정규화 벡터의 내적)
  }
  return scores;
}

// ---------- 키워드 점수 (폴백 & 하이브리드 보강) ----------
function keywordScores(query) {
  const qt = tokenize(query);
  const n = APIS.length;
  const scores = new Float32Array(n);
  if (!qt.length) return scores;
  for (let i = 0; i < n; i++) {
    const a = APIS[i];
    const hay = (a.name + " " + a.description + " " + a.category).toLowerCase();
    let s = 0;
    for (const t of qt) {
      if (!t) continue;
      if (a.name.toLowerCase().includes(t)) s += 3;
      else if (hay.includes(t)) s += 1;
    }
    scores[i] = qt.length ? s / (qt.length * 3) : 0;
  }
  return scores;
}

// ---------- 검색 ----------
function passesFilters(a) {
  if (els.noauth.checked && a.needsAuth) return false;
  if (els.https.checked && !a.https) return false;
  if (els.cors.checked && !a.cors) return false;
  if (els.category.value && a.category !== els.category.value) return false;
  return true;
}

async function search() {
  const query = els.query.value.trim();
  if (!query) {
    els.results.innerHTML = "";
    els.empty.classList.remove("hidden");
    els.stats.textContent = "";
    return;
  }
  els.empty.classList.add("hidden");
  els.searchBtn.disabled = true;

  const kw = keywordScores(query);
  let sem = null;
  if (await ensureModel()) {
    try {
      await buildEmbeddings();
      sem = await semanticScores(query);
      setStatus("");
    } catch (e) {
      console.warn(e);
      setStatus("⚠️ 의미 검색 중 오류 — 키워드 결과를 표시합니다.");
    }
  }

  const ranked = APIS.map((a, i) => {
    const semScore = sem ? sem[i] : 0;
    // 하이브리드: 의미 0.75 + 키워드 0.25 (모델 없으면 키워드만)
    const score = sem ? 0.75 * semScore + 0.25 * kw[i] : kw[i];
    return { a, i, score };
  })
    .filter((r) => passesFilters(r.a))
    .filter((r) => r.score > (sem ? 0.3 : 0.0001))
    .sort((x, y) => y.score - x.score)
    .slice(0, 30);

  render(ranked, !!sem);
  els.searchBtn.disabled = false;
}

// ---------- 렌더링 ----------
function badge(text, cls = "") {
  return `<span class="badge ${cls}">${text}</span>`;
}

function render(ranked, semantic) {
  els.stats.textContent = `${ranked.length}건 · ${semantic ? "의미 검색" : "키워드 검색"}`;
  if (!ranked.length) {
    els.results.innerHTML = "";
    els.empty.classList.remove("hidden");
    els.empty.innerHTML = "조건에 맞는 API가 없습니다. 필터를 풀거나 다른 표현을 시도해 보세요.";
    return;
  }
  els.empty.classList.add("hidden");
  els.results.innerHTML = ranked.map(({ a, score }) => card(a, score)).join("");
}

function card(a, score) {
  const badges = [
    badge(a.category, "cat"),
    a.needsAuth ? badge("인증: " + a.auth, "auth") : badge("인증 불필요", "ok"),
    a.https ? badge("HTTPS", "ok") : badge("HTTP"),
    a.cors ? badge("CORS", "ok") : badge("CORS ?"),
  ].join("");

  const id = "s" + Math.abs(hashStr(a.url + a.name));
  return `
  <li class="card" data-id="${id}">
    <div class="card-head">
      <h3>${esc(a.name)}</h3>
      <span class="score">유사도 ${(score * 100).toFixed(0)}%</span>
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

function esc(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ---------- 코드 스니펫 생성 ----------
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
    box.querySelector(".copy").addEventListener("click", (e) => {
      navigator.clipboard.writeText(snips[lang]);
      e.target.textContent = "복사됨!";
      setTimeout(() => (e.target.textContent = "복사"), 1200);
    });
  };
  draw();
}

// ---------- 이벤트 ----------
els.results.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-act='snippet']");
  if (!btn) return;
  const box = document.getElementById(btn.dataset.id);
  box.classList.toggle("hidden");
  if (!box.classList.contains("hidden") && !box.innerHTML) renderSnippet(box);
});

els.searchBtn.addEventListener("click", search);
els.query.addEventListener("keydown", (e) => { if (e.key === "Enter") search(); });
[els.noauth, els.https, els.cors, els.category].forEach((el) =>
  el.addEventListener("change", () => { if (els.query.value.trim()) search(); }));

// ---------- 초기화 ----------
async function init() {
  setStatus("API 카탈로그 불러오는 중…", true);
  try {
    APIS = await fetch("./data/apis.json").then((r) => r.json());
  } catch (e) {
    setStatus("❌ 카탈로그를 불러오지 못했습니다.");
    return;
  }
  const cats = [...new Set(APIS.map((a) => a.category))].sort((a, b) => a.localeCompare(b, "ko"));
  els.category.insertAdjacentHTML("beforeend",
    cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join(""));
  els.footerCount.textContent = `API ${APIS.length}개 · 카테고리 ${cats.length}개`;
  els.empty.classList.remove("hidden");
  setStatus("");
  // 모델은 백그라운드에서 미리 로드 시작 (첫 검색 지연 감소)
  ensureModel().then((ok) => { if (ok) buildEmbeddings().catch(() => {}); });
}

init();
