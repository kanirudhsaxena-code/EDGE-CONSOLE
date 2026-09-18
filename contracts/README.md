# Output Contracts

- `edge-stocks-output.schema.json` — legacy EDGE Stocks V1.1 contract retained for compatibility/history.
- `edge-stocks-output-v1.2.schema.json` — canonical contract for all new standard `EDGE <stock>` outputs.

V1.2 enforces exactly two standard user-facing tables, mandatory governed decision fields, exact Bull/Base/Bear normalization, explicit verification states, and strict OFFICIAL versus PROVISIONAL efficacy separation.

Breaking changes require a new contract version. V1.1 must not be silently rewritten to mean V1.2.
