#!/usr/bin/env python3
"""Inline src/* into a single self-contained index.html."""
import pathlib, re, base64

root = pathlib.Path(__file__).parent
src = root / 'src'
html = (src / 'index.html').read_text()
css = (src / 'style.css').read_text()
app = (src / 'app.js').read_text()
mqtt = (root / 'mqtt.min.js').read_text()

font = root / 'jetbrains.woff2'
b64 = base64.b64encode(font.read_bytes()).decode()
face = ("@font-face{font-family:'JetBrains Mono';font-style:normal;"
        "font-weight:100 800;font-display:block;"
        "src:url(data:font/woff2;base64," + b64 + ") format('woff2')}\n")
css = face + css

html = html.replace('<link rel="stylesheet" href="style.css">',
                    '<style>\n' + css + '\n</style>')
html = html.replace('<script src="mqtt.min.js"></script>',
                    '<script>\n' + mqtt + '\n</script>')
html = html.replace('<script src="app.js"></script>',
                    '<script>\n' + app + '\n</script>')

out = root / 'index.html'
out.write_text(html)
print('wrote', out, f'{len(html)/1024:.0f} KB')
