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

## 설치

```bash
cd mcp
npm install
```

## 클라이언트 설정

### Claude Desktop
`claude_desktop_config.json`에 추가 (경로는 저장소 위치에 맞게):

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

### Cursor
`.cursor/mcp.json` (프로젝트) 또는 전역 설정에 동일한 형식으로 추가합니다.

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
