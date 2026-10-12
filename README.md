# Grille Designer

A browser app for designing speaker grilles cut from perforated sheet metal. You choose the sheet, set the size of the grille, then draw by punching or blanking the holes in the staggered grid.

No build step and no dependencies. Open `index.html` in a browser, or serve the folder (`npx serve .`).

## Features

**Material and size**
- Common stock sheets: metric R*d* T*c* (60° staggered), imperial (1/16" on 3/32", 1/8" on 3/16", …), square and 45° patterns. You can also enter a custom hole size and pitch.
- Rows can run horizontally or vertically. Sheet thickness is checked: you get a warning if the hole is smaller than the thickness, or the web is thinner than the sheet.
- Grille shape can be a rectangle (with corner radius) or a circle/ellipse. A solid margin sets the unperforated border, and quick-size presets cover common enclosures.
- Mounting holes: 4, 6 or 8, with inset and a keep-out ring around each.

**Drawing**
- Tools: Brush, Line, Rectangle, Ellipse, Stamp, Text, Bucket fill and Pan.
- Each tool has a width, filled or outline mode, and snap-to-hole-centre.
- Two paint modes: **Punch** and **Blank**. Right-click paints with the opposite mode.
- Symmetry: Mirror X, Mirror Y, Mirror XY, Radial (N-fold), and Kaleidoscope (N-fold plus mirrors). Symmetry applies to every drawing tool.
- 20 preset stamps, including heart, stars, hexagon, bolt, note, speaker, gear, wave and target.
- Pattern generators: rings, spokes, spiral, stripes, waves, checker, radial and linear gradients (dithered), halftone, border frame, random and Voronoi cells. Each shows a live preview before you apply it.
- Image/logo import, with threshold or dither, scale and offset.
- Driver guides: dashed circles that show where the drivers sit. "Punch inside guides" punches only the holes inside them.

**Output**
- Live stats: hole count, punched count, and open area %. You get a hint when the open area is below about 30%, which is the acoustic rule of thumb.
- Preview mode renders the grille in a chosen finish (steel, black, white, brass, copper or bronze), with an optional backlit look.
- Export to **SVG** (1:1 mm), **DXF R12** (layers OUTLINE / HOLES / MOUNTING), **CSV** hole coordinates, and **PNG**.
- Save and open projects as JSON. Work also autosaves in the browser. Undo/redo covers material and size changes too.

## Shortcuts

| Key | Action |
| --- | --- |
| B L R O S T F H | Brush, Line, Rect, Ellipse, Stamp, Text, Fill, Pan |
| X | Toggle Punch / Blank |
| [ / ] | Brush width |
| Shift (drag) | Square / circle / 15° line |
| Alt (drag) | Draw from centre |
| Space-drag, middle mouse, wheel | Pan / zoom |
| 0 | Fit to screen |
| P | Edit / Preview |
| I | Invert |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
| Ctrl+S | Save project |

If you change the material or size after drawing, the app moves the design onto the new grid by nearest hole.
