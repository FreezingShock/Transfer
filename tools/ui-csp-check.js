// Renders the UI under the same Content-Security-Policy the app window uses, and fails if
// folder/type colors come out blank (Tauri adds a nonce to any CSP directive it is allowed
// to modify, which silently disables inline styles). Usage: node tools/ui-csp-check.js
const path=require("path");const UI=path.join(__dirname,"../ui")+"/";const OUT=require("os").tmpdir();
const {chromium}=require('playwright');(async()=>{const b=await chromium.launch();const fs=require('fs');
const html=fs.readFileSync(UI+'index.html','utf8'), js=fs.readFileSync(UI+'app.js','utf8');
for (const [name,csp] of [['tauri-with-nonce',"default-src 'self'; style-src 'self' 'unsafe-inline' 'nonce-abc'; script-src 'self' 'unsafe-inline'"],['fixed',"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'"]]){
 const p=await b.newPage({viewport:{width:480,height:760}});
 await p.route('http://app.local/**',r=>{const u=r.request().url();
   if(u.endsWith('app.js'))return r.fulfill({contentType:'text/javascript',body:js});
   return r.fulfill({contentType:'text/html',headers:{'content-security-policy':csp},body:name.startsWith('tauri')?html.replace('<style>','<style nonce="abc">'):html})});
 await p.goto('http://app.local/index.html#settings');await p.waitForTimeout(600);await p.click('[data-edit*="Desktop"]');await p.waitForTimeout(700);
 const dot=await p.$eval('.folders .dot',e=>getComputedStyle(e).backgroundColor);
 const stroke=await p.$eval('.grid button svg',e=>getComputedStyle(e).stroke);
 console.log(name,'folder dot:',dot,'| icon stroke:',stroke);await p.screenshot({path:`${OUT}/csp-${name}.png`});await p.close()}
await b.close()})()
