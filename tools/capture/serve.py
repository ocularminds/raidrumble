"""Preview the real transparent overlay over an original, labeled demo backdrop."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from shutil import copyfile
from urllib.parse import quote


class CaptureScene:
    def __init__(self, root: Path, host: str):
        self.folder = root / "artifacts" / "scene"
        self.folder.mkdir(parents=True, exist_ok=True)
        copyfile(root / "artifacts" / "stage.png", self.folder / "stage.png")
        url = "http://localhost:5173/overlay/" + quote(host, safe="")
        self.document = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>RaidRumble · Original demo backdrop</title>
<style>
:root{{color-scheme:dark}}
html,body{{margin:0;width:100%;height:100%;overflow:hidden;background:#10221f}}
body{{display:grid;place-items:center}}
main{{position:relative;width:min(100vw,calc(100vh * 16 / 9));aspect-ratio:16 / 9;
background:url('/stage.png') center / contain no-repeat}}
iframe{{position:absolute;inset:0;border:0;width:100%;height:100%;background:transparent}}
</style></head><body><main aria-label="Original demo backdrop; no gameplay shown">
<iframe title="Live RaidRumble overlay" src="{url}"></iframe>
</main></body></html>"""

    def serve(self, port: int):
        (self.folder / "index.html").write_text(self.document)
        handler = partial(SimpleHTTPRequestHandler, directory=str(self.folder))
        server = ThreadingHTTPServer(("127.0.0.1", port), handler)
        print(f"Capture preview: http://localhost:{port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="demo")
    parser.add_argument("--port", type=int, default=5180)
    args = parser.parse_args()
    CaptureScene(Path(__file__).resolve().parents[2], args.host).serve(args.port)


if __name__ == "__main__":
    main()
