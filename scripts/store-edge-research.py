"""Store and read back research through the existing governed API; never invoke EDGE."""
import copy
import hashlib
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone

BASE = 'https://edge-console.k-anirudhsaxena.workers.dev/api/edge-stocks/research-bundles'


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


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('protected API redirected; refusing credential forwarding')


def api(method, url, body=None):
    headers = {'Content-Type': 'application/json',
               'CF-Access-Client-Id': os.environ['CF_ACCESS_CLIENT_ID'],
               'CF-Access-Client-Secret': os.environ['CF_ACCESS_CLIENT_SECRET']}
    if not all(headers.values()):
        raise ValueError('required service credentials unavailable')
    data = None if body is None else json.dumps(body, ensure_ascii=False, separators=(',', ':')).encode()
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=60) as response:
        return json.load(response)


def store(request, transport=api):
    bundle = prepare(request)
    saved = transport('POST', BASE, bundle)
    if saved.get('ok') is not True or saved.get('status') != 'READY' or saved.get('contract_version') != bundle['contract_version'] or saved.get('bundle_id') != bundle['bundle_id']:
        raise ValueError('governed storage did not confirm matching READY identity')
    row = transport('GET', BASE + '/' + bundle['bundle_id']).get('research_bundle', {})
    payload = row.get('payload')
    if isinstance(payload, str):
        payload = json.loads(payload)
    if payload != bundle or any(row.get(key) != bundle[key] for key in ('bundle_id', 'ticker', 'contract_version', 'research_authority')) or row.get('status') != 'READY' or not row.get('payload_hash'):
        raise ValueError('immutable stored research readback mismatch')
    for key in ('created_at', 'research_fresh_at'):
        if datetime.fromisoformat(row[key].replace('Z', '+00:00')) != datetime.fromisoformat(bundle[key].replace('Z', '+00:00')):
            raise ValueError('stored research timestamp mismatch')
    assert_fresh(row['research_fresh_at'])
    return {'status': 'READY', 'bundle_id': row['bundle_id'], 'ticker': row['ticker'],
            'research_fresh_at': row['research_fresh_at'], 'payload_hash': row['payload_hash'],
            'exact_payload_readback': True, 'publishing_enabled': False, 'trading_enabled': False}


if __name__ == '__main__':
    result = store(json.load(open(sys.argv[1], encoding='utf-8')))
    print(json.dumps(result, sort_keys=True))
