# Builds the single-page game into dist/index.html from the sources in src/.
# Usage: python3 build.py
import os
here = os.path.dirname(os.path.abspath(__file__))
src = lambda name: open(os.path.join(here, 'src', name), encoding='utf-8').read()
head = src('head.html').replace('</style>', src('add2.css') + '</style>')
head = head.replace("#readout { color: var(--dim); flex: none; width: 34ch; text-align: right; }", "#readout { color: var(--dim); flex: none; width: 54ch; text-align: right; }")
head = head.replace("  #readout { width: 26ch; font-size: 11px; }", "  #readout { width: 30ch; font-size: 11px; }")
out = head + src('body.html') + "<script>\n//<SIM>\n" + src('sim.js') + "//</SIM>\n" + src('ui.js') + "</script>\n</body>\n</html>\n"
os.makedirs(os.path.join(here, 'dist'), exist_ok=True)
open(os.path.join(here, 'dist', 'index.html'), 'w', encoding='utf-8').write(out)
print('built dist/index.html,', len(out), 'characters')
