from pathlib import Path
import struct
import zlib

# Generate a small 32x32 RGBA PNG and wrap it in a Windows ICO container.
# This keeps the source asset reproducible without committing a binary file.
SIZE = 32
rows = []
for y in range(SIZE):
    row = bytearray([0])
    for x in range(SIZE):
        # Navy background with a light-blue, block-style M mark.
        inside = (4 <= x <= 8 or 13 <= x <= 18 or 23 <= x <= 27 or
                  (9 <= x <= 13 and y >= 17 and y <= 22) or
                  (18 <= x <= 22 and y >= 17 and y <= 22))
        if inside:
            row.extend((174, 198, 255, 255))
        else:
            row.extend((13, 20, 34, 255))
    rows.append(bytes(row))

def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff)

raw = b"".join(rows)
png = (b"\x89PNG\r\n\x1a\n" +
       chunk(b"IHDR", struct.pack(">2I5B", SIZE, SIZE, 8, 6, 0, 0, 0)) +
       chunk(b"IDAT", zlib.compress(raw, 9)) +
       chunk(b"IEND", b""))

# ICONDIR + one ICONDIRENTRY. PNG-compressed icon image is supported by Windows.
header = struct.pack("<HHH", 0, 1, 1)
entry = struct.pack("<BBBBHHII", SIZE, SIZE, 0, 0, 1, 32, len(png), 22)
target = Path(__file__).resolve().parents[1] / "src-tauri" / "icons" / "icon.ico"
target.parent.mkdir(parents=True, exist_ok=True)
target.write_bytes(header + entry + png)
print(f"Generated {target}")
