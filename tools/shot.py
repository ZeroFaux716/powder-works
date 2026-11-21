import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        pg = await b.new_page(viewport={'width':1200,'height':760})
        errs=[]
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type=='error' else None)
        await pg.route('**/planck.min.js', lambda r: r.fulfill(path='/home/claude/powderworks/node_modules/planck/dist/planck.min.js', content_type='application/javascript'))
        await pg.goto('file:///home/claude/powderworks/index.html')
        await pg.wait_for_timeout(800)
        box = await pg.locator('#view').bounding_box()
        s = min(box['width']/240, box['height']/150)
        ox = box['x'] + (box['width']-240*s)/2; oy = box['y'] + (box['height']-150*s)/2
        await pg.select_option('#preset', 'wind')
        await pg.click('#play')
        await pg.wait_for_timeout(4000)
        await pg.keyboard.press('f')
        await pg.keyboard.press('ArrowUp')
        await pg.mouse.move(ox+100*s, oy+120*s)
        await pg.mouse.down()
        await pg.mouse.move(ox+110*s, oy+120*s, steps=4)
        await pg.mouse.up()
        print('fan cells', await pg.evaluate("[fan.reduce((a, v) => a + (v === 3), 0), fanDir, tool, ([...bodies.values()][0].b.getAngularVelocity() * 9.55).toFixed(0) + ' rpm']"))
        await pg.mouse.move(ox+37*s, oy+88*s)
        await pg.wait_for_timeout(1000)
        await pg.screenshot(path='shot.png')
        print('errors', errs)
        await b.close()
asyncio.run(main())
