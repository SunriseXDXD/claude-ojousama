"""Generate the ChatGPT dragon's or the DeepSeek whale's sprite sheets with OpenAI's image model.

For every animation the model gets three things: Claude Ojousama's finished strip (assets/sprites) as
the pose and layout reference, the character's sample art (sample/*.png) as the look, and the same
per-animation description that made Claude's sheets (tools/gen_sprites.py), adapted to the new girl.
The raw sheets land in assets/characters/<char>/raw/ and are then cut, scaled to Claude's size and
palette-reduced by process_sprites.py.

  export OPENAI_API_KEY=sk-...
  python3 tools/gen_character_sprites.py --char whale       # all 47 animations (skips ones already there)
  python3 tools/gen_character_sprites.py --char dragon --only idle,wave --force
  python3 tools/process_sprites.py --char whale             # build the sprites the app uses

Options: --model (default gpt-image-2), --quality low|medium|high (default high),
--transparent (ask for a transparent background; only for models that support it — otherwise the
sheet comes on flat magenta, which process_sprites.py keys out), --jobs N (parallel requests),
--refs a.png,b.png (character art; defaults to sample/ChatGPT*.png or sample/DeepSeek*.png).
Needs Pillow. Roughly one image request per animation; check OpenAI's current image pricing.
"""
import argparse
import base64
import concurrent.futures
import glob
import importlib
import io
import re
import types
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "sprites")
SIZE = (1536, 1024)
KEY_COLOR = (255, 0, 255)

CHARS = {
    "dragon": {
        "refs": "sample/ChatGPT*.png",
        "desc": (
            "a mature, gentle white dragon girl (the ChatGPT dragon girl): long wavy silver-white hair with a faint "
            "lavender tint, amethyst-purple eyes, a pair of curled white dragon horns, small pointed ears, pale "
            "lavender-white dragon wings, a long thick white-scaled dragon tail, an elegant white gown with detached "
            "frilled sleeves, decorated with white knot-shaped emblems, white heels; calm, warm expression"
        ),
    },
    "whale": {
        "refs": "sample/DeepSeek*.png",
        "desc": (
            "a cheerful blue whale-girl maid (the DeepSeek whale girl): long blue hair fading to light blue at the "
            "ends with an ahoge, small dark-blue whale-fin ears, blue eyes, a white frilled maid headdress with a "
            "blue bow, a navy-and-white maid dress with a white frilled apron with a tiny whale embroidered on it, "
            "white frilled socks, navy Mary Jane shoes, a big navy whale tail; lively, sweet expression"
        ),
    },
}


def claude_jobs():
    """The per-animation descriptions Claude's sheets were made from (without needing requests)."""
    sys.modules.setdefault("requests", types.ModuleType("requests"))
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    return importlib.import_module("gen_sprites").JOBS


# Claude's own details in those descriptions, and what each character has instead.
SWAPS = {
    "dragon": [(r"long orange hair", "long silver-white hair"), (r"her cardigan collar", "her collar"), (r"(her )?cardigan sleeve", "her long sleeve"),
               (r"little sunflower prints", "little silver star prints"), (r"a single sunflower tucked into the ribbon", "a small white knot charm tied to the ribbon"),
               (r"small sunflower petals", "small lavender sparkles"), (r"orange over-ear headphones", "white over-ear headphones")],
    "whale": [(r"long orange hair", "long blue hair"), (r"her cardigan collar", "her maid dress collar"), (r"(her )?cardigan sleeve", "her frilled sleeve"),
              (r"little sunflower prints", "little whale prints"), (r"a single sunflower tucked into the ribbon", "a tiny rice-ball charm tied to the ribbon"),
              (r"small sunflower petals", "small water droplets"), (r"orange over-ear headphones", "navy over-ear headphones")],
}


def adapt(text, char):
    text = text.replace("exactly like the reference", "exactly like image 1")
    for pat, rep in SWAPS[char]:
        text = re.sub(pat, rep, text)
    return text


