#!/usr/bin/env node
// MCP 서버 스모크 테스트 — stdio로 핸드셰이크 후 각 도구를 호출해 기대값을 검증합니다.
// 사용: npm test  (또는 node test.js)
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));
const server = join(__dirname, "server.js");

const p = spawn("node", [server], { stdio: ["pipe", "pipe", "inherit"] });
const pending = [];
let buf = "";
p.stdout.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (line.trim()) pending.push(JSON.parse(line));
  }
});

const send = (o) => p.stdin.write(JSON.stringify(o) + "\n");
const wait = (id, ms = 5000) =>
  new Promise((resolve, reject) => {
    const t0 = Date.now();
    const t = setInterval(() => {
      const m = pending.find((x) => x.id === id);
      if (m) { clearInterval(t); resolve(m); }
      else if (Date.now() - t0 > ms) { clearInterval(t); reject(new Error(`timeout waiting id=${id}`)); }
    }, 20);
  });
const call = async (id, name, args) => {
  send({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
  const r = await wait(id);
  assert.ok(!r.error, `tool ${name} 오류: ${JSON.stringify(r.error)}`);
  return JSON.parse(r.result.content[0].text);
};

let failed = false;
try {
  // initialize
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
  await wait(1);
  send({ jsonrpc: "2.0", method: "notifications/initialized" });

  // tools/list
  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const tl = await wait(2);
  const names = tl.result.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["get_api_details", "list_api_categories", "search_korean_apis"], "도구 3종이 모두 노출되어야 함");
  console.log("✓ tools/list — 3개 도구 노출");

  // list_api_categories
  const cats = await call(3, "list_api_categories", {});
  assert.ok(cats.total > 700, `카탈로그 규모(${cats.total})가 충분해야 함`);
  assert.ok(Array.isArray(cats.categories) && cats.categories.length > 30, "카테고리가 충분해야 함");
  console.log(`✓ list_api_categories — API ${cats.total}개 / 카테고리 ${cats.categories.length}개`);

  // search
  const s = await call(4, "search_korean_apis", { query: "날씨 예보", limit: 5 });
  assert.ok(s.count > 0, "날씨 검색 결과가 있어야 함");
  assert.ok(s.results[0].name && s.results[0].url && s.results[0].category, "결과에 필수 필드가 있어야 함");
  console.log(`✓ search_korean_apis '날씨 예보' — ${s.count}건, top: ${s.results[0].name}`);

  // noAuth 필터
  const sa = await call(5, "search_korean_apis", { query: "날씨", noAuth: true, limit: 10 });
  assert.ok(sa.results.every((r) => r.auth === "none"), "noAuth 필터는 인증 불필요만 반환해야 함");
  console.log(`✓ noAuth 필터 — ${sa.count}건 모두 인증 불필요`);

  // get_api_details + 코드
  const g = await call(6, "get_api_details", { name: "Genderize", lang: "python" });
  assert.ok(/genderize/i.test(g.url), "Genderize 상세를 찾아야 함");
  assert.ok(g.code && g.code.snippet.includes("requests.get"), "python 코드 스니펫이 있어야 함");
  console.log(`✓ get_api_details 'Genderize' — 코드(${g.code.lang}) 생성 확인`);

  console.log("\n✅ 모든 MCP 테스트 통과");
} catch (e) {
  failed = true;
  console.error("\n❌ 테스트 실패:", e.message);
} finally {
  p.kill();
  process.exit(failed ? 1 : 0);
}
