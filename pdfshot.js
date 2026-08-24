const { chromium } = require('playwright');
const OUT='/tmp/claude-0/-home-user-website/6d298498-201f-5e14-a8a8-841906442af4/scratchpad/';
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'], ignoreDefaultArgs:['--hide-scrollbars'] });
  const p = await b.newPage({ viewport:{width:1100,height:1500} });
  await p.goto('http://localhost:9800/newcv.pdf', { waitUntil:'load' });
  await p.waitForTimeout(6000);
  await p.screenshot({ path: OUT+'cv1.png', fullPage: false });
  await p.keyboard.press('PageDown'); await p.waitForTimeout(1500);
  await p.screenshot({ path: OUT+'cv2.png' });
  await b.close();
})();
