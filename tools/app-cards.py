#!/usr/bin/env python3
"""
One picture per live app, labelled free or paid.

    python3 tools/app-cards.py [outdir]

Reads catalog.json - the same file the shop reads - so the set is always
whatever is actually on sale today. An app that is hidden or still coming
soon is not in here, because a picture of something nobody can buy is a
picture that starts a conversation you cannot finish.

Free or paid is said three times on purpose: in the filename (so the
folder sorts into two groups), in a badge on the artwork (so it survives
being scaled to a thumbnail), and in the price line. Nothing here is
typed by hand, so it cannot drift from the shop.
"""
import json, os, sys, re
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT  = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'app-cards')
F    = '/mnt/skills/examples/canvas-design/canvas-fonts'

W, H      = 1200, 1200
ART_H     = 760                       # artwork above, facts below
INK       = (11, 13, 17)
WHITE     = (255, 255, 255)
MUTED     = (150, 158, 172)
FREE_BG   = (46, 204, 113)

def font(name, size):
    return ImageFont.truetype(os.path.join(F, name), size)

BOLD, REG = 'InstrumentSans-Bold.ttf', 'InstrumentSans-Regular.ttf'

def hex_rgb(h, fallback=(139, 123, 255)):
    h = (h or '').lstrip('#')
    if len(h) != 6: return fallback
    try: return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
    except ValueError: return fallback

def cover(img, w, h):
    """Fill the box, crop the overflow - never squash. A stretched
       screenshot reads as a mistake before it reads as an app."""
    img = img.convert('RGB')
    s = max(w / img.width, h / img.height)
    img = img.resize((max(1, round(img.width * s)), max(1, round(img.height * s))), Image.LANCZOS)
    return img.crop(((img.width - w) // 2, (img.height - h) // 2,
                     (img.width - w) // 2 + w, (img.height - h) // 2 + h))

def wrap(draw, text, fnt, width, lines=2):
    words, out, cur = str(text or '').split(), [], ''
    for word in words:
        t = (cur + ' ' + word).strip()
        if draw.textlength(t, font=fnt) <= width: cur = t
        else:
            if cur: out.append(cur)
            cur = word
            if len(out) == lines: break
    if cur and len(out) < lines: out.append(cur)
    if len(out) == lines and len(' '.join(out).split()) < len(words):
        while out[-1] and draw.textlength(out[-1] + '...', font=fnt) > width:
            out[-1] = out[-1].rsplit(' ', 1)[0] if ' ' in out[-1] else out[-1][:-1]
        out[-1] += '...'
    return out

def money(cents):
    d = cents / 100
    return '$%d' % d if d == int(d) else '$%.2f' % d

PLAT = {'windows': 'Windows', 'mac': 'macOS', 'mac-arm64': 'macOS', 'mac-x64': 'macOS',
        'android': 'Android', 'ios': 'iPhone', 'linux': 'Linux'}

def card(app_id, a, path):
    accent = hex_rgb(a.get('color'))
    free   = bool(a.get('free'))

    im = Image.new('RGB', (W, H), INK)
    art_path = os.path.join(ROOT, a.get('art') or '')
    if os.path.exists(art_path):
        im.paste(cover(Image.open(art_path), W, ART_H), (0, 0))
    else:
        im.paste(Image.new('RGB', (W, ART_H), accent), (0, 0))

    # The artwork fades into the band rather than stopping dead at a seam.
    fade_h = 190
    fade = Image.new('L', (1, fade_h))
    for y in range(fade_h):
        fade.putpixel((0, y), int(255 * (y / fade_h) ** 1.4))
    im.paste(Image.new('RGB', (W, fade_h), INK),
             (0, ART_H - fade_h), fade.resize((W, fade_h)))

    d = ImageDraw.Draw(im)
    d.rectangle([0, ART_H, W, ART_H + 5], fill=accent)      # the app's own colour

    # ---- the badge, on the artwork, where a thumbnail still shows it ----
    label   = 'FREE' if free else 'PAID'
    bfont   = font(BOLD, 34)
    bg      = FREE_BG if free else accent
    tw      = d.textlength(label, font=bfont)
    bx, by  = 48, 48
    d.rounded_rectangle([bx, by, bx + tw + 60, by + 66], radius=33, fill=bg)
    # Dark text on a light badge, light on a dark one - luminance, not taste.
    lum = (0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2])
    d.text((bx + 30, by + 15), label, font=bfont, fill=INK if lum > 150 else WHITE)

    # ---- the facts ----
    y = ART_H + 54
    nf = font(BOLD, 68)
    name = a.get('name') or app_id
    while d.textlength(name, font=nf) > W - 128 and nf.size > 34:
        nf = font(BOLD, nf.size - 3)
    d.text((64, y), name, font=nf, fill=WHITE); y += nf.size + 26

    tf = font(REG, 30)
    for line in wrap(d, a.get('tagline'), tf, W - 128, 2):
        d.text((64, y), line, font=tf, fill=MUTED); y += 42

    # price, bottom left - the third place it says which kind of app this is
    pf, sf = font(BOLD, 46), font(REG, 26)
    py = H - 104
    if free:
        d.text((64, py), 'Free', font=pf, fill=FREE_BG)
        note = 'Free for 30 days' if a.get('beta_days') else \
               ('Name your price' if a.get('pay_what_you_want') else 'No licence key needed')
        d.text((64, py + 58), note, font=sf, fill=MUTED)
    else:
        now  = a.get('price_cents') or 0
        was  = a.get('list_price_cents') or 0
        d.text((64, py), money(now), font=pf, fill=WHITE)
        x = 64 + d.textlength(money(now), font=pf) + 18
        if was > now:
            wf = font(REG, 30)
            d.text((x, py + 14), money(was), font=wf, fill=MUTED)
            ww = d.textlength(money(was), font=wf)
            d.line([x, py + 30, x + ww, py + 30], fill=MUTED, width=2)
        if a.get('pay_what_you_want'):
            d.text((64, py + 58), 'Name your price', font=sf, fill=MUTED)

    # platforms, bottom right
    seen, plats = set(), []
    for k in (a.get('installers') or {}):
        n = PLAT.get(k, k)
        if n not in seen: seen.add(n); plats.append(n)
    if plats:
        line = '  ·  '.join(plats)
        d.text((W - 64 - d.textlength(line, font=sf), H - 62), line, font=sf, fill=MUTED)

    im.save(path, 'PNG')

def main():
    c = json.load(open(os.path.join(ROOT, 'catalog.json'), encoding='utf-8'))
    os.makedirs(OUT, exist_ok=True)
    made = []
    for app_id, a in c['apps'].items():
        if (a.get('status') or 'available') != 'available':
            print('  skipped %-13s (%s)' % (app_id, a.get('status'))); continue
        kind = 'FREE' if a.get('free') else 'PAID'
        safe = re.sub(r'[^A-Za-z0-9 ]+', '', a.get('name') or app_id).strip()
        path = os.path.join(OUT, '%s - %s.png' % (kind, safe))
        card(app_id, a, path)
        made.append((kind, safe, path))
        print('  %-4s  %-16s %s' % (kind, safe, os.path.basename(path)))
    print('\n%d cards in %s' % (len(made), OUT))
    print('%d free, %d paid' % (sum(k == 'FREE' for k, _, _ in made),
                                sum(k == 'PAID' for k, _, _ in made)))

if __name__ == '__main__':
    main()