def scene(jobs, name, char):
    """What the animation shows, from Claude's description, minus its layout rules and her own look."""
    job = jobs.get(name, "")
    job = job.split("Layout:", 1)[-1].split("loop smoothly. ", 1)[-1].strip()
    return adapt(job, char)


def manifest():
    with open(os.path.join(SRC, "manifest.json"), encoding="utf-8") as f:
        return json.load(f)["anims"]


def pose_reference(entry, background):
    """Claude's strip, scaled up with hard pixels and centred on a canvas the size of the output."""
    strip = Image.open(os.path.join(SRC, entry["file"])).convert("RGBA")
    k = max(1, int(min(SIZE[0] * 0.94 / strip.width, SIZE[1] * 0.8 / strip.height)))
    big = strip.resize((strip.width * k, strip.height * k), Image.NEAREST)
    canvas = Image.new("RGBA", SIZE, background + (255,))
    canvas.alpha_composite(big, ((SIZE[0] - big.width) // 2, (SIZE[1] - big.height) // 2))
    out = io.BytesIO()
    canvas.convert("RGB").save(out, "PNG")
    return out.getvalue()


def prompt_for(name, entry, desc, transparent, job, char):
    frames = entry.get("frames", 4)
    bg = "a fully transparent background" if transparent else "a solid flat magenta (#FF00FF) background, with no magenta anywhere on the character"
    return (
        f"Image 1 is a finished {frames}-frame pixel-art animation sheet (\"{name}\") of a different character: an "
        f"orange-haired girl with a sunflower hair clip and a beige cardigan. The other images show the character "
        f"to draw instead: {desc}.\n"
        f"Redraw image 1 frame by frame as this character. Keep the {frames} frames side by side from left to right, "
        f"evenly spaced in equal cells, with the same poses, gestures, facing, framing and relative size as image 1, "
        f"and the same props and effects where they appear. Drop the sunflower clip and cardigan; use the new "
        f"character's own hair, ears, horns or fins, wings or tail and outfit, the same in every frame.\n"
        f"What the sheet shows: {job}\n"
        f"Style: the same crisp chibi 16-bit pixel art as image 1 (chunky hard-edged pixels, dark 1px outline, "
        f"limited palette, no blur, no anti-aliasing), on {bg}. No text, no labels, no grid lines, no frame borders, "
        f"no shadow on the ground."
    )


def multipart(fields, files):
    boundary = "----ojousama" + uuid.uuid4().hex
    parts = []
    for k, v in fields.items():
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    for name, (filename, data, ctype) in files:
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{filename}"\r\nContent-Type: {ctype}\r\n\r\n'.encode() + data + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def request_edit(key, fields, images, base_url, tries=4):
    body, ctype = multipart(fields, [("image[]", (f"ref{i}.png", data, "image/png")) for i, data in enumerate(images)])
    for attempt in range(tries):
        req = urllib.request.Request(base_url.rstrip("/") + "/images/edits", data=body, headers={"Authorization": f"Bearer {key}", "Content-Type": ctype}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=600) as r:
                data = json.loads(r.read())
            return base64.b64decode(data["data"][0]["b64_json"])
        except urllib.error.HTTPError as e:
            msg = e.read().decode("utf-8", "replace")[:500]
            if e.code in (429, 500, 502, 503, 504) and attempt < tries - 1:
                time.sleep(10 * (attempt + 1))
                continue
            raise RuntimeError(f"HTTP {e.code}: {msg}") from None
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt < tries - 1:
                time.sleep(10 * (attempt + 1))
                continue
            raise RuntimeError(str(e)) from None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--char", required=True, choices=sorted(CHARS))
    ap.add_argument("--only", help="comma-separated animation names")
    ap.add_argument("--model", default=os.environ.get("OPENAI_IMAGE_MODEL") or os.environ.get("PET_IMG_MODEL") or "gpt-image-2")
    ap.add_argument("--quality", default="high", choices=["low", "medium", "high"])
    ap.add_argument("--transparent", action="store_true")
    ap.add_argument("--refs")
    ap.add_argument("--jobs", type=int, default=2)
    ap.add_argument("--force", action="store_true")
    # Same environment as tools/gen_sprites.py works too (PET_IMG_BASE / PET_IMG_KEY / PET_IMG_MODEL).
    legacy = os.environ.get("PET_IMG_BASE", "").rstrip("/")
    ap.add_argument("--base-url", default=os.environ.get("OPENAI_BASE_URL") or (legacy + "/v1" if legacy else "https://api.openai.com/v1"))
    ap.add_argument("--dry-run", action="store_true", help="write the pose references and prompts only")
    a = ap.parse_args()

    key = os.environ.get("OPENAI_API_KEY") or os.environ.get("PET_IMG_KEY")
    if not key and not a.dry_run:
        sys.exit("Set OPENAI_API_KEY first (an OpenAI API key with image access).")
    char = CHARS[a.char]
    refs = a.refs.split(",") if a.refs else sorted(glob.glob(os.path.join(ROOT, char["refs"])))
    if not refs:
        sys.exit(f"No character art found ({char['refs']}); pass --refs a.png,b.png")
    ref_bytes = []
    for r in refs[:3]:
        im = Image.open(r if os.path.isabs(r) else os.path.join(ROOT, r)).convert("RGBA")
        im.thumbnail((1024, 1024))
        flat = Image.new("RGBA", im.size, (255, 255, 255, 255))
        flat.alpha_composite(im)
        buf = io.BytesIO()
        flat.convert("RGB").save(buf, "PNG")
        ref_bytes.append(buf.getvalue())

    anims = manifest()
    jobs = claude_jobs()
    names = [n.strip() for n in a.only.split(",")] if a.only else list(anims)
    unknown = [n for n in names if n not in anims]
    if unknown:
        sys.exit(f"unknown animations: {', '.join(unknown)}")
    if "typing" not in names and not os.path.exists(os.path.join(ROOT, "assets", "characters", a.char, "raw", "typing.png")):
        names.insert(0, "typing")  # process_sprites.py sizes everything from the typing sheet
    raw = os.path.join(ROOT, "assets", "characters", a.char, "raw")
    os.makedirs(raw, exist_ok=True)
    todo = [n for n in names if a.force or not os.path.exists(os.path.join(raw, n + ".png"))]
    print(f"{a.char}: {len(todo)} sheet(s) to generate with {a.model} ({a.quality}); {len(names) - len(todo)} already there")

    bg = (240, 240, 240) if a.transparent else KEY_COLOR

    def one(name):
        entry = anims[name]
        pose = pose_reference(entry, bg)
        prompt = prompt_for(name, entry, char["desc"], a.transparent, scene(jobs, name, a.char), a.char)
        if a.dry_run:
            with open(os.path.join(raw, name + ".pose.png"), "wb") as f:
                f.write(pose)
            with open(os.path.join(raw, name + ".prompt.txt"), "w", encoding="utf-8") as f:
                f.write(prompt)
            return name, "dry run"
        fields = {"model": a.model, "prompt": prompt, "size": f"{SIZE[0]}x{SIZE[1]}", "quality": a.quality, "n": "1"}
        if a.transparent:
            fields["background"] = "transparent"
            fields["output_format"] = "png"
        data = request_edit(key, fields, [pose] + ref_bytes, a.base_url)
        img = Image.open(io.BytesIO(data)).convert("RGBA")
        img.save(os.path.join(raw, name + ".png"))
        return name, f"{img.width}x{img.height}"

    failed = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, a.jobs)) as pool:
        for fut in concurrent.futures.as_completed([pool.submit(one, n) for n in todo]):
            try:
                name, info = fut.result()
                print(f"  {name}: {info}")
            except Exception as e:  # keep going; report at the end
                failed.append(str(e))
                print(f"  failed: {e}")
    if failed:
        print(f"{len(failed)} failed; run the same command again to retry only those.")
    if not a.dry_run:
        print(f"Next: python3 tools/process_sprites.py --char {a.char}")


if __name__ == "__main__":
    main()
