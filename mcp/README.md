# 🔌 open-apis-korea MCP 서버

Claude Desktop · Cursor 같은 **MCP 클라이언트에서 한국 오픈 API를 직접 검색**하게 해주는
stdio MCP 서버입니다. 이 저장소의 [`app/data/apis.json`](../app/data/apis.json)(한국 오픈 API 711개)을
데이터로 사용하며, **외부 네트워크나 API 키가 필요 없습니다.**

상태 데이터([`app/data/status.json`](../app/data/status.json), GitHub Actions가 갱신)가 있으면
검색 결과에 동작 여부/응답속도가 함께 표시됩니다.

## 제공 도구(tools)

| 도구 | 설명 |
| --- | --- |
| `search_korean_apis` | 자연어로 API 검색. 필터: `category`, `noAuth`, `https`, `cors`, `liveOnly`, `limit` |
| `list_api_categories` | 전체 카테고리와 API 개수 |
| `get_api_details` | 이름으로 상세 정보 + 호출 코드(`fetch`/`curl`/`python`) |

## 설치 & 실행 방법

### A. npx 한 줄 (배포된 경우 — 권장)

별도 클론 없이 클라이언트 설정만으로 동작합니다. 카탈로그 데이터는 패키지에 번들됩니다.

```json
{
  "mcpServers": {
    "open-apis-korea": {
      "command": "npx",
      "args": ["-y", "open-apis-korea-mcp"]
    }
  }
}
```

> 직접 npm에 배포하려면 저장소에서 `cd mcp && npm run bundle && npm publish` 하세요.
> `prepack`/`prepublishOnly`가 `app/data`의 최신 데이터를 패키지로 번들합니다.

### B. 저장소에서 직접 실행

```bash
cd mcp
npm install
```

```json
{
  "mcpServers": {
    "open-apis-korea": {
      "command": "node",
      "args": ["/absolute/path/to/open-apis-korea/mcp/server.js"]
    }
  }
}
```

위 설정은 **Claude Desktop**의 `claude_desktop_config.json`,
**Cursor**의 `.cursor/mcp.json`(또는 전역 설정)에 동일하게 넣으면 됩니다.

### 데이터 경로 해석 순서

서버는 다음 순서로 카탈로그를 찾습니다: `OPEN_APIS_DATA_DIR` 환경변수 → 패키지 번들 `./data`
→ 저장소 `../app/data`. 사용자 지정 데이터를 쓰려면 `OPEN_APIS_DATA_DIR`를 설정하세요.

설정 후 클라이언트를 재시작하면 “**날씨 예보 가져오는 한국 API 찾아줘**”, “**인증 없이 쓸 수 있는 교통 API 알려줘**”
같은 요청에 도구가 자동으로 호출됩니다.

## 직접 실행(디버그)

```bash
node server.js   # stdio로 JSON-RPC 대기
```

## 데이터 갱신

API 목록은 README.md에서 파생됩니다. 카탈로그가 바뀌면:

```bash
python3 ../build/parse_apis.py    # apis.json 재생성
```
