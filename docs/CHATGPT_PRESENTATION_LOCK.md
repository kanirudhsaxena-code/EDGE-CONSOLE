# ChatGPT presentation lock — Console is the renderer

Status: production control

## Rule

For ChatGPT-triggered EDGE NIFTY and EDGE Stocks runs, ChatGPT must not reconstruct, summarize or independently format the raw engine result.

The live EDGE Console is the presentation source of truth.

The governed chat runner must:
1. complete the canonical production run;
2. open the deployed Console with an automated browser;
3. select the exact NIFTY request or stock;
4. capture the live rendered Console text from the Console DOM;
5. validate mandatory Console sections;
6. expose only that captured presentation for the ChatGPT response.

If the Console presentation cannot be captured or required sections are missing, the chat workflow fails closed. Raw engine JSON must not be used as a fallback presentation.

## Why this is permanent

The capture reads the Console DOM itself rather than maintaining a second ChatGPT template. Therefore future Console wording, section-order and presentation changes automatically flow into ChatGPT once deployed.

Visual CSS cannot be reproduced inside ChatGPT, but the rendered Console information hierarchy, labels and visible content remain the source.

## Covered paths

- EDGE NIFTY: assessment + current rendered NIFTY output.
- EDGE Stocks: the full canonical EDGE Stocks renderer, including master assessment, current stock outcome, drill-down and active calls.

This control changes presentation only. It does not modify analytical methodology, probabilities, DES, Market Trust, BOT, Decision Ladder, recommendation semantics, efficacy, persistence or Learning Lab governance.
