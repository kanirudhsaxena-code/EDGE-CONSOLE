import copy
import importlib.util
import unittest
from datetime import datetime, timezone, timedelta
from pathlib import Path
spec = importlib.util.spec_from_file_location('store_research', Path(__file__).with_name('store-edge-research.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class StoreTests(unittest.TestCase):
    def request(self):
        now = datetime.now(timezone.utc).isoformat()
        return {'research_only': True, 'command': 'EDGE LTF', 'research_bundle': {
            'contract_version': 'EDGE_RESEARCH_BUNDLE_V1', 'ticker': 'LTF', 'command': 'EDGE LTF',
            'research_authority': 'CHATGPT', 'retrieval_providers': ['CHATGPT_WEB'],
            'created_at': now, 'research_fresh_at': now, 'sources': [], 'claims': [], 'limitations': []}}

    def test_id_allocation_preserves_research_and_is_deterministic(self):
        request = self.request()
        before = copy.deepcopy(request)
        first = m.prepare(request)
        self.assertEqual(first, m.prepare(request))
        self.assertEqual(request, before)
        first.pop('bundle_id')
        self.assertEqual(first, request['research_bundle'])

    def test_stale_research_not_retimestamped(self):
        request = self.request()
        request['research_bundle']['research_fresh_at'] = (datetime.now(timezone.utc)-timedelta(days=2)).isoformat()
        with self.assertRaises(ValueError): m.prepare(request)

    def test_mismatch_and_non_boolean_mode_rejected(self):
        for change in ({'command': 'EDGE CUPID'}, {'research_only': 'true'}):
            with self.assertRaises(ValueError): m.prepare(self.request() | change)

    def transport(self, mutate=None):
        calls = []
        def fake(method, url, body=None):
            calls.append((method, url))
            if method != 'POST':
                raise AssertionError('store-only path must use one POST')
            bundle = copy.deepcopy(body['research_bundle'])
            response = {
                'ok': True,
                'status': 'READY',
                'mode': 'RESEARCH_ONLY',
                'research_contract_version': bundle['contract_version'],
                'research_bundle_id': bundle['bundle_id'],
                'ticker': bundle['ticker'],
                'research_fresh_at': bundle['research_fresh_at'],
                'payload_hash': 'test-hash',
                'research_bundle': bundle,
                'exact_payload_readback': True,
                'publishing_enabled': False,
                'trading_enabled': False,
            }
            if mutate: mutate(response)
            return response
        return fake, calls

    def test_store_only_requires_exact_readback_and_never_dispatches(self):
        fake, calls = self.transport()
        result = m.store(self.request(), fake)
        self.assertTrue(result['exact_payload_readback'])
        self.assertFalse(result['publishing_enabled'])
        self.assertFalse(result['trading_enabled'])
        self.assertEqual([x[0] for x in calls], ['POST'])
        self.assertTrue(all(x[1].endswith('/api/edge-stocks/invoke') for x in calls))

    def test_readback_tampering_fails_closed(self):
        for mutate in (
            lambda r: r.update(status='BLOCKED'),
            lambda r: r['research_bundle'].update(claims=['tampered']),
            lambda r: r.update(ticker='CUPID'),
            lambda r: r.update(mode='DISPATCHED'),
            lambda r: r.update(exact_payload_readback=False),
            lambda r: r.update(publishing_enabled=True),
            lambda r: r.update(trading_enabled=True),
        ):
            fake, _ = self.transport(mutate)
            with self.assertRaises(ValueError): m.store(self.request(), fake)

    def test_server_rejection_is_not_ready(self):
        with self.assertRaises(ValueError):
            m.store(self.request(), lambda *args: {'ok': False, 'status': 'BLOCKED'})

if __name__ == '__main__': unittest.main()
