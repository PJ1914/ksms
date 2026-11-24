# Fresh Mandi — Illustration & Icon Prompts (semi-realistic 3D) (Gemini)

The chosen UI style is **Fresh Mandi**: light, leafy and friendly. The assets are **semi-realistic 3D renders** (real materials, studio lighting, no cartoon outlines), so the app looks like a real product, not a kids' app.
There are **14 sheets with 6 assets each, so 84 assets in total**. Together they cover every screen in the app.

---

## How to use this file

1. Copy one **full sheet prompt** (each prompt is self-contained, with the style block already inside) and paste it into Gemini.
2. Generate at the **highest resolution**, with a **3:2 landscape** aspect ratio (3 columns × 2 rows).
3. If an item comes out wrong, regenerate that sheet. Don't try to fix a single cell by hand.
4. Batch process:
   - Cut each sheet into a 3 × 2 grid, which gives 6 PNGs.
   - Remove the white background (keep the soft contact shadow semi-transparent if your tool supports it).
   - Upscale 4× with your local upscaler.
   - Export PNG and WebP at **@1x / @2x / @3x** for React Native.
5. Name files as in the table under each sheet, e.g. `s01-01-app-icon.png`.
6. Put the final files in `ksms/apps/mobile/assets/illustrations/` and `ksms/apps/mobile/assets/icons/`.

**Grid order inside every sheet:**

```
[ 1 ] [ 2 ] [ 3 ]
[ 4 ] [ 5 ] [ 6 ]
```

### Fresh Mandi palette (used in every prompt)

| Role                     | Hex                  |
| ------------------------ | -------------------- |
| Leaf green (primary)     | `#1E7A4C`            |
| Light leaf               | `#7FD49B`            |
| Mint wash                | `#E3F0E6`            |
| Mango yellow (accent)    | `#F5B83D`            |
| Soft mango               | `#FFD35C`            |
| Tomato red               | `#FF7A59`            |
| Carrot orange            | `#FF9F43`            |
| Sky blue                 | `#8EB8FF`            |
| Lavender                 | `#EADCFB`            |
| Ink (dark text, shadows) | `#15241B`            |
| Background               | Pure white `#FFFFFF` |

### Two asset types

- **Illustration**: a larger 3D scene used for heroes, success screens and empty states. It is isolated on white with a soft contact shadow.
- **Icon**: a compact 3D product or feature object used for categories, payment types, alerts and tiles. It is isolated on white with a soft contact shadow. If you want a sticker look later, add the white outline and shadow in code or during batch processing, not in Gemini.

---

## Sheet 1: Brand and main heroes (illustrations)

**Used on:** app icon, splash, Login, Home hero card, Khata summary, Bill saved

```
Create ONE image: a clean 3-column × 2-row grid of 6 separate 3D illustrations on a pure white #FFFFFF background, 3:2 landscape, high resolution. Each illustration sits centered in its own equal cell with generous white padding around it (at least 12% of the cell on every side). Illustrations must NOT touch or overlap each other or the cell edges. No grid lines, no borders between cells, no text, no letters, no numbers, no logos, no watermark.

STYLE (apply to all 6): premium SEMI-REALISTIC 3D RENDER, the quality of hero visuals in top Indian commerce and fintech apps. Realistic materials and textures (woven cane, cotton cloth sacks, paper, cardboard, glass, brushed steel, brass, wood grain, fresh produce skin). Soft studio lighting from the top-left with a gentle fill light, soft natural contact shadows and subtle ambient occlusion, crisp focus everywhere. Believable real-world proportions. NOT cartoon, NOT childish, NOT flat clipart, NO black outlines, no exaggerated or cute features, no emoji look. Brand color grading (use these as the dominant tones in props, packaging, clothing and accents, while keeping materials natural): leaf green #1E7A4C, light leaf #7FD49B, mango yellow #F5B83D, soft mango #FFD35C, tomato red #FF7A59, carrot orange #FF9F43, sky blue #8EB8FF, soft lavender #EADCFB. Each subject is isolated and floating on pure white #FFFFFF with only a soft grey contact shadow beneath it (no floor, no backdrop, no colored shapes behind it). Same camera angle (slightly elevated 3/4 view, about 30 degrees), same lighting, same render quality and same scale across all 6, so they look like one professional set.

CELLS:
1 (top-left) — APP ICON MARK: a rounded-square (squircle) app icon in leaf green #1E7A4C containing a simple bold shop front: a mango-yellow and green striped scalloped awning on top, a white shop body with a small open doorway, centered and symmetrical. Very simple, iconic, readable at 48px. Flat, no tiny details.
2 (top-middle) — SPLASH HERO: a realistic middle-aged Indian shopkeeper (neat mustache, natural skin texture, leaf-green cotton kurta) standing behind a wooden kirana counter, warm natural smile, holding a smartphone. Realistic human proportions, like a high-end 3D character render, not a cartoon. Behind him shelves with colorful jars, sacks of grain and bottles. Warm and welcoming.
3 (top-right) — LOGIN SHOP FRONT: a full kirana shop front seen from the front: mango-yellow and green striped awning with scalloped edge, blank sign board on top (no text), open window with stacked shelves of jars, sacks, oil bottles and fruit, a green door on the right with a small blank hanging tag (no text).
4 (bottom-left) — HOME BASKET: a woven mango-yellow shopping basket overflowing with fresh groceries: a red tomato, a yellow mango, an orange carrot with green leaves, a small milk packet, a bunch of green leafy vegetables. Fresh and abundant.
5 (bottom-middle) — KHATA LEDGER: a traditional red-bound Indian ledger book (khata bahi) lying open with neat ruled lines (no readable text), a gold rupee coin standing next to it, a small green pen, two stacked coins. Communicates "credit book / money owed".
6 (bottom-right) — BILL SAVED SUCCESS: a glossy leaf-green 3D badge with a white check mark, a realistic thermal paper receipt curling out behind it, and a few floating gold coins and paper confetti pieces in mango and sky blue. Celebratory but restrained and premium.

Output: one single image containing exactly these 6 illustrations in the 3×2 grid, pure white background, nothing else.
```

| Cell | File                           | Screen                      |
| ---- | ------------------------------ | --------------------------- |
| 1    | `s01-01-app-icon.png`          | App icon, splash            |
| 2    | `s01-02-splash-shopkeeper.png` | Splash, About               |
| 3    | `s01-03-login-shopfront.png`   | Login                       |
| 4    | `s01-04-home-basket.png`       | Home → today's sales card   |
| 5    | `s01-05-khata-ledger.png`      | Khata → "You will get" card |
| 6    | `s01-06-bill-saved.png`        | Sale saved / Bill done      |

