const {chromium}=require('playwright');const fs=require('fs');
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:890,height:640}});
const svg=fs.readFileSync(process.argv[2]).toString('base64');
await p.setContent('<body style="margin:0;background:#d9d4cb"><div style="padding:24px"><img src="data:image/svg+xml;base64,'+svg+'" style="width:840px;background:#fbfaf6;box-shadow:0 4px 16px #0004;display:block"></div></body>');
await p.waitForTimeout(500);await p.screenshot({path:process.argv[3],fullPage:true});await b.close();})();
