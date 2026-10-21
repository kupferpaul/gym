# Erzeugt die App-Icons (Hantel auf dunklem Grund) ohne Abhängigkeiten.
# Aufruf: python3 tools/make-icons.py
import struct
import zlib
from pathlib import Path

BG = (18, 18, 20)
FG = (79, 195, 247)

# Rechtecke in Anteilen der Kantenlänge (x0, y0, x1, y1): Stange, Innenscheiben, Außenscheiben.
SHAPES = [
    (0.22, 0.47, 0.78, 0.53),
    (0.27, 0.30, 0.35, 0.70), (0.65, 0.30, 0.73, 0.70),
    (0.17, 0.37, 0.25, 0.63), (0.75, 0.37, 0.83, 0.63),
]


def png(size):
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            fx, fy = (x + 0.5) / size, (y + 0.5) / size
            hit = any(x0 <= fx <= x1 and y0 <= fy <= y1 for x0, y0, x1, y1 in SHAPES)
            row += bytes(FG if hit else BG)
        rows.append(bytes(row))
    raw = zlib.compress(b''.join(rows), 9)

    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)

    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', raw) + chunk(b'IEND', b''))


out = Path(__file__).resolve().parent.parent / 'icons'
for name, size in [('apple-touch-icon.png', 180), ('icon-192.png', 192), ('icon-512.png', 512)]:
    (out / name).write_bytes(png(size))
    print(name, size)
