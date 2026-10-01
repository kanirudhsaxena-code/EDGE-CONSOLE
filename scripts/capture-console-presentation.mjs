import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const baseUrl=process.env.CONSOLE_URL||'https://edge-console.k-anirudhsaxena.workers.dev';
const moduleName=String(process.env.CAPTURE_MODULE||'').trim().toUpperCase();
const requestId=String(process.env.CAPTURE_REQUEST_ID||'').trim();
const ticker=String(process.env.CAPTURE_TICKER||'').trim().toUpperCase();
const expectedId=String(process.env.EXPECTED_RESULT_ID||'').trim();
const outPath=process.env.PRESENTATION_OUTPUT||'/tmp/chat-presentation.txt';

function chromePath(){
  const explicit=process.env.CHROME_BIN;
  if(explicit&&fs.existsSync(explicit))return explicit;
  for(const bin of ['google-chrome','google-chrome-stable','chromium','chromium-browser']){
    try{
      const p=execFileSync('which',[bin],{encoding:'utf8'}).trim();
      if(p&&fs.existsSync(p))return p;
    }catch{}
  }
  throw new Error('No Chrome/Chromium executable found on runner');
}

const headers={};
if(process.env.CF_ACCESS_CLIENT_ID)headers['CF-Access-Client-Id']=process.env.CF_ACCESS_CLIENT_ID;
if(process.env.CF_ACCESS_CLIENT_SECRET)headers['CF-Access-Client-Secret']=process.env.CF_ACCESS_CLIENT_SECRET;

