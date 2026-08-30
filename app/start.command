#!/bin/bash
# PrintHour — local launcher
# Serves THIS folder on the first free port and opens it in your browser.

cd "$(dirname "$0")" || exit 1

echo "PrintHour"
echo "Folder: $(pwd)"
echo

die() {
  echo
  echo "PROBLEM: $1"
  echo
  echo "Press any key to close."
  read -r -n 1
  exit 1
}

[ -f "index.html" ] || die "index.html is not in this folder.
Keep start.command, index.html and the vendor folder together."
[ -f "vendor/sql-wasm.wasm" ] || die "The vendor folder is missing or incomplete.
It must sit next to index.html and contain sql-wasm.js and sql-wasm.wasm."

if command -v python3 >/dev/null 2>&1; then
  exec python3 - <<'PY'
import http.server, socketserver, mimetypes, os, sys, threading, subprocess, time

mimetypes.add_type('application/wasm', '.wasm')
mimetypes.add_type('application/vnd.sqlite3', '.sqlite')

class Handler(http.server.SimpleHTTPRequestHandler):
    # A replaced index.html must actually reach the browser.
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()

    def log_message(self, fmt, *args):
        code = str(args[1]) if len(args) > 1 else ''
        if code.startswith('4') or code.startswith('5'):
            sys.stderr.write("  not found: %s\n" % (args[0],))

server = None
for port in range(8777, 8790):
    try:
        socketserver.TCPServer.allow_reuse_address = False
        server = socketserver.TCPServer(('127.0.0.1', port), Handler)
        break
    except OSError:
        print("Port %d is busy (an older session, probably) - trying the next one." % port)

if server is None:
    print("\nPROBLEM: ports 8777-8789 are all in use.")
    print("Close any old Terminal windows running this app, then try again.")
    input("\nPress return to close.")
    sys.exit(1)

url = "http://localhost:%d/index.html" % port
print("\nServing this folder on port %d" % port)
print("If the browser does not open, use: %s" % url)
print("\nKeep this window open while you work. Close it to stop the server.\n")

threading.Thread(target=lambda: (time.sleep(1), subprocess.call(['open', url])), daemon=True).start()
try:
    server.serve_forever()
except KeyboardInterrupt:
    print("\nStopped.")
PY
elif command -v php >/dev/null 2>&1; then
  echo "Serving with php on http://localhost:8777/index.html"
  ( sleep 1; open "http://localhost:8777/index.html" ) &
  exec php -S 127.0.0.1:8777
elif command -v npx >/dev/null 2>&1; then
  ( sleep 2; open "http://localhost:8777/index.html" ) &
  exec npx --yes serve -l 8777 .
else
  die "No local web server found on this Mac.
Install Apple's command line tools once, then try again:
    xcode-select --install"
fi
