#!/usr/bin/env python3
"""app/icon.svg 디자인을 PNG 아이콘으로 렌더링합니다 (PWA 설치용).

생성물: app/icons/icon-192.png, icon-512.png, icon-maskable-512.png
4배 슈퍼샘플링 후 축소하여 부드러운 가장자리를 얻습니다.
"""
import math
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUTDIR = ROOT / "app" / "icons"

BG = (15, 17, 23, 255)        # #0f1117
BLUE = (91, 140, 255, 255)    # #5b8cff
GREEN = (56, 211, 159, 255)   # #38d39f
LIGHT = (230, 232, 238, 255)  # #e6e8ee

SS = 4  # supersample


def draw_icon(size: int, pad_ratio: float = 0.0) -> Image.Image:
    """size px 아이콘. pad_ratio>0이면 maskable 안전영역을 위해 콘텐츠를 축소."""
    S = size * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 배경 (maskable은 꽉 찬 배경, 일반은 둥근 사각형)
    if pad_ratio > 0:
        d.rectangle([0, 0, S, S], fill=BG)
    else:
        r = int(96 / 512 * S)
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=r, fill=BG)

    # 콘텐츠 좌표계: 512 기준 → 안전영역 축소/중앙정렬
    scale = (1 - 2 * pad_ratio) * S / 512
    off = S / 2

    def P(x, y):
        return (off + (x - 256) * scale, off + (y - 256) * scale)

    def W(w):
        return max(1, int(w * scale))

    # 메인 원 (파랑 링)
    r150 = 150 * scale
    cx, cy = P(256, 256)
    d.ellipse([cx - r150, cy - r150, cx + r150, cy + r150], outline=BLUE, width=W(28))

    # 강조 호 (초록) — 상단 우측에 약 70도
    bbox = [cx - r150, cy - r150, cx + r150, cy + r150]
    d.arc(bbox, start=-95, end=-25, fill=GREEN, width=W(28))

    # 나침반 바늘 (다이아몬드)
    needle = [P(256, 150), P(292, 256), P(256, 362), P(220, 256)]
    d.polygon(needle, fill=BLUE)

    # 중심 원 (배경색 채움 + 밝은 테두리)
    r34 = 34 * scale
    d.ellipse([cx - r34, cy - r34, cx + r34, cy + r34], fill=BG, outline=LIGHT, width=W(14))

    return img.resize((size, size), Image.LANCZOS)


def main():
    OUTDIR.mkdir(parents=True, exist_ok=True)
    targets = [
        ("icon-192.png", 192, 0.0),
        ("icon-512.png", 512, 0.0),
        ("icon-maskable-512.png", 512, 0.12),  # 안전영역 패딩
    ]
    for name, size, pad in targets:
        draw_icon(size, pad).save(OUTDIR / name)
        print(f"생성: app/icons/{name} ({size}x{size})")


if __name__ == "__main__":
    main()
