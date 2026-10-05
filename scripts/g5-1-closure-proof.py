#!/usr/bin/env python3
"""Live production G5.1/V2 closure proof.

Exercises the real production paths without injecting research:
- NIFTY: fresh market acquisition -> 8-dimension system research -> reconciliation -> 5DR execution
- Stocks: fresh immutable DATA -> EDGE_SYSTEM V2 web research -> compute -> persistence -> V1.3 user output
The proof fails closed on missing lineage, incomplete research or presentation drift.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

BASE=os.environ.get("CONSOLE_URL","https://edge-console.k-anirudhsaxena.workers.dev").rstrip("/")
CLIENT_ID=os.environ.get("CF_ACCESS_CLIENT_ID","")
CLIENT_SECRET=os.environ.get("CF_ACCESS_CLIENT_SECRET","")
IST=ZoneInfo("Asia/Kolkata")
STOCKS=("LTF","CUPID","RELIANCE")
STOCK_RESEARCH_CATEGORIES={
    "BUSINESS_FUNDAMENTALS","INSTITUTIONAL_BEHAVIOUR",
    "NEWS_EVENTS_CATALYSTS","VALUATION","EVENT_SHOCK"
}
NIFTY_RESEARCH_DIMENSIONS={
    "GLOBAL_MARKET_REGIME","MACRO_RATES_FX","COMMODITIES_CROSS_ASSET",
    "INSTITUTIONAL_FLOWS","BREADTH_SECTOR_LEADERSHIP","DERIVATIVES_VOLATILITY",
    "NEWS_CATALYSTS","EVENT_SHOCK"
}


def now_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00","Z")


def api(method,path,payload=None,max_time=120):
    if not CLIENT_ID or not CLIENT_SECRET:
        raise RuntimeError("Cloudflare Access service credentials are required")
    url=path if path.startswith("http") else BASE+path
    args=[
        "curl","--location","--silent","--show-error","--max-time",str(max_time),
        "-H",f"CF-Access-Client-Id: {CLIENT_ID}",
        "-H",f"CF-Access-Client-Secret: {CLIENT_SECRET}",
        "-H","Accept: application/json",
        "-H","Content-Type: application/json",
        "-X",method,
        "-w","\\n%{http_code}",
    ]
    stdin=None
    if payload is not None:
        args += ["--data-binary","@-"]
        stdin=json.dumps(payload,separators=(",",":"))
    args.append(url)
    proc=subprocess.run(args,input=stdin,text=True,capture_output=True,timeout=max_time+15)
    raw=proc.stdout or ""
    body_text,sep,code_text=raw.rpartition("\n")
    try:
        code=int(code_text.strip()) if sep else 0
    except ValueError:
        code=0
    try:
        body=json.loads(body_text) if body_text.strip() else {}
    except Exception:
        body={"_raw":body_text[:1600]}
    return code,body,(proc.stderr or "").strip()[:1000]


def require(condition,message,data=None):
    if not condition:
        suffix=f" :: {json.dumps(data,default=str)[:2400]}" if data is not None else ""
        raise AssertionError(message+suffix)


def parse_time(value):
    if not value:
        return None
    return datetime.fromisoformat(str(value).replace("Z","+00:00"))


def validate_smoke(proof):
    code,health,_=api("GET","/api/edge-stocks/health")
    require(code==200 and health.get("ok") is True,"EDGE health failed",health)
    require(health.get("edge_database_configured") is True,"EDGE database not configured",health)
    require(health.get("research_contract_version")=="EDGE_RESEARCH_BUNDLE_V2","V2 research contract not active",health)
    require(health.get("research_authority")=="EDGE_SYSTEM","EDGE_SYSTEM research authority not active",health)
    require(health.get("fresh_data_required") is True,"DATA-first requirement missing",health)
    require(health.get("data_first_lifecycle") is True,"DATA-first lifecycle flag missing",health)
    require(health.get("chat_scheduled_task_dependency") is False,"Chat scheduling is still a production dependency",health)

    dcode,dispatch,_=api("GET","/api/edge-stocks/dispatch-health")
    require(dcode==200 and dispatch.get("ok") is True and dispatch.get("status")=="READY",
            "EDGE dispatch health failed",dispatch)
    require(dispatch.get("production_scheduler_authority")=="CLOUDFLARE_CRON",
            "Cloudflare is not the declared production scheduler authority",dispatch)
    require(dispatch.get("chat_scheduled_task_dependency") is False,
            "Dispatch health still declares Chat scheduling dependency",dispatch)
    workflows=dispatch.get("workflows") or {}
    expected={
        "data":"stock-data-snapshot.yml",
        "compute":"autonomous-publish.yml",
        "auction":"stock-auction-snapshot.yml",
    }
    for key,name in expected.items():
        require((workflows.get(key) or {}).get("name")==name and (workflows.get(key) or {}).get("ok") is True,
                f"{key} workflow dependency is not ready",dispatch)
    require(dispatch.get("trading_enabled") is False,"Trading unexpectedly enabled",dispatch)

    proof["production_health"]={
        "status":"PASS",
        "research_contract":"EDGE_RESEARCH_BUNDLE_V2",
        "research_authority":"EDGE_SYSTEM",
        "scheduler_authority":"CLOUDFLARE_CRON",
        "workflow_dependencies":expected,
        "checked_at":now_iso(),
    }


def validate_fault_boundaries(proof):
    # These probes are deliberately side-effect-free.
    code,body,_=api("POST","/api/edge-stocks/invoke",{
        "command":"EDGE LTF","force_new":True,"research_only":True
    })
    require(code==422 and "research_only requires" in str(body.get("error") or ""),
            "research-only missing-bundle gate did not fail closed",{"code":code,"body":body})

    code,body,_=api("POST","/api/edge-stocks/invoke",{
        "command":"EDGE LTF","force_new":True,"canonical_attempt":True
    })
    require(code==409 and body.get("code")=="EDGE_CANONICAL_LIFECYCLE_REQUIRED",
            "canonical missing-lifecycle gate did not fail closed",{"code":code,"body":body})

    missing="EDGE-LC-2099-01-01-LTF-USER-00000000-0000-0000-0000-000000000000"
    code,body,_=api("GET",f"/api/edge-stocks/invoke/status?ticker=LTF&lifecycle_id={missing}")
    require(code==409 and body.get("status")=="BLOCKED" and body.get("lifecycle_stage")=="MISSING",
            "missing lifecycle status did not fail closed",{"code":code,"body":body})

    proof["fault_boundaries"]={
        "status":"PASS",
        "research_only_without_bundle":"BLOCKED_422",
        "canonical_without_lifecycle":"BLOCKED_409",
        "unknown_lifecycle":"BLOCKED_409",
        "checked_at":now_iso(),
    }


def run_nifty(proof):
    payload={
        "sandbox":False,
        "force_new":True,
        "client_invocation_id":f"g51-v2-live-nifty-{os.environ.get('GITHUB_RUN_ID','manual')}",
        "assessment":{"objective":"BOTH","risk_posture":"CONSERVATIVE","capital_priority":"CAPITAL_PROTECTION"},
    }
    code,start,err=api("POST","/api/5dr/automated-runs",payload)
    require(code in (201,202) and start.get("ok") is True,
            "NIFTY user invocation failed",{"code":code,"body":start,"stderr":err})
    request_id=str((start.get("request") or {}).get("request_id") or start.get("request_id") or "")
    require(request_id,"NIFTY request_id missing",start)

    terminal=None
    for _ in range(90):
        api("POST",f"/api/5dr/run-requests/{request_id}/resume-processing",{})
        scode,status,_=api("GET",f"/api/5dr/run-requests/{request_id}")
        require(scode==200,"NIFTY status read failed",status)
        state=str((status.get("request") or {}).get("status") or "")
        if state=="COMPLETED":
            terminal=status
            break
        if state=="FAILED":
            raise AssertionError("NIFTY production run failed :: "+json.dumps(status,default=str)[:2600])
        time.sleep(5)
    require(terminal is not None,"NIFTY production run did not complete inside acceptance window")

    req=terminal.get("request") or {}
    run=terminal.get("run") or {}
    meta=req.get("metadata") or {}
    prov=meta.get("run_provenance") or {}
    require(run.get("published") is True and run.get("run_id"),"NIFTY run was not published",terminal)
    require(prov.get("trigger_type")=="USER","NIFTY trigger_type is not USER",prov)
    require(prov.get("benchmark_role")=="NONE","NIFTY user run incorrectly claims benchmark role",prov)
    require(prov.get("evidence_mode") not in ("PREOPEN","PREOPEN_PREP"),
            "NIFTY user run incorrectly uses scheduled pre-open evidence mode",prov)
    require((meta.get("invocation") or {}).get("canonical_attempt") is False,
            "NIFTY user run became canonical attempt",meta.get("invocation"))
    require((meta.get("automated_market_evidence") or {}).get("status")=="AUTOMATED_MARKET_DATA_READY",
            "NIFTY market evidence not ready",meta.get("automated_market_evidence"))

    research=meta.get("system_research_acquisition") or {}
    require(research.get("status")=="RESEARCH_RETRIEVED","NIFTY system research not retrieved",research)
    require(research.get("research_manifest")=="NIFTY_G5_1_V1","NIFTY research manifest version missing",research)
    require(research.get("research_manifest_complete") is True,"NIFTY mandatory research manifest incomplete",research)
    require((research.get("missing_dimensions") or [])==[],"NIFTY research manifest has missing dimensions",research)
    by_dimension=research.get("by_dimension") or {}
    require(NIFTY_RESEARCH_DIMENSIONS.issubset(set(by_dimension)),"NIFTY 8-dimension manifest incomplete",by_dimension)
    for dimension in sorted(NIFTY_RESEARCH_DIMENSIONS):
        row=by_dimension.get(dimension) or {}
        require(row.get("ready_for_interpretation") is True and int(row.get("retrieved") or 0)>0,
                f"NIFTY research dimension {dimension} is not independently retrieved",row)

    require((meta.get("intelligence_reconciliation") or {}).get("status")=="NORMALIZED_AND_DISPATCHED",
            "NIFTY intelligence handoff not dispatched",meta.get("intelligence_reconciliation"))
    require((meta.get("engine_dispatch") or {}).get("status")=="RESULT_SYNCED",
            "NIFTY engine result not synced",meta.get("engine_dispatch"))
    require(isinstance(run.get("result"),dict) and run.get("result"),
            "NIFTY persisted result/user output payload is empty",run)

    proof["nifty"]={
        "status":"PASS",
        "request_id":request_id,
        "run_id":run.get("run_id"),
        "published":True,
        "framework_version":run.get("framework_version"),
        "contract_version":run.get("contract_version"),
        "research_dimensions_verified":"8/8",
        "provenance":{
            "trigger_type":prov.get("trigger_type"),
            "evidence_mode":prov.get("evidence_mode"),
            "market_session_as_of":prov.get("market_session_as_of"),
            "research_as_of":prov.get("research_as_of"),
            "target_session":prov.get("target_session"),
            "benchmark_role":prov.get("benchmark_role"),
        },
        "g1_market_data":"PASS",
        "g2_system_research_8_8":"PASS",
        "g3_intelligence_reconciliation":"PASS",
        "g4_engine_sync":"PASS",
        "g5_persisted_output":"PASS",
    }


def validate_stock_report(ticker,run_id,report):
    require(report.get("ticker")==ticker,f"{ticker} report ticker mismatch",report)
    require(report.get("run_id")==run_id,f"{ticker} report does not point to the new immutable result",
            {"expected":run_id,"actual":report.get("run_id")})
    require(report.get("contract_version")=="EDGE_STOCKS_V1_3",f"{ticker} report contract mismatch",report)
    require(report.get("presentation_contract")=="EFFICACY_V2",f"{ticker} presentation contract mismatch",report)

    presentation=report.get("presentation") or {}
    require(presentation.get("standard_table_count")==4,f"{ticker} standard user output table count is not four",presentation)
    require([presentation.get(f"table_{i}") for i in range(1,5)]==[
        "EDGE_MASTER_ASSESSMENT","ACTIVE_CALLS","CURRENT_STOCK_OUTCOME","DRILLDOWN"
    ],f"{ticker} standard user output table order is invalid",presentation)

    require(isinstance(report.get("master_assessment"),dict),f"{ticker} assessment missing",report)
    active=report.get("active_calls") or []
    require(isinstance(active,list),f"{ticker} canonical active calls output is not an array",active)
    outcome=report.get("current_stock_outcome") or {}
    require(outcome.get("forecast_horizon")=="D:D+4",f"{ticker} current outcome is not D:D+4",outcome)
    sessions=outcome.get("forecast_sessions") or []
    require(len(sessions)==5 and [row.get("session_label") for row in sessions]==["D","D+1","D+2","D+3","D+4"],
            f"{ticker} visible D:D+4 table is incomplete",sessions)
    for row in sessions:
        probs=row.get("probabilities") or {}
        total=sum(float(probs.get(k,0)) for k in ("bull","base","bear"))
        require(abs(total-100.0)<=0.01,f"{ticker} probability sum invalid",row)
        zone=row.get("expected_zone") or {}
        require(zone.get("low") is not None and zone.get("high") is not None and float(zone["low"])<=float(zone["high"]),
                f"{ticker} expected zone invalid",row)
        for key in ("trading_date","direction","regime_context","evidence_basis","verification_state"):
            require(row.get(key) not in (None,""),f"{ticker} {key} missing from visible daily forecast",row)

    drilldown=report.get("drilldown") or []
    require(isinstance(drilldown,list) and len(drilldown)>0,f"{ticker} drill-down output is empty",report)
    return sessions


def run_stock(ticker,proof):
    start_payload={"command":f"EDGE {ticker}","force_new":True}
    code,start,err=api("POST","/api/edge-stocks/invoke",start_payload)
    require(code==202 and start.get("ok") is True and start.get("status")=="DATA_DISPATCHED",
            f"{ticker} DATA-first lifecycle did not start",{"code":code,"body":start,"stderr":err})
    require(start.get("data_first") is True and start.get("research_executed_this_run") is False,
            f"{ticker} invocation did not start at DATA before research",start)
    lifecycle_id=str(start.get("lifecycle_id") or "")
    status_path=str(start.get("next") or "")
    require(lifecycle_id and status_path,f"{ticker} lifecycle identity/status URL missing",start)

    terminal=None
    observed_stages=[]
    lineage={"market_snapshot_id":None,"research_bundle_id":None,"auction_snapshot_id":None}
    for _ in range(100):
        scode,state,_=api("GET",status_path)
        status=str(state.get("status") or "")
        stage=str(state.get("lifecycle_stage") or "")
        if stage and (not observed_stages or observed_stages[-1]!=stage):
            observed_stages.append(stage)
        for key in lineage:
            if state.get(key):
                lineage[key]=state.get(key)
        if status=="COMPLETE":
            require(scode==200,f"{ticker} terminal status HTTP mismatch",state)
            terminal=state
            break
        if status=="BLOCKED":
            raise AssertionError(f"{ticker} lifecycle blocked at {stage} :: "+json.dumps(state,default=str)[:2600])
        require(scode==200,f"{ticker} lifecycle status read failed",{"code":scode,"body":state})
        time.sleep(4)
    require(terminal is not None,f"{ticker} lifecycle did not complete inside acceptance window")

    run_id=str(terminal.get("run_id") or "")
    market_snapshot_id=str(terminal.get("market_snapshot_id") or lineage.get("market_snapshot_id") or "")
    research_bundle_id=str(terminal.get("research_bundle_id") or lineage.get("research_bundle_id") or "")
    require(run_id,f"{ticker} immutable result id missing",terminal)
    require(market_snapshot_id,f"{ticker} immutable DATA snapshot id missing",terminal)
    require(research_bundle_id,f"{ticker} V2 research bundle id missing",terminal)

    rcode,envelope,_=api("GET",f"/api/edge-stocks/research-bundles/{research_bundle_id}")
    require(rcode==200 and isinstance(envelope.get("research_bundle"),dict),
            f"{ticker} stored V2 research readback failed",envelope)
    stored=envelope["research_bundle"]
    require(stored.get("status")=="READY",f"{ticker} research is not READY",stored)
    require(stored.get("contract_version")=="EDGE_RESEARCH_BUNDLE_V2",f"{ticker} research contract is not V2",stored)
    require(stored.get("research_authority")=="EDGE_SYSTEM",f"{ticker} research authority is not EDGE_SYSTEM",stored)
    require(str(stored.get("lifecycle_id") or "")==lifecycle_id,f"{ticker} research lifecycle lineage mismatch",stored)
    require(str(stored.get("market_snapshot_id") or "")==market_snapshot_id,f"{ticker} research DATA lineage mismatch",stored)

    payload=stored.get("payload") or {}
    require(payload.get("contract_version")=="EDGE_RESEARCH_BUNDLE_V2",f"{ticker} stored payload contract mismatch",payload)
    require(payload.get("research_authority")=="EDGE_SYSTEM",f"{ticker} stored payload authority mismatch",payload)
    require(str(payload.get("lifecycle_id") or "")==lifecycle_id,f"{ticker} payload lifecycle mismatch",payload)
    require(str(payload.get("market_snapshot_id") or "")==market_snapshot_id,f"{ticker} payload DATA snapshot mismatch",payload)
    sources=payload.get("sources") or []
    require(isinstance(sources,list) and len(sources)>=2,f"{ticker} fresh web source set is insufficient",sources)
    require(all(row.get("retrieved_at") and row.get("url") and row.get("source_id") for row in sources if isinstance(row,dict)),
            f"{ticker} source provenance is incomplete",sources)

    claims=payload.get("claims") or []
    verified={
        str(row.get("evidence_category") or "")
        for row in claims
        if isinstance(row,dict)
        and row.get("verification_status")=="VERIFIED"
        and row.get("independent_validation") is True
    }
    require(STOCK_RESEARCH_CATEGORIES.issubset(verified),
            f"{ticker} stored research coverage is not verified 5/5",
            {"required":sorted(STOCK_RESEARCH_CATEGORIES),"verified":sorted(verified)})
    require(parse_time(payload.get("research_fresh_at")) is not None,
            f"{ticker} research freshness timestamp missing",payload)

    report=None
    for _ in range(12):
        pcode,renvelope,_=api("GET",f"/api/edge-stocks/report?ticker={ticker}")
        if pcode==200 and isinstance(renvelope.get("report"),dict) and str(renvelope["report"].get("run_id") or "")==run_id:
            report=renvelope["report"]
            break
        time.sleep(2)
    require(report is not None,f"{ticker} final report did not resolve to new run",{"run_id":run_id})
    sessions=validate_stock_report(ticker,run_id,report)

    prov=report.get("run_provenance") or {}
    require(prov.get("trigger_type")=="USER",f"{ticker} result is not a USER run",prov)
    require(prov.get("benchmark_role")=="NONE",f"{ticker} user run incorrectly claims benchmark role",prov)
    require(prov.get("candidate_type")=="USER_CANONICAL_SNAPSHOT",
            f"{ticker} user run classification mismatch",prov)
    active=report.get("active_calls") or []
    require(
        not any(str(row.get("recommendation_id") or "")==run_id for row in active if isinstance(row,dict)),
        f"{ticker} user-anytime result leaked into canonical Active Calls",
        {"run_id":run_id,"active_calls":active},
    )

    proof["stocks"][ticker]={
        "status":"PASS",
        "lifecycle_id":lifecycle_id,
        "market_snapshot_id":market_snapshot_id,
        "research_bundle_id":research_bundle_id,
        "result_id":run_id,
        "observed_stages":observed_stages,
        "research_contract":"EDGE_RESEARCH_BUNDLE_V2",
        "research_authority":"EDGE_SYSTEM",
        "research_coverage":"5/5 VERIFIED",
        "fresh_source_count":len(sources),
        "presentation_contract":"EFFICACY_V2",
        "active_calls_scope":"CANONICAL_ONLY",
        "standard_tables":[
            "EDGE_MASTER_ASSESSMENT","ACTIVE_CALLS","CURRENT_STOCK_OUTCOME","DRILLDOWN"
        ],
        "forecast_horizon":"D:D+4",
        "session_labels":[row.get("session_label") for row in sessions],
        "provenance":{
            "trigger_type":prov.get("trigger_type"),
            "evidence_mode":prov.get("evidence_mode"),
            "market_session_as_of":prov.get("market_session_as_of"),
            "research_as_of":prov.get("research_as_of"),
            "target_session":prov.get("target_session"),
            "benchmark_role":prov.get("benchmark_role"),
            "candidate_type":prov.get("candidate_type"),
        },
        "g1_data_first":"PASS",
        "g2_fresh_system_research":"PASS",
        "g3_exact_lineage":"PASS",
        "g4_compute_persistence":"PASS",
        "g5_user_output_parity":"PASS",
    }


def main():
    local=datetime.now(IST)
    proof={
        "schema":"MDOS_G5_1_V2_LIVE_CLOSURE_PROOF",
        "generated_at":now_iso(),
        "acceptance_date_ist":local.date().isoformat(),
        "acceptance_time_ist":local.isoformat(),
        "architecture":"DATA -> RESEARCH -> RECONCILE/COMPUTE -> PERSIST -> PRESENT",
        "points":{
            "production_health":{"status":"PENDING"},
            "fault_boundaries":{"status":"PENDING"},
            "nifty":{"status":"PENDING"},
            "stocks_3_of_3":{"status":"PENDING"},
            "four_asset_user_output":{"status":"PENDING"},
            "live_preopen_window":{"status":"SEPARATE_WINDOW_PROOF_REQUIRED"},
        },
        "stocks":{},
        "errors":[],
    }

    tasks=[
        ("production_health",lambda:validate_smoke(proof)),
        ("fault_boundaries",lambda:validate_fault_boundaries(proof)),
        ("nifty",lambda:run_nifty(proof)),
        *[(ticker,lambda t=ticker:run_stock(t,proof)) for ticker in STOCKS],
    ]
    for name,fn in tasks:
        try:
            fn()
        except Exception as exc:
            proof["errors"].append({"task":name,"error":f"{type(exc).__name__}: {exc}"})

    health_ok=proof.get("production_health",{}).get("status")=="PASS"
    faults_ok=proof.get("fault_boundaries",{}).get("status")=="PASS"
    nifty_ok=proof.get("nifty",{}).get("status")=="PASS"
    stocks_ok=all(proof["stocks"].get(t,{}).get("status")=="PASS" for t in STOCKS)

    proof["points"]["production_health"]["status"]="PASS" if health_ok else "FAIL"
    proof["points"]["fault_boundaries"]["status"]="PASS" if faults_ok else "FAIL"
    proof["points"]["nifty"]["status"]="PASS" if nifty_ok else "FAIL"
    proof["points"]["stocks_3_of_3"]["status"]="PASS" if stocks_ok else "FAIL"
    proof["points"]["four_asset_user_output"]["status"]="PASS" if nifty_ok and stocks_ok else "FAIL"
    proof["generated_at"]=now_iso()

    Path("/tmp/g5-1-closure-proof.json").write_text(
        json.dumps(proof,indent=2,sort_keys=True,default=str)+"\n",encoding="utf-8"
    )
    print(json.dumps({"points":proof["points"],"errors":proof["errors"]},indent=2))
    return 0 if health_ok and faults_ok and nifty_ok and stocks_ok and not proof["errors"] else 1


if __name__=="__main__":
    sys.exit(main())