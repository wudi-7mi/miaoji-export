"use strict";
// Synthetic pages only. Never connects to the user's running browser/account.
const { chromium } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const browserPath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "miaoji-test-"));
const fixture = fs.readFileSync(path.join(__dirname, "fixture.html"), "utf8");
const enterpriseFixture = fs.readFileSync(path.join(__dirname, "enterprise-fixture.html"), "utf8");
const meetingFixture = fs.readFileSync(path.join(__dirname, "meeting-fixture.html"), "utf8");
const url = "https://fixture.xfchat.iflytek.com/minutes/test-document";
async function main() {
  const context = await chromium.launchPersistentContext(profile, { executablePath: browserPath, headless: true,
    viewport: { width: 1280, height: 900 }, ignoreDefaultArgs: ["--disable-extensions"],
    args: ["--enable-unsafe-extension-debugging", "--disable-background-networking"], acceptDownloads: true });
  context.setDefaultTimeout(15000);
  try {
    await context.route("**/*", async route => {
      if (route.request().url().startsWith("chrome-extension:")) return route.continue();
      if (route.request().isNavigationRequest()) {
        const pathname = new URL(route.request().url()).pathname;
        return route.fulfill({ contentType: "text/html;charset=utf-8", body: pathname === '/minutes/meeting' ? meetingFixture : pathname === '/minutes/enterprise' ? enterpriseFixture : fixture });
      }
      return route.abort();
    });
    if (!process.argv.includes('--extension-only')) {
    const page = await context.newPage();
    await page.goto(url);
    await page.addScriptTag({ path: path.join(root, "exporter.js") });
    await page.addScriptTag({ path: path.join(root, "extractor.js") });
    const snapshot = await page.evaluate(() => MiaojiExtractor.capture({ full: false }));
    assert.ok(snapshot.segments.length < 30); assert.equal(snapshot.coverage.reachedEnd, false);
    assert.ok(snapshot.warnings.some(value => value.includes("仅采集")));
    await page.evaluate(() => document.querySelector('.transcript-container').scrollTop = 800);
    await page.waitForFunction(() => document.querySelector('.paragraph').getAttribute('data-paragraph-id') !== 'p0');
    const record = await page.evaluate(() => MiaojiExtractor.capture());
    assert.equal(record.segments.length, 180);
    assert.equal(record.coverage.reachedEnd, true);
    assert.equal(await page.locator('.transcript-container').evaluate(node => node.scrollTop), 800);
    for (let index = 0; index < 180; index++) {
      assert.equal(record.segments[index].id, 'p' + index);
      assert.ok(record.segments[index].text.includes('段落 ' + index + '：'));
      assert.equal(record.segments[index].startMs, index * 13000);
      assert.ok(!record.segments[index].text.includes('摘要控件'));
    }
    console.log("Virtualized transcript: 180/180 paragraphs captured in order, speakers/timestamps preserved, scroll restored.");
    const cancelled = await page.evaluate(async () => {
      const controller = new AbortController();
      const pending = MiaojiExtractor.capture({ signal: controller.signal });
      setTimeout(() => controller.abort(), 80);
      try { await pending; return false; } catch (error) { return error.name === 'AbortError'; }
    });
    assert.equal(cancelled, true);
    assert.equal(await page.locator('.transcript-container').evaluate(node => node.scrollTop), 800);
    const timeout = await page.evaluate(() => MiaojiExtractor.capture({ maxDuration: 1 }));
    assert.equal(timeout.coverage.timedOut, true); assert.ok(timeout.warnings.some(value => value.includes('采集未完成')));
    await assert.rejects(page.evaluate(() => MiaojiExtractor.capture({ custom: { root: '[' } })), /有效的 CSS/);
    await page.locator('.transcript-container').evaluate(node => node.className = 'private-recording');
    await assert.rejects(page.evaluate(() => MiaojiExtractor.capture()), /未识别/);
    const custom = await page.evaluate(() => MiaojiExtractor.capture({ full: false, custom: { root: '.private-recording' } }));
    assert.ok(custom.segments.length > 0);
    await page.locator('.private-recording').evaluate(node => { node.innerHTML = '<div class="paragraph"><span class="speaker-name">甲</span><div class="paragraph-content">相同发言</div></div><div class="paragraph"><span class="speaker-name">甲</span><div class="paragraph-content">相同发言</div></div>'; node.style.height='auto'; node.querySelectorAll('.paragraph').forEach(child => child.style.position='static'); });
    const repeated = await page.evaluate(() => MiaojiExtractor.capture({ full: false, custom: { root: '.private-recording' } }));
    assert.equal(repeated.segments.length, 2);
    console.log("Cancellation, timeout warnings, explicit adapter, invalid selectors and repeated utterances passed.");
    await page.goto('https://fixture.xfchat.iflytek.com/minutes/enterprise');
    await page.addScriptTag({ path: path.join(root, "exporter.js") });
    await page.addScriptTag({ path: path.join(root, "extractor.js") });
    await page.locator('.rc-virtual-list-holder').evaluate(node=>node.scrollTop=330);
    await page.waitForFunction(()=>document.querySelector('.paragraph-content-editor').getAttribute('data-zone-id')!=='zone-0');
    const enterprise = await page.evaluate(()=>MiaojiExtractor.capture());
    assert.equal(enterprise.segments.length,64);
    assert.equal(enterprise.coverage.reachedEnd,true);
    assert.equal(await page.locator('.rc-virtual-list-holder').evaluate(node=>node.scrollTop),330);
    for(let index=0;index<64;index++) {
      assert.equal(enterprise.segments[index].id,'zone-'+index);
      assert.equal(enterprise.segments[index].speaker,'测试发言人'+(index%3+1));
      assert.equal(enterprise.segments[index].startMs,index*17000);
      assert.equal(enterprise.segments[index].text,'相同正文，保留连续文本。');
    }
    assert.ok(!enterprise.warnings.some(value=>value.includes('未识别到')));
    console.log('Enterprise Minutes: attribute metadata, nested zone IDs, 64/64 identical utterances and overflow:hidden virtual scrolling passed.');
    await page.evaluate(()=>Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'}));
    await assert.rejects(page.evaluate(()=>MiaojiExtractor.capture()),/保持在前台/);
    await page.evaluate(()=>delete document.visibilityState);
    const hiddenMidCapture=await page.evaluate(async()=>{
      const before=document.querySelector('.rc-virtual-list-holder').scrollTop;
      const pending=MiaojiExtractor.capture();
      setTimeout(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));},50);
      try { await pending;return {stopped:false}; }
      catch(error) { return {stopped:error.message.includes('保持在前台'),restored:document.querySelector('.rc-virtual-list-holder').scrollTop===before}; }
      finally { delete document.visibilityState; }
    });
    assert.deepEqual(hiddenMidCapture,{stopped:true,restored:true});
    console.log('Background tab: capture stops with an explicit foreground instruction and restores scroll.');
    for (const mode of ['rich','empty','unavailable','delayed','start-notes']) {
      await page.goto('https://fixture.xfchat.iflytek.com/minutes/meeting?mode='+mode);
      await page.addScriptTag({path:path.join(root,'exporter.js')});
      await page.addScriptTag({path:path.join(root,'extractor.js')});
      const before=await page.evaluate(()=>({tab:document.querySelector('[aria-selected="true"]').id,top:document.querySelector('.transcript-container').scrollTop}));
      const result=await page.evaluate(()=>MiaojiExtractor.captureMeeting({full:false,includeNotes:true}));
      assert.equal(result.segments.length,6);
      assert.equal(result.meetingNotes.status,mode==='empty'?'empty':mode==='unavailable'?'unavailable':'captured');
      if(result.meetingNotes.status==='captured') {
        assert.ok(result.meetingNotes.blocks.some(block=>block.type==='heading'&&block.text==='决策'));
        assert.ok(result.meetingNotes.text.includes('下周讨论后续计划'));
        assert.ok(!result.meetingNotes.text.includes('编辑纪要不应导出'));
      }
      assert.deepEqual(await page.evaluate(()=>({tab:document.querySelector('[aria-selected="true"]').id,top:document.querySelector('.transcript-container').scrollTop})),before);
    }
    await page.goto('https://fixture.xfchat.iflytek.com/minutes/meeting?mode=busy');
    await page.addScriptTag({path:path.join(root,'exporter.js')});
    await page.addScriptTag({path:path.join(root,'extractor.js')});
    const cancelledNotes=await page.evaluate(async()=>{const controller=new AbortController();const pending=MiaojiExtractor.captureMeeting({full:false,includeNotes:true,signal:controller.signal});setTimeout(()=>controller.abort(),120);try{await pending;return false;}catch(error){return error.name==='AbortError'&&document.querySelector('#transcript-tab').getAttribute('aria-selected')==='true';}});
    assert.equal(cancelledNotes,true);
    console.log('Notes: rich/empty/missing/delayed content, starting pane restoration and cancellation passed.');
    await page.close();
    return;
    }
    // Load a real MV3 extension into this isolated test profile.
    const session = await context.browser().newBrowserCDPSession();
    const { id } = await session.send("Extensions.loadUnpacked", { path: root });
    console.log("Loaded real extension into isolated browser profile.");
    const source = await context.newPage();
    const sourceSession = await context.newCDPSession(source);
    await sourceSession.send('Runtime.enable');
    sourceSession.on('Runtime.exceptionThrown', event => console.error('Test runtime exception: ' + (event.exceptionDetails.exception?.description || event.exceptionDetails.text)));
    source.on('pageerror', error => console.error('Fixture page error: ' + error.message));
    source.on('console', entry => { if (entry.type() === 'error') console.error('Fixture console: ' + entry.text()); });
    await source.goto(url, { waitUntil: 'domcontentloaded' });
    console.log('Synthetic extension test page DOM loaded.');
    await source.getByRole('button', { name: '导出文字记录', exact: true }).waitFor();
    const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.getByRole('heading', { name: '妙记导出' }).waitFor();
    assert.ok((await popup.locator('#domains').inputValue()).includes('xfchat.iflytek.com'));
    // Settings affect an already-open page and do not create duplicate controls.
    await popup.locator('#enabled').uncheck();
    await source.locator('#miaoji-export-host').waitFor({ state: 'detached' });
    await popup.locator('#enabled').check();
    await source.getByRole('button', { name: '导出文字记录', exact: true }).waitFor();
    await popup.evaluate(async (sourceUrl) => {
      const [tab] = await chrome.tabs.query({ url: sourceUrl });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: MiaojiShared.FILES });
    }, url);
    assert.equal(await source.locator('#miaoji-export-host').count(), 1);
    fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
    await popup.screenshot({ path: path.join(root, 'test-results', 'popup.png'), fullPage: true });
    await source.bringToFront();
    await source.getByRole('button', { name: '导出文字记录', exact: true }).click();
    await source.locator('#full').uncheck();
    await source.getByRole('button', { name: '开始采集', exact: true }).click();
    await source.getByRole('button', { name: '下载文件', exact: true }).waitFor();
    await source.waitForFunction(() => !document.querySelector('#miaoji-export-host').shadowRoot.getElementById('download').disabled);
    const [download] = await Promise.all([source.waitForEvent('download'), source.getByRole('button', { name: '下载文件', exact: true }).click()]);
    assert.ok(download.suggestedFilename().endsWith('.md'));
    const file = await download.path();
    const output = fs.readFileSync(file, 'utf8');
    assert.ok(output.includes('段落 0')); assert.ok(output.includes('仅采集当前已加载'));
    assert.ok(!output.includes('摘要控件'));
    await source.screenshot({ path: path.join(root, 'test-results', 'export-panel.png'), fullPage: true });
    await source.goto('https://fixture.xfchat.iflytek.com/minutes/meeting');
    await source.bringToFront();
    await source.getByRole('button',{name:'导出文字记录',exact:true}).waitFor();
    await source.locator('.transcript-container').evaluate(node=>node.scrollTop=75);
    await source.locator('#notes-tab').click();
    await source.locator('#smart-notes-scroll-container').evaluate(node=>node.scrollTop=30);
    await source.getByRole('button',{name:'导出文字记录',exact:true}).click();
    await source.locator('#full').uncheck();
    await source.getByRole('button',{name:'开始采集',exact:true}).click();
    await source.waitForFunction(()=>!document.querySelector('#miaoji-export-host').shadowRoot.getElementById('download').disabled);
    assert.ok((await source.locator('#preview-state').textContent()).includes('导出 4 段'));
    assert.equal(await source.locator('#notes-tab').getAttribute('aria-selected'),'true');
    assert.equal(await source.locator('#smart-notes-scroll-container').evaluate(node=>node.scrollTop),30);
    await source.evaluate(()=>document.querySelector('#transcript-tab').click());
    assert.equal(await source.locator('.transcript-container').evaluate(node=>node.scrollTop),75);
    await source.evaluate(()=>document.querySelector('#notes-tab').click());
    assert.ok((await source.locator('#preview').inputValue()).includes('## 会议纪要'));
    await source.locator('#merge').uncheck();
    assert.ok((await source.locator('#preview-state').textContent()).includes('导出 6 段'));
    await source.locator('#from').fill('00:05'); await source.locator('#to').fill('00:20');
    await source.locator('#speaker-filters input[value="乙"]').uncheck();
    await source.locator('#merge').check();
    assert.ok((await source.locator('#preview-state').textContent()).includes('选中 3 段 · 导出 2 段'));
    for(const format of ['md','txt','json']) {
      await source.locator('#format').selectOption(format);
      const [selectedDownload]=await Promise.all([source.waitForEvent('download'),source.getByRole('button',{name:'下载文件',exact:true}).click()]);
      assert.ok(selectedDownload.suggestedFilename().endsWith('.'+format));
      const selectedText=fs.readFileSync(await selectedDownload.path(),'utf8');
      assert.ok(selectedText.includes('第二句。')); assert.ok(selectedText.includes('第四句。第五句。'));
      assert.ok(!selectedText.includes('第一句。')); assert.ok(!selectedText.includes('第三句。')); assert.ok(!selectedText.includes('第六句。'));
      assert.ok(selectedText.includes('采用方案 A'));
      if(format==='json') {
        const json=JSON.parse(selectedText); assert.equal(json.segments.length,2);
        assert.deepEqual(json.segments.map(segment=>segment.sourceIds),[['m1'],['m3','m4']]);
      }
    }
    await source.locator('#speaker-filters input[value="甲"]').uncheck();
    assert.equal(await source.locator('#download').isDisabled(),true);
    assert.equal(await source.locator('#copy').isDisabled(),true);
    assert.equal(await source.locator('#preview').inputValue(),'');
    await source.locator('#all-speakers').click();
    await source.locator('#from').fill('invalid');
    assert.equal(await source.locator('#download').isDisabled(),true);
    assert.ok((await source.locator('#preview-state').textContent()).includes('时间请输入'));
    await source.locator('#from').fill('00:25'); await source.locator('#to').fill('00:05');
    assert.ok((await source.locator('#preview-state').textContent()).includes('开始时间不能晚于'));
    await source.locator('#from').fill(''); await source.locator('#to').fill('');
    await source.locator('#include-notes').uncheck();
    const withoutNotes=JSON.parse(await source.locator('#preview').inputValue());
    assert.equal(withoutNotes.meetingNotes,undefined);
    await source.locator('#include-notes').check(); await source.locator('#format').selectOption('md');
    await source.screenshot({path:path.join(root,'test-results','combined-export-panel.png'),fullPage:true});
    console.log('Real MV3 combined export: pane/scroll restoration, merge toggle, speaker/time filters, three downloaded formats, empty/invalid selections and notes opt-out passed.');
    // UI route changes remove the launcher and clear the previous document.
    await source.evaluate(() => history.pushState({}, '', '/docx/something'));
    await source.locator('#miaoji-export-host').waitFor({ state: 'detached' });
    console.log("Real MV3: load, popup, enable/disable without reload, duplicate injection, local download and SPA cleanup passed.");
  } finally { await context.close(); }
}
main().then(() => {
  // Start MV3 in a fresh browser process: installing after routed synthetic
  // pages have been created can leave Chromium's navigation interception stuck.
  if (!process.argv.includes('--extension-only')) execFileSync(process.execPath, [__filename, '--extension-only'], { stdio: 'inherit', windowsHide: true, timeout: 90000 });
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  // profile is a newly created task-owned temporary directory.
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});
