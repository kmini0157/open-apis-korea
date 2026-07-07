# 🧭 한국 오픈 API 자연어 검색 (API 게이트웨이)

이 저장소의 [README.md](../README.md) 카탈로그(한국어 오픈 API 711개)를 **데이터셋으로** 사용하는
자연어 검색 웹앱입니다. 하고 싶은 일을 한국어로 입력하면 의미가 맞는 API를 찾아주고,
바로 쓸 수 있는 **호출 코드(fetch / curl / python)** 까지 생성합니다.

## 핵심

- **로컬 임베딩 의미 검색** — `multilingual-e5-small` 모델을 브라우저에서 직접 실행
  ([transformers.js](https://github.com/xenova/transformers.js)). 쿼리가 서버로 전송되지 않고,
  **API 키가 전혀 필요 없습니다.**
- **하이브리드 랭킹** — 의미 유사도(0.75) + 키워드 일치(0.25). 키워드만으로는 못 찾는
  “환율→환전소”, “이미지 생성→Pollinations” 같은 의도 매칭을 임베딩이 해결합니다.
- **💡 AI 솔루션 설계** — 만들고 싶은 걸 적으면 관련 API를 골라 **조합 설계 + 동작 코드**를 생성합니다.
  무료 LLM([Puter.js](https://developer.puter.com/))을 사용하며 **API 키가 없습니다.**
- **🟢 라이브 상태 배지** — GitHub Actions 크론이 각 API의 동작 여부/응답속도를 주기적으로
  점검해 `data/status.json`에 기록하고, 카드에 배지로 표시합니다. “동작 확인된 것만” 필터 제공.
- **⭐ 즐겨찾기 + PWA** — 카드의 ☆로 즐겨찾기, localStorage 저장. 설치형 PWA(오프라인 캐시).
- **임베딩 캐시** — 최초 1회 711개 API를 임베딩한 뒤 IndexedDB에 저장. 이후 검색은 즉시.
- **폴백** — 모델/LLM 로드에 실패해도 키워드 검색으로 항상 동작합니다.
- **필터 + 정렬** — 인증 불필요 / HTTPS / CORS / 동작중 / 즐겨찾기 / 카테고리 · 관련도/이름/응답 빠른순.
- **🗂 탐색 모드** — 검색어 없이도 전체 카탈로그를 필터·카테고리로 훑어볼 수 있습니다("더 보기"로 페이지네이션).
- **🕘 최근 검색어** — 검색창 아래 칩으로 표시(로컬 저장, 한 번에 지우기 가능).
- **🌙/☀️ 테마** — 시스템 라이트/다크를 따르고, 우상단 버튼으로 고정 전환.
- **⌨️ 단축키** — `/` 검색창 포커스, `Esc` 검색어 지우고 탐색 모드.

### 라이브 상태 점검

`data/status.json`은 저장소에 커밋하지 않습니다 — 인터넷이 열린 GitHub Actions 러너에서
[`.github/workflows/api-status.yml`](../.github/workflows/api-status.yml)가 6시간마다 생성·커밋합니다.
수동 점검:

```bash
python3 build/check_status.py   # → app/data/status.json
```

> 파일이 없으면 앱은 상태 배지/필터를 조용히 숨기고 정상 동작합니다.

## 로컬 실행

정적 파일이라 빌드가 필요 없습니다.

```bash
cd app
python3 -m http.server 8099
# http://localhost:8099 접속
```

> 의미 검색 모델(약 25MB)은 첫 검색 시 jsDelivr CDN에서 받아옵니다. 오프라인이면 키워드 검색으로 동작합니다.

## 데이터셋 재생성

README.md가 갱신되면 다시 파싱합니다.

```bash
python3 build/parse_apis.py   # → app/data/apis.json
```

## 배포 (모두 무료 티어)

빌드 산출물이 `app/` 디렉터리 자체입니다.

| 호스팅 | 설정 |
| --- | --- |
| **Cloudflare Pages** | Build command: *(없음)* · Output directory: `app` |
| **Vercel** | Framework: *Other* · Output / Root Directory: `app` |
| **Netlify** | Publish directory: `app` · Build command: *(없음)* |

## 구조

```
app/
├── index.html      # UI
├── styles.css
├── app.js          # 임베딩·검색·랭킹·코드 스니펫 생성
└── data/apis.json  # build/parse_apis.py가 생성 (README.md에서 추출)
```
