#!/usr/bin/env python3
"""각 오픈 API의 동작 상태(코드/응답속도)를 점검해 app/data/status.json을 생성합니다.

GitHub Actions 크론(.github/workflows/api-status.yml)에서 주기적으로 실행됩니다.
각 URL에 HEAD→실패 시 GET을 시도하고, HTTP 상태/지연(ms)을 기록합니다.
대부분의 항목은 문서 페이지이므로 "사이트 가용성"의 근사치입니다.
"""
import concurrent.futures as cf
import json
import time
import urllib.request
import urllib.error
import ssl
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APIS = ROOT / "app" / "data" / "apis.json"
OUT = ROOT / "app" / "data" / "status.json"

TIMEOUT = 8
WORKERS = 24
UA = "Mozilla/5.0 (compatible; open-apis-korea-statusbot/1.0; +https://github.com/kmini0157/open-apis-korea)"
# 프록시 환경에서 자체서명/사내 CA를 신뢰하기 위한 컨텍스트
CTX = ssl.create_default_context()
CA = os.environ.get("REQUESTS_CA_BUNDLE") or "/root/.ccr/ca-bundle.crt"
if os.path.exists(CA):
    try:
        CTX.load_verify_locations(CA)
    except Exception:
        pass


def probe(url: str) -> dict:
    for method in ("HEAD", "GET"):
        req = urllib.request.Request(url, method=method, headers={"User-Agent": UA})
        t0 = time.monotonic()
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT, context=CTX) as r:
                ms = int((time.monotonic() - t0) * 1000)
                return {"code": r.status, "ok": 200 <= r.status < 400, "ms": ms}
        except urllib.error.HTTPError as e:
            ms = int((time.monotonic() - t0) * 1000)
            # 405(HEAD 미지원) 등은 GET으로 재시도
            if method == "HEAD" and e.code in (403, 405, 400, 501):
                continue
            return {"code": e.code, "ok": 200 <= e.code < 400, "ms": ms}
        except Exception:
            if method == "HEAD":
                continue
            return {"code": 0, "ok": False, "ms": None}
    return {"code": 0, "ok": False, "ms": None}


def main() -> int:
    apis = json.loads(APIS.read_text(encoding="utf-8"))
    urls = sorted({a["url"] for a in apis})
    results = {}
    done = 0
    with cf.ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futures = {ex.submit(probe, u): u for u in urls}
        for fut in cf.as_completed(futures):
            u = futures[fut]
            try:
                results[u] = fut.result()
            except Exception:
                results[u] = {"code": 0, "ok": False, "ms": None}
            done += 1
            if done % 50 == 0:
                print(f"  {done}/{len(urls)} 점검 완료")

    ok = sum(1 for r in results.values() if r["ok"])
    payload = {
        "generatedAt": int(time.time()),
        "total": len(results),
        "ok": ok,
        "results": results,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"상태 점검 완료: {ok}/{len(results)} 정상 → {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