---

## Sheet 2: Secondary heroes (illustrations)

**Used on:** Sync, Daily closing, Reports, Suppliers, Collections, Offline banner

```
Create ONE image: a clean 3-column × 2-row grid of 6 separate 3D illustrations on a pure white #FFFFFF background, 3:2 landscape, high resolution. Each illustration centered in its own equal cell with generous white padding (at least 12% of the cell on every side). Illustrations must NOT touch or overlap each other or the cell edges. No grid lines, no text, no letters, no numbers, no logos, no watermark.

STYLE (apply to all 6): premium SEMI-REALISTIC 3D RENDER, the quality of hero visuals in top Indian commerce and fintech apps. Realistic materials and textures (woven cane, cotton cloth sacks, paper, cardboard, glass, brushed steel, brass, wood grain, fresh produce skin). Soft studio lighting from the top-left with a gentle fill light, soft natural contact shadows and subtle ambient occlusion, crisp focus everywhere. Believable real-world proportions. NOT cartoon, NOT childish, NOT flat clipart, NO black outlines, no exaggerated or cute features, no emoji look. Brand color grading (use these as the dominant tones in props, packaging, clothing and accents, while keeping materials natural): leaf green #1E7A4C, light leaf #7FD49B, mango yellow #F5B83D, soft mango #FFD35C, tomato red #FF7A59, carrot orange #FF9F43, sky blue #8EB8FF, soft lavender #EADCFB. Each subject is isolated and floating on pure white #FFFFFF with only a soft grey contact shadow beneath it (no floor, no backdrop, no colored shapes behind it). Same camera angle (slightly elevated 3/4 view, about 30 degrees), same lighting, same render quality and same scale across all 6, so they look like one professional set.

CELLS:
1 (top-left) — CLOUD SYNC & BACKUP: a smartphone and a small shop icon connected to a big soft white cloud above by two curved dotted arrows (one up, one down), a small green shield with a check on the cloud. Communicates "your data is safe and synced".
2 (top-middle) — DAILY CLOSING: an open cash drawer from a shop counter with neatly stacked rupee notes (green and mango tones, no printed numbers) and coins, a clipboard with a checklist (lines, ticks, no text) beside it, and a small moon/evening sun in the corner suggesting end of day.
3 (top-right) — REPORTS BOARD: a clean dashboard board on a small easel showing a rising bar chart in leaf green with one tall highlighted bar in mango, a small donut chart, and an upward arrow. A pencil leaning against it.
4 (bottom-left) — SUPPLIER DELIVERY: a small friendly delivery truck (leaf green cab, mango cargo box) with sacks of grain and cardboard boxes visible in the back, small motion lines. Facing right.
5 (bottom-middle) — COLLECTION AGENT: a young Indian man on a mango-yellow scooter with a shoulder bag, holding a smartphone, small coins floating nearby suggesting collecting payments. Friendly, moving right.
6 (bottom-right) — OFFLINE MODE: the same kirana shop front style (striped mango/green awning), with a small grey wifi symbol crossed out floating above, and a green check badge on the shop — meaning "works even without internet". Calm, not alarming.

Output: one single image containing exactly these 6 illustrations in the 3×2 grid, pure white background, nothing else.
```

| Cell | File                          | Screen                         |
| ---- | ----------------------------- | ------------------------------ |
| 1    | `s02-01-sync-backup.png`      | Sync status                    |
| 2    | `s02-02-daily-closing.png`    | Daily closing                  |
| 3    | `s02-03-reports-board.png`    | Reports index header           |
| 4    | `s02-04-supplier-truck.png`   | Suppliers, Purchases header    |
| 5    | `s02-05-collection-agent.png` | Collections, Collection agents |
| 6    | `s02-06-offline-ok.png`       | Sync banner / offline state    |

---

## Sheet 3: Empty states 1 (illustrations)

**Used on:** Billing, New bill, Stock, Khata, Customer ledger, Search

```
Create ONE image: a clean 3-column × 2-row grid of 6 separate small empty-state 3D illustrations on a pure white #FFFFFF background, 3:2 landscape, high resolution. Each centered in its own equal cell with generous white padding (at least 15% of the cell on every side). No overlap, no grid lines, no text, no letters, no numbers, no watermark.

STYLE (apply to all 6): premium SEMI-REALISTIC 3D RENDER, the quality of hero visuals in top Indian commerce and fintech apps. Realistic materials and textures (woven cane, cotton cloth sacks, paper, cardboard, glass, brushed steel, brass, wood grain, fresh produce skin). Soft studio lighting from the top-left with a gentle fill light, soft natural contact shadows and subtle ambient occlusion, crisp focus everywhere. Believable real-world proportions. NOT cartoon, NOT childish, NOT flat clipart, NO black outlines, no exaggerated or cute features, no emoji look. Brand color grading (use these as the dominant tones in props, packaging, clothing and accents, while keeping materials natural): leaf green #1E7A4C, light leaf #7FD49B, mango yellow #F5B83D, soft mango #FFD35C, tomato red #FF7A59, carrot orange #FF9F43, sky blue #8EB8FF, soft lavender #EADCFB. Each subject is isolated and floating on pure white #FFFFFF with only a soft grey contact shadow beneath it (no floor, no backdrop, no colored shapes behind it). Same camera angle (slightly elevated 3/4 view, about 30 degrees), same lighting, same render quality and same scale across all 6, so they look like one professional set.

CELLS:
1 (top-left) — NO BILLS TODAY: a blank paper receipt with a curled bottom edge and a ballpoint pen lying beside it, meaning "the day has just started".
2 (top-middle) — EMPTY CART: an empty mango-yellow shopping basket tilted slightly, resting on its side.
3 (top-right) — NO PRODUCTS YET: an empty wooden shop shelf with one small cardboard box and a green plus sign badge floating above, meaning "add your first product".
4 (bottom-left) — NO CUSTOMERS YET: a stack of two blank paper customer cards with a leaf-green pen and a small mango plus badge, meaning "add your first customer".
5 (bottom-middle) — NO KHATA ENTRIES: a closed red ledger book with a small green check ribbon bookmark, clean and calm, meaning "nothing owed".
6 (bottom-right) — NO SEARCH RESULTS: a realistic magnifying glass with a leaf-green handle lying on an empty white paper sheet.

Output: one single image with exactly these 6 illustrations in the 3×2 grid on pure white, nothing else.
```

