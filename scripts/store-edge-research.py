"""Store and read back research through the existing governed API; never invoke EDGE."""
import copy
import hashlib
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone

BASE = 'https://edge-console.k-anirudhsaxena.workers.dev/api/edge-stocks/invoke'


def prepare(request):
    if request.get('research_only') is not True:
        raise ValueError('store-only request requires research_only=true')
    bundle = copy.deepcopy(request['research_bundle'])
    ticker = bundle.get('ticker', '')
    if not re.fullmatch(r'[A-Z0-9._&-]{1,20}', ticker) or request.get('command') != f'EDGE {ticker}' or bundle.get('command') != request['command']:
        raise ValueError('request and bundle ticker/command must match')
    if bundle.get('contract_version') != 'EDGE_RESEARCH_BUNDLE_V1' or bundle.get('research_authority') != 'CHATGPT' or 'CHATGPT_WEB' not in bundle.get('retrieval_providers', []):
        raise ValueError('governed ChatGPT V1 research required')
    # Allocate identity from actual immutable research, never from a manual placeholder.
    # Crucially, preserve all original evidence and freshness timestamps.
    if 'bundle_id' not in bundle:
        digest = hashlib.sha256(json.dumps(bundle, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
        bundle['bundle_id'] = f'edge-research-{ticker}-{digest}'
    if not re.fullmatch(r'[A-Za-z0-9._:-]{3,160}', bundle['bundle_id']):
        raise ValueError('invalid bundle identity')
    assert_fresh(bundle['research_fresh_at'])
    return bundle


def assert_fresh(timestamp):
    age = (datetime.now(timezone.utc) - datetime.fromisoformat(timestamp.replace('Z', '+00:00'))).total_seconds()
    if not -120 <= age <= 86400:
        raise ValueError('research outside existing freshness window')


def api(method, url, body=None):
    client_id = os.environ.get('CF_ACCESS_CLIENT_ID', '')
    client_secret = os.environ.get('CF_ACCESS_CLIENT_SECRET', '')
    if not client_id or not client_secret:
        raise ValueError('required service credentials unavailable')

    args = [
        'curl', '--location', '--silent', '--show-error', '--max-time', '60',
        '-H', 'Content-Type: application/json',
        '-H', 'Accept: application/json',
        '-H', f'CF-Access-Client-Id: {client_id}',
        '-H', f'CF-Access-Client-Secret: {client_secret}',
        '-X', method,
        '-w', '\\n%{http_code}',
    ]
    payload = None
    if body is not None:
        args += ['--data-binary', '@-']
        payload = json.dumps(body, ensure_ascii=False, separators=(',', ':'))
    args.append(url)

    proc = subprocess.run(args, input=payload, text=True, capture_output=True, timeout=70)
    raw = proc.stdout or ''
    body_text, sep, code_text = raw.rpartition('\n')
    try:
        status = int(code_text.strip()) if sep else 0
    except ValueError:
        status = 0
    if proc.returncode != 0 or not 200 <= status < 300:
        detail = (body_text or proc.stderr or 'no response body').strip()[:1200]
        raise ValueError(f'protected API request failed: HTTP {status or 0}: {detail}')
    try:
        decoded = json.loads(body_text)
    except json.JSONDecodeError as exc:
        raise ValueError('protected API returned invalid JSON') from exc
    if not isinstance(decoded, dict):
        raise ValueError('protected API returned non-object JSON')
    return decoded


def store(request, transport=api):
    bundle = prepare(request)
    payload = copy.deepcopy(request)
    payload['research_bundle'] = bundle
    saved = transport('POST', BASE, payload)
    if (
        saved.get('ok') is not True
        or saved.get('status') != 'READY'
        or saved.get('mode') != 'RESEARCH_ONLY'
        or saved.get('research_contract_version') != bundle['contract_version']
        or saved.get('research_bundle_id') != bundle['bundle_id']
        or saved.get('ticker') != bundle['ticker']
        or saved.get('exact_payload_readback') is not True
        or saved.get('publishing_enabled') is not False
        or saved.get('trading_enabled') is not False
    ):
        raise ValueError('governed storage did not confirm matching READY research-only identity')
    row = saved.get('research_bundle')
    if isinstance(row, str):
        row = json.loads(row)
    if row != bundle or not saved.get('payload_hash'):
        raise ValueError('immutable stored research readback mismatch')
    if datetime.fromisoformat(str(saved['research_fresh_at']).replace('Z', '+00:00')) != datetime.fromisoformat(bundle['research_fresh_at'].replace('Z', '+00:00')):
        raise ValueError('stored research timestamp mismatch')
    assert_fresh(str(saved['research_fresh_at']))
    return {
        'status': 'READY',
        'bundle_id': saved['research_bundle_id'],
        'ticker': saved['ticker'],
        'research_fresh_at': saved['research_fresh_at'],
        'payload_hash': saved['payload_hash'],
        'exact_payload_readback': True,
        'publishing_enabled': False,
        'trading_enabled': False,
    }


if __name__ == '__main__':
    result = store(json.load(open(sys.argv[1], encoding='utf-8')))
    print(json.dumps(result, sort_keys=True))
