# The Last Safe Second — local server

This small Node server serves the files in `public/` and exposes one endpoint that sends simulator screenshots to Anthropic's Messages API. It defaults to `claude-opus-5-5` and allows a controlled comparison with `claude-opus-5`.

## Requirements

- Node.js 20 or newer
- An Anthropic API key available to the server process as `ANTHROPIC_API_KEY`
- The browser simulator files under `public/` (the server serves `public/index.html` at `/`)

The server uses only Node's built-in modules. It does not need an npm install or `package.json`.

## Start

Set `ANTHROPIC_API_KEY` in the shell or hosting environment without putting the value in a file, source control, browser code, or chat. Then run:

```sh
node server.mjs
```

By default it listens on `http://127.0.0.1:4178`. To choose a port or make it reachable behind a trusted hosting proxy, set `PORT` and `HOST` in the server environment. For example, a platform that requires binding to all interfaces can use `HOST=0.0.0.0`. Put public deployments behind HTTPS and the host's access controls; the in-memory request limit is only a basic abuse limit, not user authentication.

## API

`POST /api/analyze` accepts JSON in this shape:

```json
{
  "images": ["data:image/png;base64,..."],
  "seed": 17,
  "model": "claude-opus-5-5"
}
```

`model` is optional and is restricted to `claude-opus-5-5` or `claude-opus-5`; it defaults to `claude-opus-5-5`. This allows a same-case comparison between current Opus 5.5 and legacy Opus 5. The endpoint accepts 1–6 PNG data URLs, up to 2 MB per image and 8 MB decoded in total. Images must be at most 4096 pixels on either side and 12 megapixels. The full JSON body is capped at 10 MB. The seed must be an integer from 0 through 4294967295.

The server sends the fixed simulator-analysis prompt and images to Anthropic. It asks Opus to return strict JSON with `abortAt`, `evidence`, and `reason`. The response includes the model identifier:

```json
{
  "abortAt": 2.4,
  "evidence": "The plotted gap is closing and relative vertical speed is increasing.",
  "reason": "This is the latest conservative abort time visible in the provided run.",
  "model": "claude-opus-5-5"
}
```

The simulator must independently score `abortAt` against the full seeded run. The model sees only the supplied images and is instructed not to infer future/oracle state from the seed. Its estimate is not a safety guarantee.

## Privacy and limits

- The API key is read only from the server process environment and is never returned to the browser or written to disk.
- The server does not log or persist the request, image data, API key, or model response.
- The server allows at most 20 analysis requests per minute per client address and four concurrent model calls in one process. It does not enable cross-origin browser access.
- Submitted images are sent to Anthropic for analysis. Do not upload sensitive imagery.
- This is a synthetic simulator demonstration. It does not control a real drone, validate a real landing, or certify flight safety.