| Cell | File                         | Screen                       |
| ---- | ---------------------------- | ---------------------------- |
| 1    | `s03-01-empty-bills.png`     | Billing tab (no bills today) |
| 2    | `s03-02-empty-cart.png`      | New bill (bill is empty)     |
| 3    | `s03-03-empty-products.png`  | Stock (no products)          |
| 4    | `s03-04-empty-customers.png` | Khata (no customers)         |
| 5    | `s03-05-empty-khata.png`     | Customer ledger (no entries) |
| 6    | `s03-06-empty-search.png`    | Any search with no results   |

---

## Sheet 4: Empty states 2 (illustrations)

**Used on:** Expiring stock, Notifications, Held bills, Purchases, Suppliers, Expenses

```
Create ONE image: a clean 3-column × 2-row grid of 6 separate small empty-state 3D illustrations on a pure white #FFFFFF background, 3:2 landscape, high resolution. Each centered in its own equal cell with generous white padding (at least 15% of the cell on every side). No overlap, no grid lines, no text, no letters, no numbers, no watermark.

STYLE (apply to all 6): premium SEMI-REALISTIC 3D RENDER, the quality of hero visuals in top Indian commerce and fintech apps. Realistic materials and textures (woven cane, cotton cloth sacks, paper, cardboard, glass, brushed steel, brass, wood grain, fresh produce skin). Soft studio lighting from the top-left with a gentle fill light, soft natural contact shadows and subtle ambient occlusion, crisp focus everywhere. Believable real-world proportions. NOT cartoon, NOT childish, NOT flat clipart, NO black outlines, no exaggerated or cute features, no emoji look. Brand color grading (use these as the dominant tones in props, packaging, clothing and accents, while keeping materials natural): leaf green #1E7A4C, light leaf #7FD49B, mango yellow #F5B83D, soft mango #FFD35C, tomato red #FF7A59, carrot orange #FF9F43, sky blue #8EB8FF, soft lavender #EADCFB. Each subject is isolated and floating on pure white #FFFFFF with only a soft grey contact shadow beneath it (no floor, no backdrop, no colored shapes behind it). Same camera angle (slightly elevated 3/4 view, about 30 degrees), same lighting, same render quality and same scale across all 6, so they look like one professional set.

CELLS:
1 (top-left) — NOTHING EXPIRING: a fresh milk packet and a green apple side by side with a small green check badge , meaning "everything is fresh".
2 (top-middle) — NO NOTIFICATIONS: a polished brass desk service bell resting quietly on a folded cotton cloth, no motion lines, meaning "all quiet".
3 (top-right) — NO HELD BILLS: a pause symbol inside a soft green rounded square, with a small receipt behind it and a check badge — "no bills on hold".
4 (bottom-left) — NO PURCHASES: an empty cardboard delivery box with flaps open, a few packing straws inside.
5 (bottom-middle) — NO SUPPLIERS: a realistic handshake between two Indian men's hands (one leaf-green shirt cuff, one mango cuff) with a small plus badge — "add your first supplier".
6 (bottom-right) — NO EXPENSES: a slim wallet in leaf green, closed, with one coin beside it and a small check badge — "no expenses recorded".

Output: one single image with exactly these 6 illustrations in the 3×2 grid on pure white, nothing else.
```

| Cell | File                             | Screen                  |
| ---- | -------------------------------- | ----------------------- |
| 1    | `s04-01-empty-expiring.png`      | Stock → Expiring (none) |
| 2    | `s04-02-empty-notifications.png` | Notifications           |
| 3    | `s04-03-empty-held.png`          | Held bills              |
| 4    | `s04-04-empty-purchases.png`     | Purchases               |
| 5    | `s04-05-empty-suppliers.png`     | Suppliers               |
| 6    | `s04-06-empty-expenses.png`      | Expenses                |

---

## Sheet 5: Empty states 3 and system states (illustrations)

**Used on:** Collections, Stock movements, Error, Role locked, Camera permission, Dues cleared

```
Create ONE image: a clean 3-column × 2-row grid of 6 separate small 3D illustrations on a pure white #FFFFFF background, 3:2 landscape, high resolution. Each centered in its own equal cell with generous white padding (at least 15% of the cell on every side). No overlap, no grid lines, no text, no letters, no numbers, no watermark.

STYLE (apply to all 6): premium SEMI-REALISTIC 3D RENDER, the quality of hero visuals in top Indian commerce and fintech apps. Realistic materials and textures (woven cane, cotton cloth sacks, paper, cardboard, glass, brushed steel, brass, wood grain, fresh produce skin). Soft studio lighting from the top-left with a gentle fill light, soft natural contact shadows and subtle ambient occlusion, crisp focus everywhere. Believable real-world proportions. NOT cartoon, NOT childish, NOT flat clipart, NO black outlines, no exaggerated or cute features, no emoji look. Brand color grading (use these as the dominant tones in props, packaging, clothing and accents, while keeping materials natural): leaf green #1E7A4C, light leaf #7FD49B, mango yellow #F5B83D, soft mango #FFD35C, tomato red #FF7A59, carrot orange #FF9F43, sky blue #8EB8FF, soft lavender #EADCFB. Each subject is isolated and floating on pure white #FFFFFF with only a soft grey contact shadow beneath it (no floor, no backdrop, no colored shapes behind it). Same camera angle (slightly elevated 3/4 view, about 30 degrees), same lighting, same render quality and same scale across all 6, so they look like one professional set.

CELLS:
1 (top-left) — NO COLLECTIONS YET: a realistic open palm with one gold rupee coin resting on it.
2 (top-middle) — NO STOCK MOVEMENT: a single cardboard box with two small curved arrows around it (one green, one tomato) resting still, meaning "no ins or outs yet".
3 (top-right) — SOMETHING WENT WRONG: a shop-counter tablet on a stand with a dimmed blank screen and a steel wrench resting beside it. Calm, not scary.
4 (bottom-left) — NOT AVAILABLE FOR YOUR ROLE: a mango padlock in front of a leaf-green ID card / badge with a simple person silhouette.
5 (bottom-middle) — CAMERA PERMISSION FOR SCANNING: a smartphone with a camera lens on screen and a barcode with scanning corner brackets, a green check badge.
6 (bottom-right) — ALL DUES CLEARED: a ledger book closed with a green ribbon tied in a bow and a soft glint of light — celebratory, "customer has paid everything".

Output: one single image with exactly these 6 illustrations in the 3×2 grid on pure white, nothing else.
```

