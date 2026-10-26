"""Writes the card list templates in public/templates/ (an .xlsx and a .csv).

The cards match src/games/lane-clash.yaml; tests/templates.test.ts checks they stay in sync.
Run from the repository root: python3 scripts/make-card-template.py
"""

import csv
import zipfile
from xml.sax.saxutils import escape

CARD_COLUMNS = ['name', 'count', 'cost', 'power', 'ability type', 'ability', 'notes']
CARDS = [
    ['Scout', 1, 1, 2, '', '', 'A cheap card to play on turn 1.'],
    ['Lookout', 1, 1, 1, 'On Reveal', 'Draw a card.', 'Only if you hold fewer than 7 cards.'],
    ['Squire', 1, 2, 3, '', '', ''],
    ['Medic', 1, 2, 2, 'On Reveal', 'Your other cards here get +1 power.', ''],
    ['Trickster', 1, 2, 1, 'On Reveal', 'If your opponent has a card here, +3 power.', ''],
    ['Banner Bearer', 1, 3, 3, 'Ongoing', 'Your other cards here have +1 power.', ''],
    ['Saboteur', 1, 3, 3, 'On Reveal', 'Enemy cards here get -1 power.', ''],
    ['Guard', 1, 3, 4, '', '', ''],
    ['Knight', 1, 4, 6, '', '', ''],
    ['Siege Engine', 1, 4, 4, 'On Reveal', 'If this is your only card here, +4 power.', ''],
    ['Giant', 1, 5, 9, '', '', ''],
    ['Dragon', 1, 6, 12, '', '', 'The most expensive card; only playable on turn 6.'],
]
LOCATION_COLUMNS = ['location', 'effect']
LOCATIONS = [
    ['Plains', 'No effect.'],
    ['Forge', 'Cards played here get +1 power.'],
    ['Bog', 'Ongoing: cards here have -1 power.'],
]
HELP = [
    ['How to fill in this card list'],
    [''],
    ['One row per different card. Delete the example rows and add your own.'],
    ['name: the card name exactly as it appears in your rules.'],
    ['count: how many copies are in the game (or in each deck; say which in your rules or the notes column).'],
    ['cost, power: numbers. Rename, remove or add columns to fit your game, e.g. suit, colour, victory points.'],
    ['ability type and ability: what the card does, in plain English, as printed on the card.'],
    ['notes: anything that helps explain the card, such as timing, limits or which deck it belongs to.'],
    [''],
    ['The Locations sheet is optional; use it for boards, locations or other non-card pieces with effects.'],
    ['Upload this file as the card list on the "Upload a game" page, together with your rulebook.'],
    ['Excel (.xlsx) and CSV both work. Claude reads every sheet with data.'],
]


def col(i):
    return chr(ord('A') + i)


def sheet_xml(rows, widths, freeze=True):
    cols = ''.join(f'<col min="{i + 1}" max="{i + 1}" width="{w}" customWidth="1"/>' for i, w in enumerate(widths))
    body = []
    for r, row in enumerate(rows, 1):
        cells = []
        for c, v in enumerate(row):
            ref = f'{col(c)}{r}'
            style = ' s="1"' if r == 1 else ''
            if isinstance(v, (int, float)):
                cells.append(f'<c r="{ref}"{style}><v>{v}</v></c>')
            elif v != '':
                cells.append(f'<c r="{ref}" t="inlineStr"{style}><is><t>{escape(v)}</t></is></c>')
        body.append(f'<row r="{r}">{"".join(cells)}</row>')
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + ('<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' if freeze else '')
        + f'<cols>{cols}</cols><sheetData>{"".join(body)}</sheetData></worksheet>'
    )


def write_xlsx(path, sheets):
    rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
    overrides = ''.join(
        f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        for i in range(1, len(sheets) + 1)
    )
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr(
            '[Content_Types].xml',
            '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
            f'{overrides}</Types>',
        )
        z.writestr(
            '_rels/.rels',
            f'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            f'<Relationship Id="rId1" Type="{rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        )
        sheet_entries = ''.join(f'<sheet name="{escape(name)}" sheetId="{i}" r:id="rId{i}"/>' for i, (name, _, _) in enumerate(sheets, 1))
        z.writestr('xl/workbook.xml', f'<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="{main}" xmlns:r="{rel}"><sheets>{sheet_entries}</sheets></workbook>')
        rels = ''.join(f'<Relationship Id="rId{i}" Type="{rel}/worksheet" Target="worksheets/sheet{i}.xml"/>' for i in range(1, len(sheets) + 1))
        styles_rel = f'<Relationship Id="rId{len(sheets) + 1}" Type="{rel}/styles" Target="styles.xml"/>'
        z.writestr(
            'xl/_rels/workbook.xml.rels',
            f'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{rels}{styles_rel}</Relationships>',
        )
        # Style 1 is bold, used for header rows.
        z.writestr(
            'xl/styles.xml',
            f'<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="{main}">'
            '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
            '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
            '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
            '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
            '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>'
            '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
            '</styleSheet>',
        )
        for i, (name, rows, widths) in enumerate(sheets, 1):
            z.writestr(f'xl/worksheets/sheet{i}.xml', sheet_xml(rows, widths, freeze=not name.startswith('How')))


write_xlsx(
    'public/templates/card-list-template.xlsx',
    [
        ('Cards', [CARD_COLUMNS, *CARDS], [16, 8, 8, 8, 14, 44, 44]),
        ('Locations', [LOCATION_COLUMNS, *LOCATIONS], [16, 44]),
        ('How to fill this in', HELP, [110]),
    ],
)
with open('public/templates/card-list-template.csv', 'w', newline='', encoding='utf-8') as f:
    csv.writer(f, lineterminator='\n').writerows([CARD_COLUMNS, *CARDS])
print('Wrote public/templates/card-list-template.xlsx and .csv')
