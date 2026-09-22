# EDGE / 5DR Master Specification Conformance Register

Status: **release control**  
Authority: Drive canonical specifications and frozen/additive amendments.  
Rule: code, persistence, API, Console and ChatGPT may not redefine a frozen master requirement.

| ID | Module | Master requirement | Execution / persistence | API / Console | CI control | Repair status |
|---|---|---|---|---|---|---|
| N-01 | EDGE NIFTY | Overall Bull/Range/Bear probabilities total 100% | 5DR probability engine | `result.probabilities` | 5DR contract validation | ENFORCED |
| N-02 | EDGE NIFTY | Definitive 5-day forecast is highest-probability scenario | deterministic composition | `definitive_forecast` headline | 5DR contract validation | ENFORCED |
| N-03 | EDGE NIFTY | D through D+4 each carry Bull/Range/Bear = 100% | normalization + engine + release + daily_forecasts | daily scenario cards | intelligence/output/sync tests | ENFORCED |
| N-04 | EDGE NIFTY | Daily selected direction equals highest daily scenario probability | normalization + engine + DB constraint | daily scenario cards | intelligence/output/sync tests | ENFORCED |
| N-05 | EDGE NIFTY | Overall expected NIFTY zone explicit | runner + persisted forecast | current-run card | output contract | ENFORCED |
| N-06 | EDGE NIFTY | Event Shock level/transmission/convexity/kill switch explicit | runner/result | current-run card | output contract | ENFORCED |
| N-07 | EDGE NIFTY | DES5 remains directional evidence score, separate from probability forecast | deterministic engine | DES5 card + breakdown | UI + contract tests | ENFORCED |
| N-08 | EDGE NIFTY | Market Trust uses six frozen inputs and bands | deterministic engine | Trust card + six-input breakdown | UI tests | ENFORCED |
| N-09 | EDGE NIFTY | Execution Edge uses five frozen factors | deterministic engine | Edge card + five-factor breakdown | UI tests | ENFORCED |
| N-10 | EDGE NIFTY | Six Single Tradeability Gate checks are explicit | runner gate record | pass/fail checklist | UI + output tests | ENFORCED |
| N-11 | EDGE NIFTY | Forecast Assessment substantive and mandatory | release assembler | assessment card | published-release validation | ENFORCED |
| N-12 | EDGE NIFTY | Recommendation Assessment substantive and mandatory | release assembler | assessment card | published-release validation | ENFORCED |
| N-13 | EDGE NIFTY | Assessment snapshot + recommendation ledger complete before publish | release context + output contract | Assessment · Till Date | release validation | ENFORCED |
| N-14 | EDGE NIFTY | Mandatory efficacy includes per-horizon accuracy/zone/margin/error and Brier where scorable | canonical ledger / rollups | Assessment drill-down | assessment UI tests | ENFORCED / legacy may be NOT SCORABLE |
| N-15 | EDGE NIFTY | Historical missing scenario vectors are never reconstructed | immutable legacy rows | Legacy incomplete / Not scorable | sync + UI tests | ENFORCED |
| N-16 | EDGE NIFTY | Detailed explanation = What we saw → What it means → Why it matters now | governed evidence only | full-analysis cards | UI tests | ENFORCED |
| S-01 | EDGE Stocks | Presentation order = Master Assessment → Active Calls → Current Outcome → Drill-down | V1.3 contract | same order | schema/validator/renderer tests | ENFORCED |
| S-02 | EDGE Stocks | DES -100..100 and component raw scores -2..+2 retained | frozen engine + component_scores | metric cards + drill-down | validator/renderer tests | ENFORCED |
| S-03 | EDGE Stocks | Bull/Base/Bear total 100%; winner is definitive forecast | frozen engine | probability cards + direction | validator | ENFORCED |
| S-04 | EDGE Stocks | Five Market Trust subscores and weights visible | market_trust persistence | expandable breakdown | V1.3 validator | ENFORCED |
| S-05 | EDGE Stocks | Six BOT subscores and weights visible | bot_scores persistence | expandable breakdown | V1.3 validator | ENFORCED |
| S-06 | EDGE Stocks | Directional Agreement + Effective Conviction explicit | frozen engine / report | metric breakdown | V1.3 validator | ENFORCED |
| S-07 | EDGE Stocks | Component original/normalized weight and contribution retained | component_scores persistence | drill-down metrics | V1.3 validator | ENFORCED |
| S-08 | EDGE Stocks | Evidence quality, verification and conflict state explicit | component_scores / research governance | drill-down chips | V1.3 validator | ENFORCED |
| S-09 | EDGE Stocks | Decision Ladder meaning visible | frozen decision engine | ladder legend | renderer tests | ENFORCED |
| S-10 | EDGE Stocks | Execution plan remains declarative; no-trade remains explicit | frozen execution engine | execution card | renderer tests | ENFORCED |
| S-11 | EDGE Stocks | Master efficacy keeps official vs provisional populations separate | efficacy views | Master Assessment | validator/renderer tests | ENFORCED |
| X-01 | Cross-channel | ChatGPT uses live Console presentation, not a second template | governed chat runner | DOM capture | chat render-lock CI | ENFORCED |
| X-02 | Governance | Missing required fields fail closed; UI does not invent values | validators/release gates | Not available / legacy incomplete | contract tests | ENFORCED |
| X-03 | Governance | Visual design changes cannot redefine analytical contract | contract precedes renderer | existing cards/typography retained | conformance tests | ENFORCED |

## Release rule

A production merge is blocked if any mandatory row above regresses from ENFORCED. Historical rows remain immutable; absent legacy fields are labelled NOT AVAILABLE / LEGACY INCOMPLETE / NOT SCORABLE instead of being reconstructed.

## Verification sequence

1. Static contract and unit tests.
2. Database migration validation.
3. Shadow NIFTY run: evidence → normalization → engine → release → persistence → Console.
4. Shadow EDGE Stocks report against an existing canonical record.
5. Console DOM conformance on desktop/mobile dimensions.
6. ChatGPT capture must match the live Console hierarchy and content.
7. Only then production merge/cutover.