| Cell | File                           | Screen                        |
| ---- | ------------------------------ | ----------------------------- |
| 1    | `s05-01-empty-collections.png` | Collections                   |
| 2    | `s05-02-empty-movement.png`    | Product → movement (none)     |
| 3    | `s05-03-error.png`             | Any load error                |
| 4    | `s05-04-role-locked.png`       | "Not available for your role" |
| 5    | `s05-05-camera-permission.png` | Scan barcode permission       |
| 6    | `s05-06-dues-cleared.png`      | Customer with ₹0 due          |

---

## Sheet 6: Product categories 1 (icons)

**Used on:** Category chips, product placeholder images, Categories screen

```
Create ONE image: a clean 3-column × 2-row grid of 6 separate 3D product icons on a pure white #FFFFFF background, 3:2 landscape, high resolution. Each icon centered in its own equal cell with generous white padding (at least 15% of the cell on every side). No overlap, no grid lines, no text, no letters, no numbers, no brand names, no logos on packaging, no watermark.

STYLE (apply to all 6): premium SEMI-REALISTIC 3D RENDERED PRODUCT ICONS, like the category and feature icons in top Indian grocery delivery apps. Realistic materials (paper, plastic packaging with soft sheen, glass, metal, cloth, fresh produce), soft studio lighting from the top-left, gentle reflections, soft grey contact shadow under each object. Compact, clean composition that still reads clearly at 48px. NOT cartoon, NOT childish, NOT flat clipart, NO black outlines, no faces on objects. Brand color grading (use these as the dominant tones in props, packaging, clothing and accents, while keeping materials natural): leaf green #1E7A4C, light leaf #7FD49B, mango yellow #F5B83D, soft mango #FFD35C, tomato red #FF7A59, carrot orange #FF9F43, sky blue #8EB8FF, soft lavender #EADCFB. Each object isolated on pure white #FFFFFF (no border, no backdrop, no colored circle behind it, except where a cell asks for a badge). Packaging is generic and unbranded: plain colored panels and simple shapes instead of any text. Same camera angle (slightly elevated 3/4 view), lighting, scale and render quality across all 6.

CELLS:
1 (top-left) — ATTA / FLOUR: a soft white flour sack bag tied at the top with a mango band, a green plain label panel, a small wheat stalk icon on it, a little flour dusting at the base.
2 (top-middle) — RICE: a cloth rice sack open at the top showing white grains heaped, a green tie, a few grains spilled in front.
3 (top-right) — DAL / PULSES: a clear round jar filled with orange-yellow lentils (toor dal), mango lid, a small wooden scoop leaning against it.
4 (bottom-left) — OIL & GHEE: a tall clear plastic cooking oil bottle with golden oil and a green cap, next to a small brass-colored ghee tin.
5 (bottom-middle) — SUGAR & SALT: two small packets side by side — one white (sugar) with tiny crystal cubes in front, one sky blue (salt) with a pinch of grains.
6 (bottom-right) — SPICES / MASALA: three small heaps of spice powder in a round steel masala dabba (spice box) — turmeric yellow, chilli red, coriander green — with a dried red chilli on the side.

Output: one single image with exactly these 6 icons in the 3×2 grid on pure white, nothing else.
```

| Cell | File                        | Category          |
| ---- | --------------------------- | ----------------- |
| 1    | `s06-01-cat-atta.png`       | Atta and flour    |
| 2    | `s06-02-cat-rice.png`       | Rice              |
| 3    | `s06-03-cat-dal.png`        | Dal and pulses    |
| 4    | `s06-04-cat-oil-ghee.png`   | Oil and ghee      |
| 5    | `s06-05-cat-sugar-salt.png` | Sugar and salt    |
| 6    | `s06-06-cat-spices.png`     | Spices and masala |

---

## Sheet 7: Product categories 2 (icons)

```
Create ONE image: a clean 3-column × 2-row grid of 6 separate 3D product icons on a pure white #FFFFFF background, 3:2 landscape, high resolution. Each icon centered in its own equal cell with generous white padding (at least 15% of the cell on every side). No overlap, no grid lines, no text, no letters, no numbers, no brand names, no logos, no watermark.

STYLE (apply to all 6): premium SEMI-REALISTIC 3D RENDERED PRODUCT ICONS, like the category and feature icons in top Indian grocery delivery apps. Realistic materials (paper, plastic packaging with soft sheen, glass, metal, cloth, fresh produce), soft studio lighting from the top-left, gentle reflections, soft grey contact shadow under each object. Compact, clean composition that still reads clearly at 48px. NOT cartoon, NOT childish, NOT flat clipart, NO black outlines, no faces on objects. Brand color grading (use these as the dominant tones in props, packaging, clothing and accents, while keeping materials natural): leaf green #1E7A4C, light leaf #7FD49B, mango yellow #F5B83D, soft mango #FFD35C, tomato red #FF7A59, carrot orange #FF9F43, sky blue #8EB8FF, soft lavender #EADCFB. Each object isolated on pure white #FFFFFF (no border, no backdrop, no colored circle behind it, except where a cell asks for a badge). Packaging is generic and unbranded: plain colored panels and simple shapes instead of any text. Same camera angle (slightly elevated 3/4 view), lighting, scale and render quality across all 6.

CELLS:
1 (top-left) — DAIRY: a pillow-shaped milk pouch (white with a sky-blue band) next to a small cup of curd/dahi and a paneer cube.
2 (top-middle) — EGGS & BREAD: a loaf of sliced bread in a clear bag with a mango twist tie, with an egg tray holding three brown-white eggs in front.
3 (top-right) — TEA & COFFEE: a steaming glass of chai (cutting chai glass) with a small tea packet in leaf green behind it and two tea leaves.
4 (bottom-left) — COLD DRINKS & JUICE: a glass bottle of orange drink and a small tetra-pack juice box with a straw, condensation drops.
5 (bottom-middle) — SNACKS & NAMKEEN: a puffy chip/namkeen packet in tomato red with a clear window showing snack bits, a few pieces spilled in front.
6 (bottom-right) — BISCUITS: a stack of round golden biscuits with a partially opened rectangular biscuit packet in mango.

Output: one single image with exactly these 6 icons in the 3×2 grid on pure white, nothing else.
```

