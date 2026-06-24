#!/usr/bin/env node
// 한국 오픈 API 카탈로그 MCP 서버 (stdio).
// app/data/apis.json을 데이터로 사용해 AI 클라이언트(Claude Desktop, Cursor 등)에서
// 한국 오픈 API를 검색·조회할 수 있게 합니다. 외부 네트워크/키가 필요 없습니다.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// 데이터 위치를 견고하게 해석합니다 (개발/저장소 실행 및 npm 배포 모두 지원):
//   1) 환경변수 OPEN_APIS_DATA_DIR
//   2) 패키지에 번들된 ./data  (npm publish 시 bundle-data.js가 채움)
//   3) 저장소의 ../app/data    (소스 트리에서 직접 실행할 때)
const DATA_DIRS = [
  process.env.OPEN_APIS_DATA_DIR,
  join(__dirname, "data"),
  join(__dirname, "..", "app", "data"),
].filter(Boolean);

function loadJSON(name, fallback) {
  for (const dir of DATA_DIRS) {
    try {
      return JSON.parse(readFileSync(join(dir, name), "utf-8"));
    } catch {
      /* 다음 후보 경로 시도 */
    }
  }
  return fallback;
}

const APIS = loadJSON("apis.json", []);
const STATUS = loadJSON("status.json", null); // { results: { url: {ok,code,ms} } }

if (!APIS.length) {
  console.error("[open-apis-korea-mcp] apis.json을 찾을 수 없습니다. build/parse_apis.py를 먼저 실행하세요.");
}

// ---------- 검색 ----------
function tokenize(s) {
  return (s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter(Boolean);
}

function statusOf(url) {
  return STATUS && STATUS.results ? STATUS.results[url] : undefined;
}

function score(api, qTokens, qRaw) {
  const name = api.name.toLowerCase();
  const hay = (api.name + " " + api.description + " " + api.category).toLowerCase();
  let s = 0;
  for (const t of qTokens) {
    if (name.includes(t)) s += 3;
    else if (hay.includes(t)) s += 1;
  }
  // 원문 구절이 통째로 들어가면 가산
  if (qRaw && hay.includes(qRaw.toLowerCase())) s += 2;
  return qTokens.length ? s / (qTokens.length * 3) : 0;
}

function searchApis(query, opts = {}) {
  const { category, noAuth, https, cors, liveOnly, limit = 10 } = opts;
  const qTokens = tokenize(query);
  return APIS.map((a) => ({ a, s: score(a, qTokens, query) }))
    .filter(({ a, s }) => {
      if (s <= 0) return false;
      if (category && a.category !== category) return false;
      if (noAuth && a.needsAuth) return false;
      if (https && !a.https) return false;
      if (cors && !a.cors) return false;
      if (liveOnly) { const st = statusOf(a.url); if (!st || !st.ok) return false; }
      return true;
    })
    .sort((x, y) => y.s - x.s)
    .slice(0, Math.max(1, Math.min(limit, 50)))
    .map(({ a, s }) => view(a, s));
}

function view(a, relevance) {
  const st = statusOf(a.url);
  return {
    name: a.name,
    category: a.category,
    description: a.description,
    url: a.url,
    auth: a.needsAuth ? a.auth : "none",
    https: a.https,
    cors: a.cors,
    ...(st ? { status: st.ok ? "up" : "down", httpCode: st.code, latencyMs: st.ms } : {}),
    ...(relevance != null ? { relevance: Number(relevance.toFixed(3)) } : {}),
  };
}

// ---------- 코드 스니펫 ----------
function snippet(api, lang) {
  const url = api.url;
  const needsAuth = api.needsAuth;
  if (lang === "curl") {
    return `curl "${url}"${needsAuth ? ' \\\n  -H "Authorization: Bearer <API_KEY>"' : ""}`;
  }
  if (lang === "python") {
    return `import requests\n${needsAuth ? 'headers = {"Authorization": "Bearer <API_KEY>"}' : "headers = {}"}\nres = requests.get("${url}", headers=headers)\nprint(res.json())`;
  }
  // fetch (기본)
  return `${needsAuth ? "// 인증 필요: <API_KEY> 자리에 키를 넣으세요\n" : ""}const res = await fetch("${url}"${needsAuth ? ', {\n  headers: { "Authorization": "Bearer <API_KEY>" },\n}' : ""});\nconst data = await res.json();\nconsole.log(data);`;
}

function ok(obj) {
  return { content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] };
}

// ---------- 서버 ----------
const server = new McpServer({
  name: "open-apis-korea",
  version: "1.0.0",
});

server.registerTool(
  "search_korean_apis",
  {
    title: "한국 오픈 API 검색",
    description:
      "한국어/영어 자연어로 한국 오픈 API를 검색합니다. 무엇을 만들고 싶은지, 어떤 데이터가 필요한지 설명하면 적합한 API 목록을 반환합니다. 필터로 인증 불필요/HTTPS/CORS/카테고리/동작중을 지정할 수 있습니다.",
    inputSchema: {
      query: z.string().describe("찾으려는 기능이나 데이터 (예: '날씨 예보', '이름으로 성별 추정', '지하철 도착')"),
      category: z.string().optional().describe("카테고리로 한정 (예: '교통', '금융', '정부')"),
      noAuth: z.boolean().optional().describe("true면 인증이 필요 없는 API만"),
      https: z.boolean().optional().describe("true면 HTTPS 지원 API만"),
      cors: z.boolean().optional().describe("true면 CORS 가능한 API만"),
      liveOnly: z.boolean().optional().describe("true면 최근 상태 점검에서 동작 확인된 API만"),
      limit: z.number().optional().describe("최대 결과 수 (기본 10, 최대 50)"),
    },
  },
  async ({ query, ...opts }) => {
    const results = searchApis(query, opts);
    return ok({ query, count: results.length, results });
  }
);

server.registerTool(
  "list_api_categories",
  {
    title: "API 카테고리 목록",
    description: "한국 오픈 API 카탈로그의 모든 카테고리와 각 카테고리의 API 개수를 반환합니다.",
    inputSchema: {},
  },
  async () => {
    const counts = {};
    for (const a of APIS) counts[a.category] = (counts[a.category] || 0) + 1;
    const categories = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
    return ok({ total: APIS.length, categories });
  }
);

server.registerTool(
  "get_api_details",
  {
    title: "API 상세 + 호출 코드",
    description:
      "API 이름으로 상세 정보와 바로 쓸 수 있는 호출 코드(fetch/curl/python)를 반환합니다. 이름은 search_korean_apis 결과의 name을 사용하세요.",
    inputSchema: {
      name: z.string().describe("API 이름 (정확히 또는 부분 일치)"),
      lang: z.enum(["fetch", "curl", "python"]).optional().describe("코드 언어 (기본 fetch)"),
    },
  },
  async ({ name, lang = "fetch" }) => {
    const lower = name.toLowerCase();
    const api =
      APIS.find((a) => a.name.toLowerCase() === lower) ||
      APIS.find((a) => a.name.toLowerCase().includes(lower));
    if (!api) {
      return { content: [{ type: "text", text: `"${name}"에 해당하는 API를 찾지 못했습니다.` }], isError: true };
    }
    return ok({ ...view(api), code: { lang, snippet: snippet(api, lang) } });
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[open-apis-korea-mcp] 준비 완료 — API ${APIS.length}개 로드됨${STATUS ? ` (상태 데이터 포함)` : ""}.`);
