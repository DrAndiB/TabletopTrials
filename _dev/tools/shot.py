import asyncio, sys, json, time
from playwright.async_api import async_playwright
# usage: shot.py url out.png [wait_seconds] [width height] [js_before_shot]
async def main():
    url = sys.argv[1]; out = sys.argv[2]
    wait = float(sys.argv[3]) if len(sys.argv) > 3 else 6
    w = int(sys.argv[4]) if len(sys.argv) > 4 else 1280
    h = int(sys.argv[5]) if len(sys.argv) > 5 else 720
    js = sys.argv[6] if len(sys.argv) > 6 else None
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'])
        pg = await b.new_page(viewport={'width': w, 'height': h})
        logs = []
        pg.on('console', lambda m: logs.append(f'{m.type}: {m.text}'))
        pg.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
        t0 = time.time()
        await pg.goto(url)
        await pg.wait_for_timeout(int(wait*1000))
        if js:
            r = await pg.evaluate(js)
            if r is not None: print('JS:', json.dumps(r)[:3000])
            await pg.wait_for_timeout(1500)
        await pg.screenshot(path=out)
        for l in logs[:40]: print(l)
        print('elapsed', round(time.time()-t0,1))
        await b.close()
asyncio.run(main())