| Cell | File                        | Category              |
| ---- | --------------------------- | --------------------- |
| 1    | `s07-01-cat-dairy.png`      | Dairy                 |
| 2    | `s07-02-cat-eggs-bread.png` | Eggs and bread        |
| 3    | `s07-03-cat-tea-coffee.png` | Tea and coffee        |
| 4    | `s07-04-cat-drinks.png`     | Cold drinks and juice |
| 5    | `s07-05-cat-snacks.png`     | Snacks and namkeen    |
| 6    | `s07-06-cat-biscuits.png`   | Biscuits              |

---

## Sheet 8: Product categories 3 (icons)

```
Create ONE image: a clean 3-column × 2-row grid of 6 separate 3D product icons on a pure white #FFFFFF background, 3:2 landscape, high resolution. Each icon centered in its own equal cell with generous white padding (at least 15% of the cell on every side). No overlap, no grid lines, no text, no letters, no numbers, no brand names, no logos, no watermark.

STYLE (apply to all 6): premium SEMI-REALISTIC 3D RENDERED PRODUCT ICONS, like the category and feature icons in top Indian grocery delivery apps. Realistic materials (paper, plastic packaging with soft sheen, glass, metal, cloth, fresh produce), soft studio lighting from the top-left, gentle reflections, soft grey contact shadow under each object. Compact, clean composition that still reads clearly at 48px. NOT cartoon, NOT childish, NOT flat clipart, NO black outlines, no faces on objects. Brand color grading (use these as the dominant tones in props, packaging, clothing and accents, while keeping materials natural): leaf green #1E7A4C, light leaf #7FD49B, mango yellow #F5B83D, soft mango #FFD35C, tomato red #FF7A59, carrot orange #FF9F43, sky blue #8EB8FF, soft lavender #EADCFB. Each object isolated on pure white #FFFFFF (no border, no backdrop, no colored circle behind it, except where a cell asks for a badge). Packaging is generic and unbranded: plain colored panels and simple shapes instead of any text. Same camera angle (slightly elevated 3/4 view), lighting, scale and render quality across all 6.

CELLS:
1 (top-left) — FRUITS & VEGETABLES: a small cluster of a tomato, an onion, a potato, a green chilli and a banana.
2 (top-middle) — PERSONAL CARE: a bar of soap with a few bubbles, a small shampoo bottle in lavender and a toothpaste tube in sky blue.
3 (top-right) — HOME CLEANING: a detergent powder box in sky blue with a scoop, and a dishwash liquid bottle in leaf green, a few bubbles.
4 (bottom-left) — BABY CARE: a small baby milk bottle with a soft lavender cap and a folded diaper pack in mint.
5 (bottom-middle) — POOJA ITEMS: a small brass diya (oil lamp) with a mango flame, an incense stick holder with a thin curl of smoke, and a few marigold flowers.
6 (bottom-right) — OTHER / GENERAL: a neat cardboard box with the flaps closed and a small green tag hanging from it (tag blank, no text).

Output: one single image with exactly these 6 icons in the 3×2 grid on pure white, nothing else.
```

| Cell | File                           | Category              |
| ---- | ------------------------------ | --------------------- |
| 1    | `s08-01-cat-fruits-veg.png`    | Fruits and vegetables |
| 2    | `s08-02-cat-personal-care.png` | Personal care         |
| 3    | `s08-03-cat-cleaning.png`      | Home cleaning         |
| 4    | `s08-04-cat-baby.png`          | Baby care             |
| 5    | `s08-05-cat-pooja.png`         | Pooja items           |
| 6    | `s08-06-cat-other.png`         | Other / general       |

---

## Sheet 9: Payment icons

**Used on:** New bill payment options, Customer pay, Supplier pay, Cashbook

```
Create ONE image: a clean 3-column × 2-row grid of 6 separate 3D product icons on a pure white #FFFFFF background, 3:2 landscape, high resolution. Each icon centered in its own equal cell with generous white padding (at least 15% of the cell on every side). No overlap, no grid lines, no text, no letters, no numbers, no real QR codes, no bank or app logos, no watermark.

STYLE (apply to all 6): premium SEMI-REALISTIC 3D RENDERED PRODUCT ICONS, like the category and feature icons in top Indian grocery delivery apps. Realistic materials (paper, plastic packaging with soft sheen, glass, metal, cloth, fresh produce), soft studio lighting from the top-left, gentle reflections, soft grey contact shadow under each object. Compact, clean composition that still reads clearly at 48px. NOT cartoon, NOT childish, NOT flat clipart, NO black outlines, no faces on objects. Brand color grading (use these as the dominant tones in props, packaging, clothing and accents, while keeping materials natural): leaf green #1E7A4C, light leaf #7FD49B, mango yellow #F5B83D, soft mango #FFD35C, tomato red #FF7A59, carrot orange #FF9F43, sky blue #8EB8FF, soft lavender #EADCFB. Each object isolated on pure white #FFFFFF (no border, no backdrop, no colored circle behind it, except where a cell asks for a badge). Packaging is generic and unbranded: plain colored panels and simple shapes instead of any text. Same camera angle (slightly elevated 3/4 view), lighting, scale and render quality across all 6.

CELLS:
1 (top-left) — CASH: a small fanned stack of three rupee banknotes (green and mango tones, plain — no printed numbers or portraits) with two coins in front.
2 (top-middle) — UPI / SCAN TO PAY: a smartphone showing an abstract square pattern of blocks (NOT a real scannable QR) with a green check badge on the corner.
3 (top-right) — CARD: a payment card in leaf green with a gold chip and a small contactless wave symbol, tilted slightly.
4 (bottom-left) — KHATA / CREDIT: a small red ledger book with a pen clipped to it and a tiny clock badge, meaning "pay later".
5 (bottom-middle) — SPLIT PAYMENT: a rupee coin split into two halves, one half green and one half mango, with a small gap and two little arrows.
6 (bottom-right) — PAYMENT RECEIVED: a gold rupee coin landing into an open palm with a green check badge.

Output: one single image with exactly these 6 icons in the 3×2 grid on pure white, nothing else.
```

