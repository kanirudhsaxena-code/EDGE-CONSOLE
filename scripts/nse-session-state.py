#!/usr/bin/env python3
"""Resolve governed NSE session state for CI/acceptance workflows."""
from __future__ import annotations
import argparse
import json
from datetime import datetime, time
from pathlib import Path
from zoneinfo import ZoneInfo

IST=ZoneInfo("Asia/Kolkata")
ROOT=Path(__file__).resolve().parents[1]
CALENDAR=json.loads((ROOT/"config"/"nse-trading-calendar.json").read_text(encoding="utf-8"))
COVERAGE={int(x) for x in CALENDAR.get("coverage_years",[])}
HOLIDAYS={str(x) for x in CALENDAR.get("trading_holidays",[])}


def parse_at(value:str|None)->datetime:
    if not value:
        return datetime.now(IST)
    parsed=datetime.fromisoformat(value.replace("Z","+00:00"))
    if parsed.tzinfo is None:
        parsed=parsed.replace(tzinfo=IST)
    return parsed.astimezone(IST)


def classify(day_iso:str,weekday:int)->str:
    if weekday>=5:
        return "WEEKEND"
    year=int(day_iso[:4])
    if year not in COVERAGE:
        return "CALENDAR_COVERAGE_MISSING"
    if day_iso in HOLIDAYS:
        return "TRADING_HOLIDAY"
    return "TRADING_DAY"


def main()->int:
    parser=argparse.ArgumentParser()
    parser.add_argument("--at",default=None,help="Optional ISO timestamp for deterministic checks")
    args=parser.parse_args()
    now=parse_at(args.at)
    day=now.date().isoformat()
    session_state=classify(day,now.weekday())
    clock=now.time().replace(tzinfo=None)
    live=session_state=="TRADING_DAY" and time(9,15) <= clock < time(15,30)
    payload={
        "schema":"NSE_SESSION_STATE_V1",
        "as_of_ist":now.isoformat(),
        "date_ist":day,
        "session_state":session_state,
        "market_phase":"LIVE_INTRADAY" if live else "CLOSED_SESSION",
        "expected_live_market_data":live,
        "calendar_schema":CALENDAR.get("schema"),
        "calendar_coverage_years":sorted(COVERAGE),
    }
    print(json.dumps(payload,sort_keys=True))
    return 2 if session_state=="CALENDAR_COVERAGE_MISSING" else 0


if __name__=="__main__":
    raise SystemExit(main())
