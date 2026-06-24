#!/usr/bin/env node
// 배포(npm publish / npm pack) 직전에 저장소의 데이터(app/data/*.json)를
// 패키지 내부 ./data로 복사합니다. 이렇게 하면 `npx open-apis-korea-mcp`로
// 설치한 사용자도 카탈로그를 함께 받습니다.
import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "..", "app", "data");
const DST = join(__dirname, "data");

mkdirSync(DST, { recursive: true });
let copied = 0;
for (const f of ["apis.json", "status.json"]) {
  const src = join(SRC, f);
  if (existsSync(src)) {
    copyFileSync(src, join(DST, f));
    console.log(`번들: ${f}`);
    copied++;
  }
}
if (!copied) {
  console.error("경고: app/data에서 복사할 데이터를 찾지 못했습니다. build/parse_apis.py를 먼저 실행하세요.");
  process.exit(1);
}
console.log(`완료: ${copied}개 파일을 mcp/data로 번들했습니다.`);