| Cell | File                      | Used for                          |
| ---- | ------------------------- | --------------------------------- |
| 1    | `s09-01-pay-cash.png`     | Payment: Cash                     |
| 2    | `s09-02-pay-upi.png`      | Payment: UPI                      |
| 3    | `s09-03-pay-card.png`     | Payment: Card                     |
| 4    | `s09-04-pay-khata.png`    | Payment: Khata / credit           |
| 5    | `s09-05-pay-split.png`    | Split payment                     |
| 6    | `s09-06-pay-received.png` | Customer pay success, Collections |

---

## Sheet 10: Alert and status icons

**Used on:** Home "Needs attention", Stock badges, Khata badges, Notifications

```
Create ONE image: a clean 3-column × 2-row grid of 6 separate 3D product icons on a pure white #FFFFFF background, 3:2 landscape, high resolution. Each icon centered in its own equal cell with generous white padding (at least 15% of the cell on every side). No overlap, no grid lines, no text, no letters, no numbers, no app logos, no watermark.

STYLE (apply to all 6): premium SEMI-REALISTIC 3D RENDERED PRODUCT ICONS, like the category and feature icons in top Indian grocery delivery apps. Realistic materials (paper, plastic packaging with soft sheen, glass, metal, cloth, fresh produce), soft studio lighting from the top-left, gentle reflections, soft grey contact shadow under each object. Compact, clean composition that still reads clearly at 48px. NOT cartoon, NOT childish, NOT flat clipart, NO black outlines, no faces on objects. Brand color grading (use these as the dominant tones in props, packaging, clothing and accents, while keeping materials natural): leaf green #1E7A4C, light leaf #7FD49B, mango yellow #F5B83D, soft mango #FFD35C, tomato red #FF7A59, carrot orange #FF9F43, sky blue #8EB8FF, soft lavender #EADCFB. Each object isolated on pure white #FFFFFF (no border, no backdrop, no colored circle behind it, except where a cell asks for a badge). Packaging is generic and unbranded: plain colored panels and simple shapes instead of any text. Same camera angle (slightly elevated 3/4 view), lighting, scale and render quality across all 6.

CELLS:
1 (top-left) — LOW STOCK: a nearly empty cardboard box with one small item left inside and a mango warning triangle badge (with a simple vertical bar and dot shape, no letters).
2 (top-middle) — EXPIRING SOON: a milk packet with a small tomato-red round clock badge on its corner showing hands near twelve.
3 (top-right) — OVER CREDIT LIMIT: a semicircle gauge meter with the needle pushed into the tomato-red zone (zones green, mango, tomato).
4 (bottom-left) — OVERDUE PAYMENT: a small desk calendar page (blank, no numbers) with a tomato circle mark and a tiny hourglass beside it.
5 (bottom-middle) — PAYMENT REMINDER: a green chat bubble with a small bell inside it and a soft sending motion trail (generic chat bubble, not any brand logo).
6 (bottom-right) — NOTIFICATION: a mango bell with a small tomato dot badge in the top-right corner and two small ringing lines.

Output: one single image with exactly these 6 icons in the 3×2 grid on pure white, nothing else.
```

| Cell | File                          | Used for                   |
| ---- | ----------------------------- | -------------------------- |
| 1    | `s10-01-alert-low-stock.png`  | Low stock tile and badge   |
| 2    | `s10-02-alert-expiring.png`   | Expiring tile and badge    |
| 3    | `s10-03-alert-over-limit.png` | Customer over credit limit |
| 4    | `s10-04-alert-overdue.png`    | Overdue customer, supplier |
| 5    | `s10-05-reminder.png`         | Send payment reminder      |
| 6    | `s10-06-notification.png`     | Notifications              |

---

## Sheet 11: Action icons

**Used on:** Scan, Bill done (print / invoice), Held bills, Sale and purchase returns, Stock adjust

```
Create ONE image: a clean 3-column × 2-row grid of 6 separate 3D product icons on a pure white #FFFFFF background, 3:2 landscape, high resolution. Each icon centered in its own equal cell with generous white padding (at least 15% of the cell on every side). No overlap, no grid lines, no text, no letters, no numbers, no logos, no watermark.

STYLE (apply to all 6): premium SEMI-REALISTIC 3D RENDERED PRODUCT ICONS, like the category and feature icons in top Indian grocery delivery apps. Realistic materials (paper, plastic packaging with soft sheen, glass, metal, cloth, fresh produce), soft studio lighting from the top-left, gentle reflections, soft grey contact shadow under each object. Compact, clean composition that still reads clearly at 48px. NOT cartoon, NOT childish, NOT flat clipart, NO black outlines, no faces on objects. Brand color grading (use these as the dominant tones in props, packaging, clothing and accents, while keeping materials natural): leaf green #1E7A4C, light leaf #7FD49B, mango yellow #F5B83D, soft mango #FFD35C, tomato red #FF7A59, carrot orange #FF9F43, sky blue #8EB8FF, soft lavender #EADCFB. Each object isolated on pure white #FFFFFF (no border, no backdrop, no colored circle behind it, except where a cell asks for a badge). Packaging is generic and unbranded: plain colored panels and simple shapes instead of any text. Same camera angle (slightly elevated 3/4 view), lighting, scale and render quality across all 6.

CELLS:
1 (top-left) — BARCODE SCAN: a handheld barcode scanner in leaf green emitting a thin tomato-red scan line onto a small barcode (plain vertical bars).
2 (top-middle) — PRINT RECEIPT: a small thermal receipt printer in white and green with a paper receipt coming out (lines only, no text).
3 (top-right) — GST INVOICE: a clean document page with a folded corner, a few grey lines and a round green stamp/seal with a simple percent-like symbol made of a slash and two dots.
4 (bottom-left) — HOLD BILL: a receipt clipped to a small clipboard with a mango pause badge (two vertical bars).
5 (bottom-middle) — RETURN / REFUND: a cardboard box with a curved arrow looping back to the left in tomato, and a small coin.
6 (bottom-right) — STOCK ADJUSTMENT: a slightly dented / torn cardboard box with a small green plus/minus toggle badge beside it.

Output: one single image with exactly these 6 icons in the 3×2 grid on pure white, nothing else.
```

