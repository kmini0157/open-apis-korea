#!/usr/bin/env python3
"""README.md의 한국어 오픈 API 카탈로그를 구조화된 JSON으로 변환합니다.

이 스크립트는 자연어 게이트웨이 앱(app/)의 데이터셋(app/data/apis.json)을 생성합니다.
README의 각 `### 카테고리` 아래 마크다운 표를 파싱하여
{name, url, description, auth, https, cors, category} 레코드로 만듭니다.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
README = ROOT / "README.md"
OUT = ROOT / "app" / "data" / "apis.json"

# 목차/참고 자료 등 API 표가 아닌 섹션은 제외합니다.
SKIP_CATEGORIES = {"참고 자료"}

# 마크다운 링크: [텍스트](url)
LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")
# 표 헤더 구분선: | --- | --- | ...
SEP_RE = re.compile(r"^\|[\s:\-|]+\|?\s*$")


def clean(cell: str) -> str:
    return cell.strip()


def parse() -> list:
    lines = README.read_text(encoding="utf-8").splitlines()
    records = []
    current_category = None

    for line in lines:
        header = re.match(r"^###\s+(.*)$", line)
        if header:
            current_category = header.group(1).strip()
            continue

        if current_category is None or current_category in SKIP_CATEGORIES:
            continue

        if not line.lstrip().startswith("|"):
            continue
        if SEP_RE.match(line.strip()):
            continue

        cells = [clean(c) for c in line.strip().strip("|").split("|")]
        if len(cells) < 5:
            continue

        # 헤더 행(| API | 설명 | 인증 | HTTPS | CORS |) 건너뛰기
        if cells[0] in ("API", "이름") and "설명" in cells[1]:
            continue

        link = LINK_RE.search(cells[0])
        if not link:
            continue

        name = clean(link.group(1))
        url = clean(link.group(2))
        auth = clean(cells[2]).strip("`").strip()
        https = clean(cells[3])
        cors = clean(cells[4])
        # ✕ = 인증 불필요, 그 외(apiKey/OAuth 등)는 인증 필요
        needs_auth = auth not in ("", "✕", "X", "x", "No", "없음")
        records.append(
            {
                "name": name,
                "url": url,
                "description": clean(cells[1]),
                "auth": auth if auth else "✕",
                "needsAuth": needs_auth,
                "https": https == "○",
                "cors": cors == "○",
                "category": current_category,
            }
        )

    return records


def main() -> int:
    records = parse()
    if not records:
        print("error: 파싱된 API가 없습니다.", file=sys.stderr)
        return 1

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    cats = sorted({r["category"] for r in records})
    print(f"파싱 완료: API {len(records)}개 / 카테고리 {len(cats)}개")
    print(f"출력: {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
