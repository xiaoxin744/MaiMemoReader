"""生成 PWA 图标：墨色底 + 纸色衬线 M + 朱砂短线。
运行：python scripts/make_icons.py（需要 Pillow）
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

INK = (22, 19, 15)
PAPER = (250, 247, 241)
ACCENT = (180, 67, 28)

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\georgiab.ttf",
    r"C:\Windows\Fonts\timesbd.ttf",
    r"C:\Windows\Fonts\arialbd.ttf",
]


def load_font(size: int):
    for path in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def rounded_icon(size: int, maskable: bool = False) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    if maskable:
        # maskable：满幅墨色，主体缩进安全区
        draw.rectangle([0, 0, size, size], fill=INK)
        pad = int(size * 0.28)
    else:
        radius = int(size * 0.22)
        draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=INK)
        pad = int(size * 0.16)

    box = size - pad * 2
    font_size = int(box * 0.72)
    font = load_font(font_size)
    text = "M"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(
        (pad + (box - tw) / 2 - bbox[0], pad + (box - th) / 2 - bbox[1] - size * 0.03),
        text,
        font=font,
        fill=PAPER,
    )

    # 朱砂短线：像阅读进度条
    line_w = int(size * 0.30)
    line_h = max(4, int(size * 0.022))
    x0 = (size - line_w) / 2
    y0 = size - pad - line_h * 2
    draw.rounded_rectangle([x0, y0, x0 + line_w * 0.58, y0 + line_h], radius=line_h, fill=ACCENT)
    draw.rounded_rectangle(
        [x0 + line_w * 0.62, y0, x0 + line_w, y0 + line_h],
        radius=line_h,
        fill=(90, 82, 71),
    )
    return img


def main() -> None:
    rounded_icon(192).save(OUT / "icon-192.png")
    rounded_icon(512).save(OUT / "icon-512.png")
    rounded_icon(512, maskable=True).save(OUT / "maskable-512.png")
    rounded_icon(180).save(OUT / "apple-touch-icon.png")
    favicon = rounded_icon(64)
    favicon.save(OUT / "favicon.png")
    (OUT / "favicon.svg").write_text(
        """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#16130f"/>
  <text x="32" y="45" font-family="Georgia, 'Times New Roman', serif" font-size="38"
        text-anchor="middle" fill="#faf7f1">M</text>
  <rect x="20" y="50" width="15" height="3" rx="1.5" fill="#b4431c"/>
  <rect x="38" y="50" width="7" height="3" rx="1.5" fill="#5a5247"/>
</svg>
"""
    )
    print("icons written to", OUT)


if __name__ == "__main__":
    main()
