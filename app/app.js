// 한국 오픈 API 자연어 검색 — 로컬 임베딩(transformers.js) 의미 검색 +
// 무료 LLM(Puter.js) 솔루션 설계 + 라이브 상태 배지 + PWA/즐겨찾기.
// 외부 API 키가 전혀 필요 없습니다.

const MODEL = "Xenova/multilingual-e5-small";
const MODEL_CDN = "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2";
const DB_NAME = "open-apis-ko";
const STORE = "embeddings";
const FAV_KEY = "open-apis-ko:favs";

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
  footerCount: document.getElementById("footer-count"),
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
      if (a.name.toLowerCase().includes(t)) s += 3;
      else if (hay.includes(t)) s += 1;
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

async function search() {
  const query = els.query.value.trim();

  // 즐겨찾기만 + 검색어 없음 → 즐겨찾기 목록 표시
  if (!query) {
    if (els.fav.checked) {
      const list = APIS.filter(passesFilters).map((a) => ({ a, score: 1 }));
      render(list, false, "⭐ 즐겨찾기");
      return;
    }
    els.results.innerHTML = "";
    els.empty.classList.remove("hidden");
    els.stats.textContent = "";
    return;
  }

  els.empty.classList.add("hidden");
  els.searchBtn.disabled = true;

  const kw = keywordScores(query);
  const sem = await getSemantic(query);
  if (sem) setStatus("");

  const ranked = APIS.map((a, i) => {
    const score = sem ? 0.75 * sem[i] + 0.25 * kw[i] : kw[i];
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
function badge(text, cls = "") { return `<span class="badge ${cls}">${text}</span>`; }

function render(ranked, semantic, label) {
  els.stats.textContent =
    `${ranked.length}건 · ${label || (semantic ? "의미 검색" : "키워드 검색")}`;
  if (!ranked.length) {
    els.results.innerHTML = "";
    els.empty.classList.remove("hidden");
    els.empty.innerHTML = els.fav.checked
      ? "아직 즐겨찾기가 없습니다. 카드의 ☆를 눌러 추가해 보세요."
      : "조건에 맞는 API가 없습니다. 필터를 풀거나 다른 표현을 시도해 보세요.";
    return;
  }
  els.empty.classList.add("hidden");
  els.results.innerHTML = ranked.map(({ a, score }) => card(a, score, semantic)).join("");
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
  <li class="card" data-id="${id}">
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
    box.querySelector(".copy").addEventListener("click", (e) => {
      navigator.clipboard.writeText(snips[lang]);
      e.target.textContent = "복사됨!";
      setTimeout(() => (e.target.textContent = "복사"), 1200);
    });
  };
  draw();
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
      `<div class="ai-cands"><h4>선택된 후보 API</h4><ul>` +
      cands.map((a) => `<li><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.name)}</a>` +
        ` <span class="muted">· ${esc(a.category)}</span></li>`).join("") +
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
      }
    } catch (streamErr) {
      console.warn("스트리밍 미지원 — 일반 응답으로 폴백", streamErr);
    }

    if (!streamed) {
      const resp = await puter.ai.chat(prompt);
      text = typeof resp === "string" ? resp
        : resp?.message?.content ?? resp?.text ?? (resp?.toString ? resp.toString() : String(resp));
      answerEl.innerHTML = renderMarkdown(text || "(빈 응답)");
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

els.searchBtn.addEventListener("click", search);
els.query.addEventListener("keydown", (e) => { if (e.key === "Enter") search(); });
[els.noauth, els.https, els.cors, els.live, els.fav, els.category].forEach((el) =>
  el.addEventListener("change", () => {
    if (els.query.value.trim() || els.fav.checked) search();
    else { els.results.innerHTML = ""; els.empty.classList.remove("hidden"); els.stats.textContent = ""; }
  }));

els.aiBtn.addEventListener("click", askAI);

// 탭 전환
document.querySelectorAll(".tab").forEach((t) =>
  t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    const which = t.dataset.tab;
    document.getElementById("tab-search").classList.toggle("hidden", which !== "search");
    document.getElementById("tab-ai").classList.toggle("hidden", which !== "ai");
  }));

// ---------- 초기화 ----------
async function init() {
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

  els.empty.classList.remove("hidden");
  setStatus("");

  // 모델 백그라운드 사전 로드
  ensureModel().then((ok) => { if (ok) buildEmbeddings().catch(() => {}); });

  // 서비스 워커 등록 (PWA)
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

init();
