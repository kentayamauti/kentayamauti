"""index.html・CSS・JS を1ファイルにまとめ、claude.ai の非公開ページ用HTMLを出力する。

使い方: python3 tools/build_artifact.py <出力先.html>
"""
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
html = (root / 'index.html').read_text(encoding='utf-8')
css = (root / 'css/style.css').read_text(encoding='utf-8')
js = (root / 'js/config.js').read_text(encoding='utf-8') + '\n' + (root / 'js/main.js').read_text(encoding='utf-8')

title = re.search(r'<title>(.*?)</title>', html, re.S).group(1)
fonts = re.search(r'<link href="https://fonts.googleapis.com[^>]*>', html).group(0)
body = re.search(r'<body>(.*?)</body>', html, re.S).group(1)
body = re.sub(r'\s*<script src="[^"]*"></script>', '', body)

out = f'''<title>{title}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
{fonts}
<style>
{css}
</style>
{body.strip()}
<script>
{js}
</script>
'''
Path(sys.argv[1]).write_text(out, encoding='utf-8')
print(f'wrote {sys.argv[1]} ({len(out.encode())} bytes)')