| Cell | File                          | Used for                            |
| ---- | ----------------------------- | ----------------------------------- |
| 1    | `s11-01-act-scan.png`         | Scan barcode                        |
| 2    | `s11-02-act-print.png`        | Print bill                          |
| 3    | `s11-03-act-gst-invoice.png`  | GST invoice, GST settings           |
| 4    | `s11-04-act-hold.png`         | Hold bill, Held bills               |
| 5    | `s11-05-act-return.png`       | Sale return, Purchase return        |
| 6    | `s11-06-act-stock-adjust.png` | Stock adjust (damage, loss, expiry) |

---

## Sheet 12: Report icons 1

**Used on:** Reports index tiles, report page headers

```
Create ONE image: a clean 3-column × 2-row grid of 6 separate 3D product icons on a pure white #FFFFFF background, 3:2 landscape, high resolution. Each icon centered in its own equal cell with generous white padding (at least 15% of the cell on every side). No overlap, no grid lines, no text, no letters, no numbers, no logos, no watermark.

STYLE (apply to all 6): premium SEMI-REALISTIC 3D RENDERED PRODUCT ICONS, like the category and feature icons in top Indian grocery delivery apps. Realistic materials (paper, plastic packaging with soft sheen, glass, metal, cloth, fresh produce), soft studio lighting from the top-left, gentle reflections, soft grey contact shadow under each object. Compact, clean composition that still reads clearly at 48px. NOT cartoon, NOT childish, NOT flat clipart, NO black outlines, no faces on objects. Brand color grading (use these as the dominant tones in props, packaging, clothing and accents, while keeping materials natural): leaf green #1E7A4C, light leaf #7FD49B, mango yellow #F5B83D, soft mango #FFD35C, tomato red #FF7A59, carrot orange #FF9F43, sky blue #8EB8FF, soft lavender #EADCFB. Each object isolated on pure white #FFFFFF (no border, no backdrop, no colored circle behind it, except where a cell asks for a badge). Packaging is generic and unbranded: plain colored panels and simple shapes instead of any text. Same camera angle (slightly elevated 3/4 view), lighting, scale and render quality across all 6.

CELLS:
1 (top-left) — SALES REPORT: a bar chart card with four rising bars in leaf green and one tall bar in mango, a small shopping bag at its base.
2 (top-middle) — PROFIT: a small plant sprout growing out of a stack of gold coins with an upward green arrow.
3 (top-right) — CASH FLOW: a wallet with one arrow going in (green) and one arrow going out (tomato), circular flow.
4 (bottom-left) — DUES / MONEY OWED: an open ledger with a scale balance on top — one pan with coins, one pan lighter.
5 (bottom-middle) — STOCK VALUE: three stacked cardboard boxes with a gold coin badge on the top box.
6 (bottom-right) — COLLECTIONS: two hands — one giving and one receiving a gold coin — with a small green check badge.

Output: one single image with exactly these 6 icons in the 3×2 grid on pure white, nothing else.
```

| Cell | File                         | Used for           |
| ---- | ---------------------------- | ------------------ |
| 1    | `s12-01-rep-sales.png`       | Sales report       |
| 2    | `s12-02-rep-profit.png`      | Profit report      |
| 3    | `s12-03-rep-cashflow.png`    | Cash report        |
| 4    | `s12-04-rep-dues.png`        | Dues report        |
| 5    | `s12-05-rep-stock.png`       | Stock report       |
| 6    | `s12-06-rep-collections.png` | Collections report |

---

## Sheet 13: Report icons 2 and staff roles

**Used on:** Purchases report, Day book, user avatars (Owner, Manager, Cashier, Collection agent)

```
Create ONE image: a clean 3-column × 2-row grid of 6 separate 3D product icons on a pure white #FFFFFF background, 3:2 landscape, high resolution. Each icon centered in its own equal cell with generous white padding (at least 15% of the cell on every side). No overlap, no grid lines, no text, no letters, no numbers, no logos, no watermark.

STYLE (apply to all 6): premium SEMI-REALISTIC 3D RENDERED PRODUCT ICONS, like the category and feature icons in top Indian grocery delivery apps. Realistic materials (paper, plastic packaging with soft sheen, glass, metal, cloth, fresh produce), soft studio lighting from the top-left, gentle reflections, soft grey contact shadow under each object. Compact, clean composition that still reads clearly at 48px. NOT cartoon, NOT childish, NOT flat clipart, NO black outlines, no faces on objects. Brand color grading (use these as the dominant tones in props, packaging, clothing and accents, while keeping materials natural): leaf green #1E7A4C, light leaf #7FD49B, mango yellow #F5B83D, soft mango #FFD35C, tomato red #FF7A59, carrot orange #FF9F43, sky blue #8EB8FF, soft lavender #EADCFB. Each object isolated on pure white #FFFFFF (no border, no backdrop, no colored circle behind it, except where a cell asks for a badge). Packaging is generic and unbranded: plain colored panels and simple shapes instead of any text. Same camera angle (slightly elevated 3/4 view), lighting, scale and render quality across all 6.

CELLS:
1 (top-left) — PURCHASES REPORT: a shopping trolley with two sacks and a box inside, a small downward green arrow into a box (goods received).
2 (top-middle) — DAY BOOK: a thick bound daily register book with a small calendar tab and a pen.
3 (top-right) — OWNER AVATAR: head-and-shoulders of a middle-aged Indian man with a neat mustache, wearing a leaf-green kurta, inside a mango circular badge, a small brass lapel pin.
4 (bottom-left) — MANAGER AVATAR: head-and-shoulders of an Indian woman in her 30s with tied hair, wearing a sky-blue top, holding a small clipboard, inside a mint circular badge.
5 (bottom-middle) — CASHIER AVATAR: head-and-shoulders of a young Indian man wearing a mango shirt with a small apron strap, inside a light-leaf circular badge.
6 (bottom-right) — COLLECTION AGENT AVATAR: head-and-shoulders of a young Indian man with a shoulder bag strap and a cap, wearing a tomato shirt, inside a lavender circular badge.

Output: one single image with exactly these 6 icons in the 3×2 grid on pure white, nothing else.
```

| Cell | File                       | Used for              |
| ---- | -------------------------- | --------------------- |
| 1    | `s13-01-rep-purchases.png` | Purchases report      |
| 2    | `s13-02-rep-daybook.png`   | Day book report       |
| 3    | `s13-03-role-owner.png`    | Owner role / profile  |
| 4    | `s13-04-role-manager.png`  | Manager role          |
| 5    | `s13-05-role-cashier.png`  | Cashier role          |
| 6    | `s13-06-role-agent.png`    | Collection agent role |

---

