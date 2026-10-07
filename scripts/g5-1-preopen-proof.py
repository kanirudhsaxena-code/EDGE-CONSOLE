#!/usr/bin/env python3
"""Persisted live-session proof for governed G5.1 pre-open acceptance.

The 09:20 IST workflow does not infer exchange state from weekday/date.
It asks the production governed market-calendar endpoint, whose authority order is:
exact provider session proof -> verified persisted year cache -> bootstrap fallback.

Known closed or non-standard sessions are clean no-ops. Missing calendar authority
fails closed. A trading-day proof always uses persisted production timestamps.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import date, datetime, time, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
from urllib.parse import quote

BASE=os.environ.get("CONSOLE_URL","https://edge-console.k-anirudhsaxena.workers.dev").rstrip("/")
CLIENT_ID=os.environ.get("CF_ACCESS_CLIENT_ID","")
CLIENT_SECRET=os.environ.get("CF_ACCESS_CLIENT_SECRET","")
IST=ZoneInfo("Asia/Kolkata")
TARGET=os.environ.get("TARGET_DATE_IST") or datetime.now(IST).date().isoformat()
TARGET_DATE=date.fromisoformat(TARGET)


def now_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00","Z")


def api(path):
    if not CLIENT_ID or not CLIENT_SECRET:
        raise RuntimeError("Cloudflare Access service credentials are required")
    args=[
        "curl","--location","--silent","--show-error","--max-time","90",
        "-H",f"CF-Access-Client-Id: {CLIENT_ID}",
        "-H",f"CF-Access-Client-Secret: {CLIENT_SECRET}",
        "-H","Accept: application/json",
        "-w","\n%{http_code}",BASE+path
    ]
    proc=subprocess.run(args,text=True,capture_output=True,timeout=105)
    body_text,sep,code_text=(proc.stdout or "").rpartition("\n")
    try: code=int(code_text.strip()) if sep else 0
    except ValueError: code=0
    try: body=json.loads(body_text) if body_text.strip() else {}
    except Exception: body={"_raw":body_text[:1200]}
    return code,body,(proc.stderr or "")[:800]


def require(ok,msg,data=None):
    if not ok:
        tail=(" :: "+json.dumps(data,default=str)[:1800]) if data is not None else ""
        raise AssertionError(msg+tail)


def parse(value):
    return datetime.fromisoformat(str(value).replace("Z","+00:00"))


def in_preopen(value,cutoff=time(9,15)):
    local=parse(value).astimezone(IST)
    return local.date().isoformat()==TARGET and time(9,10) <= local.time().replace(tzinfo=None) < cutoff


def write_and_print(proof,summary):
    Path("/tmp/g5-1-preopen-proof.json").write_text(
        json.dumps(proof,indent=2,sort_keys=True,default=str)+"\n",encoding="utf-8"
    )
    print(json.dumps(summary,indent=2,default=str))


def main():
    proof={
        "schema":"MDOS_G5_1_PREOPEN_PROOF_V3_DYNAMIC_CALENDAR",
        "target_date_ist":TARGET,
        "generated_at":now_iso(),
        "calendar":{},
        "point_12":{"status":"PENDING"},
        "nifty":{},
        "stocks":{},
        "errors":[],
    }

    code,calendar,err=api(f"/api/market-calendar/session?date={quote(TARGET)}")
    session_state=str(calendar.get("session_state") or "CALENDAR_COVERAGE_MISSING")
    proof["calendar"]={
        "status_code":code,
        "session_state":session_state,
        "preopen_eligible":calendar.get("preopen_eligible"),
        "authority":calendar.get("authority"),
        "source_ref":calendar.get("source_ref"),
        "acquired_at":calendar.get("acquired_at"),
        "market_open_at":calendar.get("market_open_at"),
        "market_close_at":calendar.get("market_close_at"),
        "cache_age_hours":calendar.get("cache_age_hours"),
        "calendar_schema":calendar.get("calendar_schema"),
        "previous_trading_session":calendar.get("previous_trading_session"),
    }

    if code!=200 or session_state=="CALENDAR_COVERAGE_MISSING":
        proof["point_12"]={
            "status":"CALENDAR_COVERAGE_MISSING",
            "verification_required":False,
            "canonical_expected":False,
            "checked_at":now_iso(),
        }
        proof["errors"].append({
            "task":"CALENDAR",
            "error":"Governed production NSE session authority is unavailable",
            "detail":{"code":code,"body":calendar,"stderr":err},
        })
        write_and_print(proof,{"point_12":proof["point_12"],"errors":proof["errors"]})
        return 1

    if session_state in {"WEEKEND","TRADING_HOLIDAY"}:
        proof["point_12"]={
            "status":"NON_TRADING_DAY",
            "session_state":session_state,
            "verification_required":False,
            "canonical_expected":False,
            "checked_at":now_iso(),
        }
        write_and_print(proof,{"point_12":proof["point_12"],"errors":[]})
        return 0

    if session_state=="SPECIAL_TIMING":
        proof["point_12"]={
            "status":"NON_STANDARD_SESSION",
            "session_state":session_state,
            "verification_required":False,
            "canonical_expected":False,
            "checked_at":now_iso(),
        }
        write_and_print(proof,{"point_12":proof["point_12"],"errors":[]})
        return 0

    if session_state!="TRADING_DAY" or calendar.get("preopen_eligible") is not True:
        proof["errors"].append({
            "task":"CALENDAR",
            "error":"Trading-day session is not eligible for the standard NSE pre-open window",
            "detail":calendar,
        })
        proof["point_12"]={
            "status":"FAIL",
            "session_state":session_state,
            "verification_required":False,
            "canonical_expected":False,
            "checked_at":now_iso(),
        }
        write_and_print(proof,{"point_12":proof["point_12"],"errors":proof["errors"]})
        return 1

    local=datetime.now(IST)
    if local.date()<TARGET_DATE or (local.date()==TARGET_DATE and local.time().replace(tzinfo=None)<time(9,15)):
        proof["point_12"]={
            "status":"NOT_DUE",
            "session_state":"TRADING_DAY",
            "verification_required":True,
            "observed_at_ist":local.isoformat(),
        }
        write_and_print(proof,{"point_12":proof["point_12"],"errors":[]})
        return 0

    prior_session=str(calendar.get("previous_trading_session") or "")
    if not prior_session:
        proof["errors"].append({"task":"CALENDAR","error":"previous governed NSE trading session is unresolved"})
        proof["point_12"]={"status":"FAIL","session_state":"TRADING_DAY","verification_required":True,"checked_at":now_iso()}
        write_and_print(proof,{"point_12":proof["point_12"],"errors":proof["errors"]})
        return 1

    try:
        code,nifty,err=api(f"/api/5dr/preopen-status?date={TARGET}")
        require(code==200,"NIFTY persisted pre-open record missing",{"code":code,"body":nifty,"stderr":err})
        require(nifty.get("status")=="COMPLETED","NIFTY scheduled pre-open run not completed",nifty)
        require(nifty.get("published") is True,"NIFTY scheduled pre-open run not published",nifty)
        require(nifty.get("canonical_attempt_key")==f"5DR:{TARGET}:PREOPEN","NIFTY canonical-attempt key mismatch",nifty)
        attempt=nifty.get("canonical_attempt") or {}
        prov=nifty.get("run_provenance") or {}
        require(attempt.get("type")=="PREOPEN_CANONICAL_ATTEMPT","NIFTY canonical-attempt type mismatch",attempt)
        require(str(attempt.get("slot") or "") in {"09:10","09:11","09:12","09:13","09:14"},"NIFTY canonical-attempt slot outside matching window",attempt)
        require(in_preopen(nifty.get("request_created_at")),"NIFTY persisted request timestamp outside 09:10-09:14 IST",nifty)
        require(prov.get("trigger_type")=="SCHEDULED","NIFTY pre-open trigger is not SCHEDULED",prov)
        require(prov.get("evidence_mode")=="PREOPEN","NIFTY pre-open evidence mode mismatch",prov)
        require(prov.get("benchmark_role")=="SESSION_PREOPEN","NIFTY pre-open benchmark role mismatch",prov)
        require(str(prov.get("target_session") or "")[:10]==TARGET,"NIFTY target session mismatch",prov)
        require(nifty.get("trading_enabled") is False,"NIFTY proof unexpectedly enables trading",nifty)
        proof["nifty"]={
            "status":"PASS","request_id":nifty.get("request_id"),"run_id":nifty.get("run_id"),
            "request_created_at":nifty.get("request_created_at"),"generated_at":nifty.get("generated_at"),
            "canonical_attempt":attempt,"run_provenance":prov,"published":True
        }
    except Exception as exc:
        proof["errors"].append({"task":"NIFTY","error":f"{type(exc).__name__}: {exc}"})

    for ticker in ("LTF","CUPID","RELIANCE"):
        try:
            code,data,err=api(f"/api/edge-stocks/preopen-status?ticker={quote(ticker)}&date={TARGET}")
            require(code==200 and data.get("status")=="PREOPEN_CANDIDATE_COMPLETE",
                    f"{ticker} persisted pre-open candidate missing",{"code":code,"body":data,"stderr":err})
            row=data.get("preopen") or {}
            require(row.get("candidate_type")=="PREOPEN_CANONICAL",f"{ticker} candidate type mismatch",row)
            require(row.get("trigger_type")=="SCHEDULED",f"{ticker} trigger type mismatch",row)
            require(row.get("evidence_mode")=="PREOPEN",f"{ticker} evidence mode mismatch",row)
            require(row.get("benchmark_role")=="SESSION_PREOPEN",f"{ticker} benchmark role mismatch",row)
            require(in_preopen(row.get("requested_at"),time(9,14,31)),f"{ticker} request time outside governed pre-open cutoff",row)
            requested=parse(row.get("requested_at"))
            completed=parse(row.get("completed_at"))
            require(completed.astimezone(IST).time().replace(tzinfo=None)<time(9,15),
                    f"{ticker} completed after 09:15 hard boundary",row)
            research=parse(row.get("research_fresh_at"))
            age=(requested-research).total_seconds()
            require(-120 <= age <= 90*60,f"{ticker} research was not fresh enough for pre-open",{"age_seconds":age,"row":row})
            require(str(row.get("target_trading_date") or "")[:10]==TARGET,f"{ticker} target trading date mismatch",row)
            require(str(row.get("market_session_as_of") or "")[:10]==prior_session,
                    f"{ticker} prior-session provenance mismatch",{"expected":prior_session,"row":row})
            require(data.get("trading_enabled") is False,f"{ticker} proof unexpectedly enables trading",data)
            proof["stocks"][ticker]={
                "status":"PASS",
                "recommendation_id":row.get("recommendation_id"),
                "canonical_key":row.get("canonical_key"),
                "requested_at":row.get("requested_at"),
                "completed_at":row.get("completed_at"),
                "research_fresh_at":row.get("research_fresh_at"),
                "candidate_type":row.get("candidate_type"),
                "trigger_type":row.get("trigger_type"),
                "evidence_mode":row.get("evidence_mode"),
                "market_session_as_of":row.get("market_session_as_of"),
                "benchmark_role":row.get("benchmark_role"),
                "canonical_selection":data.get("canonical_selection"),
            }
        except Exception as exc:
            proof["errors"].append({"task":ticker,"error":f"{type(exc).__name__}: {exc}"})

    passed=proof.get("nifty",{}).get("status")=="PASS" and all(
        proof["stocks"].get(t,{}).get("status")=="PASS" for t in ("LTF","CUPID","RELIANCE")
    )
    proof["point_12"]={
        "status":"PASS" if passed and not proof["errors"] else "FAIL",
        "session_state":"TRADING_DAY",
        "verification_required":True,
        "acceptance":"genuine persisted NSE pre-open evidence; no backdating or timing inference",
        "checked_at":now_iso(),
    }
    proof["generated_at"]=now_iso()
    write_and_print(proof,{"point_12":proof["point_12"],"errors":proof["errors"]})
    return 0 if proof["point_12"]["status"]=="PASS" else 1


if __name__=="__main__":
    sys.exit(main())
