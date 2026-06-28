# 🚀 배포 가이드

웹앱(`app/`)은 **빌드가 필요 없는 정적 사이트**입니다. 출력(루트) 디렉터리만 `app`으로
지정하면 모든 무료 호스팅에 그대로 올라갑니다. 의미 검색 모델과 AI(LLM)는 브라우저에서
로드되므로 **서버/환경변수/API 키가 전혀 필요 없습니다.**

> ⚠️ 단, 의미 검색 모델(jsDelivr CDN)과 LLM(`js.puter.com`)은 외부에서 로드됩니다.
> HTTPS로 서빙되면 정상 동작합니다(아래 호스팅 모두 기본 HTTPS).

---

## 1. Cloudflare Pages (권장)

### A. 대시보드(깃 연동) — 가장 쉬움
1. [Cloudflare Pages](https://pages.cloudflare.com) → **Create a project** → **Connect to Git**.
2. 이 저장소 선택.
3. 빌드 설정:
   - **Framework preset**: `None`
   - **Build command**: *(비워둠)*
   - **Build output directory**: `app`
4. **Save and Deploy**. 끝 — `https://<project>.pages.dev`로 공개됩니다.

이후 `master`(또는 연결한 브랜치)에 push할 때마다 자동 재배포됩니다.

### B. Wrangler CLI — 클론 후 한 줄
```bash
npm i -g wrangler
wrangler pages deploy app --project-name open-apis-korea
```

> `app/_headers` 파일이 캐시 정책을 자동 적용합니다(데이터·서비스워커는 no-cache,
> 정적 자산은 장기 캐시).

---

## 2. Vercel
- **New Project** → 저장소 import.
- **Framework Preset**: `Other`
- **Root Directory**: `app`
- Build/Output 설정은 비워둠 → Deploy.

또는 CLI:
```bash
npm i -g vercel
cd app && vercel --prod
```

## 3. Netlify
- **Add new site** → import.
- **Base directory**: *(비워둠)*
- **Publish directory**: `app`
- **Build command**: *(비워둠)* → Deploy.

또는 CLI:
```bash
npm i -g netlify-cli
netlify deploy --prod --dir app
```

---

## 배포 후 체크리스트
- [ ] 페이지가 HTTPS로 열리는지 (PWA·모델 로드에 필요)
- [ ] 검색창에 “날씨 예보” 입력 → 최초 1회 모델 로드 후 의미 검색 결과 표시
- [ ] **💡 AI 솔루션 설계** 탭에서 응답이 스트리밍되는지
- [ ] 브라우저 주소창의 **설치** 아이콘으로 PWA 설치되는지
- [ ] 🟢 상태 배지가 보이는지 (`app/data/status.json`이 있어야 — GitHub Actions가 갱신)

## 상태 데이터 자동 갱신
`.github/workflows/api-status.yml`이 6시간마다 `app/data/status.json`을 갱신·커밋합니다.
워크플로가 커밋하려면 저장소 **Settings → Actions → General → Workflow permissions**를
**“Read and write”** 로 설정하세요.

## 커스텀 도메인
세 호스팅 모두 대시보드에서 커스텀 도메인을 무료로 연결할 수 있습니다(자동 HTTPS 인증서 포함).
