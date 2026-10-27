"""Writes public/templates/deck-template.xlsx: the Not Snap starter deck plus a sheet explaining the columns.

The rows come from src/games/not-snap.yaml (tests/deck.test.ts checks they stay in sync). Needs openpyxl.
Run from the repository root: npx tsx scripts/deck-template-data.ts | python3 scripts/make-deck-template.py
"""

import json, csv, io, sys, openpyxl
from openpyxl.styles import Font
d=json.load(sys.stdin)
wb=openpyxl.Workbook()
ws=wb.active; ws.title='Deck'
for i,row in enumerate(csv.reader(io.StringIO(d['csv']))):
    if not row: continue
    out=[]
    for j,v in enumerate(row):
        if i>0 and j in (1,2,3,5) and v!='': v=int(v)
        out.append(v if v!='' else None)
    ws.append(out)
for c in ws[1]: c.font=Font(bold=True)
for col,w in zip('ABCDEFG',(16,11,7,7,15,9,52)): ws.column_dimensions[col].width=w
ws.freeze_panes='A2'
h=wb.create_sheet('How to fill this in')
h.append(['Column','What it means'])
for c in h[1]: c.font=Font(bold=True)
for r in [('Name',"The card's name. Required, and each name only once."),
 ('Per Player',"Copies of the card in each player's deck. Empty means 1."),
 ('Cost','Energy needed to play it (a whole number). Empty counts as 0.'),
 ('Power','Its power at a location (a whole number). Empty counts as 0.'),
 ('Effect','Optional ability: one of the effects below. Leave empty for no ability.'),
 ('Amount','The number the Effect uses. Required when Effect is set.'),
 ('Ability','The card text, for people reading the deck. Not used by the simulator.')]:
    h.append(list(r))
h.append([])
h.append(['Effect','What it does'])
for c in h[h.max_row]: c.font=Font(bold=True)
for e in d['effects']: h.append([e['label'],e['description']])
h.append([]); h.append(['','Card Tester reads only the first sheet (Deck).'])
h.column_dimensions['A'].width=16; h.column_dimensions['B'].width=90
wb.save("public/templates/deck-template.xlsx")