## Sheet 14: More-menu feature icons

**Used on:** More tab tiles, the page headers of those screens, and the add forms

```
Create ONE image: a clean 3-column × 2-row grid of 6 separate 3D product icons on a pure white #FFFFFF background, 3:2 landscape, high resolution. Each icon centered in its own equal cell with generous white padding (at least 15% of the cell on every side). No overlap, no grid lines, no text, no letters, no numbers, no logos, no watermark.

STYLE (apply to all 6): premium SEMI-REALISTIC 3D RENDERED PRODUCT ICONS, like the category and feature icons in top Indian grocery delivery apps. Realistic materials (paper, plastic packaging with soft sheen, glass, metal, cloth, fresh produce), soft studio lighting from the top-left, gentle reflections, soft grey contact shadow under each object. Compact, clean composition that still reads clearly at 48px. NOT cartoon, NOT childish, NOT flat clipart, NO black outlines, no faces on objects. Brand color grading (use these as the dominant tones in props, packaging, clothing and accents, while keeping materials natural): leaf green #1E7A4C, light leaf #7FD49B, mango yellow #F5B83D, soft mango #FFD35C, tomato red #FF7A59, carrot orange #FF9F43, sky blue #8EB8FF, soft lavender #EADCFB. Each object isolated on pure white #FFFFFF (no border, no backdrop, no colored circle behind it, except where a cell asks for a badge). Packaging is generic and unbranded: plain colored panels and simple shapes instead of any text. Same camera angle (slightly elevated 3/4 view), lighting, scale and render quality across all 6.

CELLS:
1 (top-left) — EXPENSES: a few paper bills/receipts fanned out with a small light bulb and a small rupee coin, meaning "shop expenses like electricity and rent".
2 (top-middle) — CASHBOOK: a cash register / galla box (traditional wooden cash box) with an open drawer showing notes.
3 (top-right) — CATEGORIES: three colorful product tags (green, mango, sky blue) hanging together on a string loop.
4 (bottom-left) — ADD CUSTOMER: a blank paper customer card on a small clipboard with a pen and a mango plus badge.
5 (bottom-middle) — ADD SUPPLIER: a small warehouse building with a leaf-green roof and a mango plus badge.
6 (bottom-right) — ADD PRODUCT: a cardboard box with a mango plus badge on its corner.

Output: one single image with exactly these 6 icons in the 3×2 grid on pure white, nothing else.
```

| Cell | File                           | Used for                   |
| ---- | ------------------------------ | -------------------------- |
| 1    | `s14-01-feat-expenses.png`     | Expenses                   |
| 2    | `s14-02-feat-cashbook.png`     | Cashbook                   |
| 3    | `s14-03-feat-categories.png`   | Categories                 |
| 4    | `s14-04-feat-add-customer.png` | New customer               |
| 5    | `s14-05-feat-add-supplier.png` | New supplier               |
| 6    | `s14-06-feat-add-product.png`  | New product / edit product |

---

## Screen → asset map (all app screens)

| Screen (route)                                                                   | Assets                                             |
| -------------------------------------------------------------------------------- | -------------------------------------------------- |
| `login`                                                                          | s01-03                                             |
| `(tabs)/index`, Home                                                             | s01-04, s10-01, s10-02, s09-06, s02-06             |
| `(tabs)/stock`                                                                   | s06–s08 categories, s10-01, s10-02, s03-03, s03-06 |
| `(tabs)/billing`                                                                 | s03-01                                             |
| `(tabs)/khata`                                                                   | s01-05, s03-04, s10-03, s10-04                     |
| `(tabs)/more`                                                                    | s02-04, s02-05, s14-*, s12-01, s13-03              |
| `product/[id]`, `product-new`, `product-edit`                                    | category icon, s14-06, s05-02                      |
| `stock-adjust`                                                                   | s11-06                                             |
| `categories`                                                                     | s14-03, s06–s08                                    |
| `sale/new`, `sale/add-item`                                                      | s03-02, s09-01…05, s11-04                          |
| `sale/scan`                                                                      | s11-01, s05-05                                     |
| `sale/customer`                                                                  | s14-04                                             |
| `sale/[id]`, bill done                                                           | s01-06, s11-02, s11-03                             |
| `sale/return`                                                                    | s11-05                                             |
| `held-bills`                                                                     | s11-04, s04-03                                     |
| `customer/[id]`                                                                  | s10-03, s10-05, s05-06, s03-05                     |
| `customer/pay`                                                                   | s09-06                                             |
| `customer/adjust`, `customer-new`                                                | s14-04                                             |
| `collections`, `collection-agents`                                               | s02-05, s05-01, s13-06                             |
| `suppliers`, `supplier/[id]`, `supplier-new`, `supplier/pay`                     | s02-04, s04-05, s14-05, s09-*                      |
| `purchases`, `purchase/new`, `purchase/[id]`, `purchase/return`                  | s02-04, s04-04, s11-05                             |
| `expenses`                                                                       | s14-01, s04-06                                     |
| `cashbook`                                                                       | s14-02                                             |
| `daily-closing`                                                                  | s02-02                                             |
| `gst-settings`                                                                   | s11-03                                             |
| `notifications`                                                                  | s10-06, s04-02                                     |
| `sync`                                                                           | s02-01, s02-06                                     |
| `reports/index`                                                                  | s02-03, s12-*, s13-01, s13-02                      |
| `reports/*` (sales, profit, cash, dues, stock, purchases, collections, day-book) | matching s12 / s13 icon                            |
| Errors and role limits (any screen)                                              | s05-03, s05-04                                     |
| App icon / splash                                                                | s01-01, s01-02                                     |

---

## Quality checklist (check each sheet before batch processing)

- [ ] Exactly 6 items in a clean 3 × 2 grid, none touching each other or the edges
- [ ] Pure white background, with no gradient or texture behind the items
- [ ] **No text, letters or numbers anywhere** (regenerate if Gemini adds any)
- [ ] Same lighting, camera angle, render quality and colors as Sheet 1
- [ ] No black cartoon outlines and no flat clipart look; materials look real
- [ ] Nothing looks childish: no cute faces on objects, no exaggerated proportions
- [ ] No real brand names or logos on any packaging

**Tip for consistency:** after Sheet 1 comes out well, upload it to Gemini along with every later prompt and add this line at the top of the prompt:
`Match the exact render style, lighting, camera angle, materials and colors of the attached reference image.`
