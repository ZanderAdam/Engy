#!/usr/bin/env python3
"""Offset-crop a PNG (sips can only center-crop; ImageMagick isn't installed).

Usage:
    crop-region.py <src.png> <left> <top> <right> <bottom> <dest.png>

right/bottom of 0 mean "to the image edge" (full width/height from that side).
Coordinates are in the screenshot's own pixels (playwright-cli shots are 1792 wide).

Example — crop the terminal rail (sidebar + panel) from a 1792x1120 shot:
    crop-region.py shot.png 1068 44 0 1113 docs/screenshots/terminal.png
"""
import sys
from PIL import Image


def main() -> int:
    if len(sys.argv) != 7:
        print(__doc__)
        return 2
    src, left, top, right, bottom, dest = sys.argv[1], *map(int, sys.argv[2:6]), sys.argv[6]
    im = Image.open(src)
    w, h = im.size
    right = right or w
    bottom = bottom or h
    if not (0 <= left < right <= w and 0 <= top < bottom <= h):
        print(f"bad box ({left},{top},{right},{bottom}) for image {w}x{h}", file=sys.stderr)
        return 1
    im.crop((left, top, right, bottom)).save(dest)
    out = Image.open(dest).size
    print(f"{dest} {out[0]}x{out[1]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
