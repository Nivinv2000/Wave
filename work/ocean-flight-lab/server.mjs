import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.dirname(fileURLToPath(import.meta.url)),
  publicDir = path.join(root, "public");
const port = Number(process.env.PORT ?? 4180),
  host = process.env.HOST ?? "127.0.0.1";
const endpoint = new URL(process.env.MODEL_ENDPOINT ?? "http://127.0.0.1:8765");
if (
  endpoint.protocol !== "http:" ||
  !["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)
)
  throw new Error("MODEL_ENDPOINT must be an HTTP loopback service");
const types = {
  ".html": "text/html",
  ".mjs": "text/javascript",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".md": "text/markdown",
  ".txt": "text/plain",
};
const server = http.createServer(async (req, res) => {
  try {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/model/")) {
      if (req.method !== "POST") {
        res.writeHead(405);
        res.end();
        return;
      }
      const action = url.pathname.split("/").pop();
      if (!["step", "reset"].includes(action)) {
        res.writeHead(404);
        res.end();
        return;
      }
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) {
        res.writeHead(403);
        res.end("Same-origin requests only");
        return;
      }
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 100000) throw new Error("Request too large");
      }
      try {
        const response = await fetch(new URL("/" + action, endpoint), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(2000),
        });
        const text = await response.text();
        res.writeHead(response.status, { "Content-Type": "application/json" });
        res.end(text);
      } catch (error) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error:
              "Local Python model unavailable or timed out. Start examples/python_controller.py.",
            detail: error.message,
          }),
        );
      }
      return;
    }
    let file;
    if (url.pathname === "/example-controller.mjs")
      file = path.join(root, "examples/follow-and-land.mjs");
    else if (url.pathname === "/guide.md") file = path.join(root, "README.md");
    else {
      file = path.resolve(
        publicDir,
        "." +
          decodeURIComponent(
            url.pathname === "/" ? "/index.html" : url.pathname,
          ),
      );
      if (!file.startsWith(publicDir + path.sep)) {
        res.writeHead(403);
        res.end();
        return;
      }
    }
    if (url.pathname === "/controller-worker.mjs")
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; script-src 'self' blob:; connect-src 'none'",
      );
    const content = await readFile(file);
    res.writeHead(200, {
      "Content-Type": types[path.extname(file)] ?? "application/octet-stream",
    });
    res.end(content);
  } catch (error) {
    res.writeHead(error.code === "ENOENT" ? 404 : 400, {
      "Content-Type": "text/plain",
    });
    res.end(error.code === "ENOENT" ? "Not found" : error.message);
  }
});
server.listen(port, host, () =>
  console.log(`Ocean Flight Lab: http://${host}:${port}`),
);
