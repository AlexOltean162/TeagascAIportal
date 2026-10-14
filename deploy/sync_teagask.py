"""Copy the Teag-Ask interface into the portal so it runs at /aiportal/teagask/.

    python deploy/sync_teagask.py [path to TeagAsk_Azure/app/frontend-dist]

Teag-Ask's prebuilt UI calls /api/... and /assets/... from the site root. Under the portal it is served
from a sub-folder, with /aiportal/teagask/api/ proxied to the self-hosted Teag-Ask app
(deploy/nginx-assistants.conf), so this script copies only the files index.html uses and rewrites those
paths to relative ones. The self-hosted app runs without APP_ACCESS_KEY, so the copy also saves a
placeholder key before the UI starts: the UI then skips its access screen, and the backend accepts any key.

It also adds deploy/teagask-overlay/: a link back to the AI Portal, and it hides the dark mode button (the
theme follows the portal's setting) and the usage-limits control (the self-hosted app has no daily limit).

Re-run it after every Teag-Ask UI change. If a rewrite no longer matches (a new build changed the code
around it), the script stops instead of copying a broken UI.
"""

import re
import shutil
import sys
from pathlib import Path

PORTAL = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = Path.home() / "Desktop" / "TeagAsk_Azure" / "app" / "frontend-dist"
TARGET = PORTAL / "teagask"

OVERLAY = PORTAL / "deploy" / "teagask-overlay"

# Runs before the UI: skip the access screen and use the portal's theme (stored by theme.js).
PORTAL_HEAD = (
    '<head>\n    <script>try { if (!localStorage.getItem("teagask-preprod-access-key")) '
    'localStorage.setItem("teagask-preprod-access-key", "portal"); '
    'localStorage.setItem("teagask-theme", localStorage.getItem("teagasc-ai-theme") === "dark" ? "dark" : "light"); '
    '} catch (e) {}</script>'
)
PORTAL_ASSETS = (
    '    <script src="assets/teag-ask-portal.js" defer></script>\n'
    '    <link rel="stylesheet" href="assets/teag-ask-portal.css">\n  </head>'
)

# (file pattern, old, new): each must match at least once in its file.
REWRITES = [
    ("index.html", "<head>", PORTAL_HEAD),
    ("index.html", "  </head>", PORTAL_ASSETS),
    ("index.html", '"/assets/', '"assets/'),
    ("assets/index-*.js", '"/api/access"', '"api/access"'),
    # Show the access screen only when the backend rejects the key, not when it is unreachable.
    ("assets/index-*.js", 'cache:"no-store"});if(l.ok)return;', 'cache:"no-store"});if(l.status!==401)return;'),
    ("assets/index-*.js", '"/api/chat/stream"', '"api/chat/stream"'),
    ("assets/index-*.js", '"/assets/teagasc-logo.png"', '"assets/teagasc-logo.png"'),
    ("assets/teag-ask-ui.js", "path === '/api/access'", "path.endsWith('/api/access')"),
    ("assets/teag-ask-ui.js", r"!/^\/api\/chat(\/stream)?$/.test(path)", r"!/\/api\/chat(\/stream)?$/.test(path)"),
    ("assets/teag-ask-ui.js", "origFetch('/api/feedback'", "origFetch('api/feedback'"),
    ("assets/teag-ask-voice.js", "fetch('/api/transcribe'", "fetch('api/transcribe'"),
    ("assets/teag-ask-attach.js", "fetch('/api/attachments/extract'", "fetch('api/attachments/extract'"),
    ("assets/teag-ask-attach.js", "(path === '/api/chat/stream' || path === '/api/chat')", r"/\/api\/chat(\/stream)?$/.test(path)"),
]


def main() -> None:
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SOURCE
    index = (source / "index.html").read_text(encoding="utf-8")
    used = sorted(set(re.findall(r'"/(assets/[^"?]+)', index)) | {"assets/teagasc-logo.png"})

    if TARGET.exists():
        shutil.rmtree(TARGET)
    (TARGET / "assets").mkdir(parents=True)
    shutil.copy2(source / "index.html", TARGET / "index.html")
    for rel in used:
        shutil.copy2(source / rel, TARGET / rel)
    for extra in OVERLAY.iterdir():
        shutil.copy2(extra, TARGET / "assets" / extra.name)

    for pattern, old, new in REWRITES:
        files = list(TARGET.glob(pattern))
        hits = 0
        for path in files:
            text = path.read_text(encoding="utf-8")
            hits += text.count(old)
            path.write_text(text.replace(old, new), encoding="utf-8", newline="")
        if not hits:
            sys.exit(f"Rewrite did not match in {pattern}: {old!r}. Check the new Teag-Ask build before syncing.")

    print(f"Copied {len(used) + 1} files from {source} to {TARGET}")


if __name__ == "__main__":
    main()
