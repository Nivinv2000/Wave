"""Standard-library HTTP bridge. Replace policy() with your model's inference.
Start: python3 examples/python_controller.py
Dashboard: choose Python / HTTP model. Inference stays local.
"""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

def clip(x, low, high): return max(low, min(high, x))

def policy(obs):
    # Load your PyTorch / ONNX model ONCE at module initialization, not per request.
    # Preprocess obs, run inference, and map outputs to the documented command.
    deck = obs.get('deck')
    estimate = obs['estimate']
    if not deck:
        return {'mode': 'velocity', 'velocity': [0, 0, 0], 'yaw': 0, 'label': 'Waiting for deck data'}
    target = [p + v * deck['age'] for p, v in zip(deck['position'], deck['velocity'])]
    error = [p - q for p, q in zip(target, estimate['position'])]
    aligned = (error[0] ** 2 + error[1] ** 2) ** 0.5 < 0.7
    return {'mode': 'velocity', 'velocity': [clip(deck['velocity'][0] + error[0], -4, 4),
        clip(deck['velocity'][1] + error[1], -4, 4),
        deck['velocity'][2] - 0.28 if aligned else clip(deck['velocity'][2] + (error[2] + 4) * .7, -1, 1)],
        'yaw': deck['euler'][2], 'label': 'Python model: follow and land'}

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path not in ('/step', '/reset'):
            self.send_error(404); return
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if size < 0 or size > 100000: raise ValueError('Request too large')
            payload = json.loads(self.rfile.read(size) or '{}')
            result = {'ok': True} if self.path == '/reset' else policy(payload['observation'])
            body = json.dumps(result, allow_nan=False).encode()
            self.send_response(200); self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
        except Exception as exc:
            self.send_error(400, str(exc))
    def log_message(self, *_): pass

if __name__ == '__main__':
    print('Local model bridge: http://127.0.0.1:8765', flush=True)
    ThreadingHTTPServer(('127.0.0.1', 8765), Handler).serve_forever()
