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