const browser=await chromium.launch({headless:true,executablePath:chromePath(),args:['--no-sandbox']});
try{
  const context=await browser.newContext({extraHTTPHeaders:headers,viewport:{width:430,height:1200}});
  const page=await context.newPage();
  await page.goto(baseUrl,{waitUntil:'domcontentloaded',timeout:60000});

  if(moduleName==='EDGE_NIFTY'||moduleName==='NIFTY'||moduleName==='5DR'){
    if(!requestId)throw new Error('CAPTURE_REQUEST_ID is required for EDGE NIFTY capture');
    await page.evaluate(id=>{
      localStorage.setItem('edge-console-active-nifty-request-v1',id);
    },requestId);
    await page.reload({waitUntil:'domcontentloaded',timeout:60000});
    const tile=page.locator('.module-tile[data-module="5DR"]');
    if(await tile.count())await tile.click();
    await page.waitForFunction(()=>{
      const summary=document.querySelector('#fiveDrSummary');
      return Boolean(summary&&summary.textContent&&summary.textContent.includes('Today’s Market View'));
    },{timeout:120000});
    if(expectedId){
      await page.waitForFunction(id=>document.body.textContent?.includes(id),expectedId,{timeout:30000}).catch(()=>{});
    }
    await page.evaluate(()=>{
      const summary=document.querySelector('#fiveDrSummary');
      if(!summary)return;
      const detail=summary.querySelector('[data-analysis-detail]');
      if(detail)detail.hidden=false;
      summary.querySelectorAll('details').forEach(node=>{ node.open=true; });
      const toggle=summary.querySelector('[data-analysis-toggle]');
      if(toggle)toggle.textContent='Hide full analysis';
    });
    const parts=await page.evaluate(()=>{
      const eyebrow=document.querySelector('#selectedModuleEyebrow')?.textContent?.trim()||'';
      const title=document.querySelector('#selectedModuleTitle')?.textContent?.trim()||'';
      const assessment=document.querySelector('#assessmentSummary')?.innerText?.trim()||'';
      const current=document.querySelector('#fiveDrSummary')?.innerText?.trim()||'';
      return [eyebrow,title,assessment,current].filter(Boolean);
    });
    if(parts.length<3)throw new Error('EDGE NIFTY Console presentation was incomplete');
    fs.writeFileSync(outPath,parts.join('\n\n')+'\n','utf8');
  }else if(moduleName==='EDGE_STOCKS'||moduleName==='STOCKS'){
    if(!ticker)throw new Error('CAPTURE_TICKER is required for EDGE Stocks capture');
    await page.evaluate(t=>{
      localStorage.setItem('edge-console-selected-stock',t);
    },ticker);
    await page.reload({waitUntil:'domcontentloaded',timeout:60000});
    const tile=page.locator('.module-tile[data-module="EDGE_STOCKS"]');
    if(await tile.count())await tile.click();
    await page.waitForSelector('#stocksSummary [data-edge-section="master-assessment"]',{timeout:120000});
    if(expectedId){
      await page.waitForFunction(id=>document.querySelector('#stocksSummary')?.textContent?.includes(id),expectedId,{timeout:60000});
    }
    await page.waitForSelector('#stocksSummary [data-edge-five-session-path="D:D+4"] [data-edge-forecast-row="D+4"]',{timeout:60000});
    const fiveSessionParity=await page.evaluate(async ticker=>{
      const expected=['D','D+1','D+2','D+3','D+4'];
      const resp=await fetch('/api/edge-stocks/report?ticker='+encodeURIComponent(ticker),{cache:'no-store'});
      const data=await resp.json();
      if(!resp.ok)throw new Error(data.error||'EDGE Stocks report read failed during Chat parity capture');
      const report=data.report||{};
      const outcome=report.current_stock_outcome||{};
      if(outcome.forecast_horizon!=='D:D+4')throw new Error('EDGE Stocks Chat parity source horizon is not D:D+4');
      const source=outcome.forecast_sessions;
      if(!Array.isArray(source)||source.length!==5)throw new Error('EDGE Stocks Chat parity source must contain exactly five rows');
      const nodes=[...document.querySelectorAll('#stocksSummary [data-edge-five-session-path="D:D+4"] [data-edge-forecast-row]')];
      if(nodes.length!==5)throw new Error('EDGE Stocks Console must render exactly five D:D+4 rows');
      const money=v=>v==null||Number.isNaN(Number(v))?'—':'₹'+Number(v).toLocaleString('en-IN',{maximumFractionDigits:2});
      const dateText=v=>{if(!v)return'—';const d=new Date(String(v)+'T00:00:00');return Number.isNaN(d.getTime())?String(v):d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})};
      const rendered=nodes.map((node,i)=>{
        const row=source[i]||{};
        if(row.session_label!==expected[i])throw new Error('EDGE Stocks source row order mismatch at '+expected[i]);
        if(node.getAttribute('data-edge-forecast-row')!==expected[i])throw new Error('EDGE Stocks rendered row order mismatch at '+expected[i]);
        if(!row.trading_date||!row.direction||!row.expected_zone||row.expected_zone.low==null||row.expected_zone.high==null)throw new Error('EDGE Stocks source row incomplete at '+expected[i]);
        const text=node.innerText||'';
        const direction=String(row.direction).replaceAll('_',' ');
        for(const required of [dateText(row.trading_date),direction,money(row.expected_zone.low),money(row.expected_zone.high)]){
          if(!text.includes(required))throw new Error('EDGE Stocks rendered/source parity mismatch at '+expected[i]+': '+required);
        }
        return {session_label:expected[i],text};
      });
      if(nodes.some(node=>node.getAttribute('data-edge-forecast-row')==='D+5'))throw new Error('D+5 is prohibited in current EDGE Stocks Chat presentation');
      return {
        run_id:String(report.run_id||''),
        recommendation_id:String(report.recommendation_id||''),
        forecast_horizon:outcome.forecast_horizon,
        source_rows:source,
        rendered_rows:rendered,
        parity:true
      };
    },ticker);
    fs.writeFileSync('/tmp/chat-five-session.json',JSON.stringify(fiveSessionParity,null,2)+'\n','utf8');
    const parts=await page.evaluate(()=>{
      const eyebrow=document.querySelector('#selectedModuleEyebrow')?.textContent?.trim()||'';
      const title=document.querySelector('#selectedModuleTitle')?.textContent?.trim()||'';
      const current=document.querySelector('#stocksSummary')?.innerText?.trim()||'';
      return [eyebrow,title,current].filter(Boolean);
    });
    if(parts.length<2)throw new Error('EDGE Stocks Console presentation was incomplete');
    fs.writeFileSync(outPath,parts.join('\n\n')+'\n','utf8');
  }else{
    throw new Error('Unsupported CAPTURE_MODULE: '+moduleName);
  }

  const text=fs.readFileSync(outPath,'utf8');
  if(!text.trim())throw new Error('Captured Console presentation is empty');
  process.stdout.write(text);
}finally{
  await browser.close();
}
