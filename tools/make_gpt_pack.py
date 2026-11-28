"""Build a zip for drawing the ChatGPT dragon's and DeepSeek whale's sprite sheets by hand in ChatGPT.

No API key needed. The sheets come in batches of 8: each batch folder holds the two reference pictures,
its pose sheets and one PROMPT.txt. Drop the folder's pictures into a new ChatGPT chat, paste the
prompt once, and reply "next" until the batch is done.

  python3 tools/make_gpt_pack.py [out.zip]          # default: claude-ojousama-gpt-pack.zip

Bring the results back with:
  python3 tools/process_sprites.py --char dragon --from <folder with the returned dragon pictures>
"""
import glob
import os
import shutil
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen_character_sprites as g  # noqa: E402

ROOT = g.ROOT
# The ones she uses all the time come first, so a partial batch already covers most of her day.
FIRST = ["typing", "idle", "wave", "thinking", "happy", "walk", "sit", "drag", "dangle", "sleep", "surprise", "error"]

NAMES = {"dragon": ("ChatGPT 龙娘", "ChatGPT dragon girl"), "whale": ("DeepSeek 鲸鱼娘", "DeepSeek whale girl")}


def order():
    anims = g.manifest()
    return [n for n in FIRST if n in anims] + [n for n in anims if n not in FIRST]


BATCH = 8  # pose sheets per chat: with the two reference pictures that's 10 attachments


def scene(jobs, name, char):
    return g.scene(jobs, name, char).replace("exactly like image 1", "exactly like the pose sheet")


def batch_prompt(char, items, jobs):
    """One message that sets up the chat and lists every sheet of the batch; after that it's just "next"."""
    desc = g.CHARS[char]["desc"]
    lines = "\n".join(f"{i}. Save as {tag}.png - from {tag}_pose.png: {scene(jobs, name, char)}" for i, (tag, name) in enumerate(items, 1))
    return f"""I'm making pixel-art sprite sheets for a desktop pet app. Please draw one character across several animations.

ATTACHED
- ref_1.jpg and ref_2.jpg show my character: {desc}.
- {len(items)} pose sheets (named like 01_typing_pose.png). Each is a finished 4-frame animation of a different character, an orange-haired girl with a sunflower hair clip and a beige cardigan.

TASK
Redraw every pose sheet as MY character, one image per pose sheet, in this order:

{lines}

RULES FOR EVERY IMAGE
- Exactly 4 frames side by side in one row, evenly spaced in equal cells, in the same left-to-right order as the pose sheet.
- The same poses, gestures, facing, framing and size as the pose sheet, and the same props and effects (desk, chair, CRT computer, cup, sign, umbrella and so on) where they appear.
- My character's own hair, ears, horns or fins, wings or tail and outfit, identical in every frame and in every image. Never the sunflower clip or cardigan.
- Crisp chibi 16-bit pixel art like the pose sheets: chunky hard-edged pixels, dark 1px outline, limited palette, no blur, no soft shading.
- A solid flat magenta (#FF00FF) background, with no magenta anywhere on the character. No text, labels, grid lines, frame borders or ground shadow.
- A wide landscape image (3:2).

HOW TO GO
Before each image, write one line with its number and the file name to save it as (for example "1/{len(items)} - {items[0][0]}.png"). Start with number 1 now. Make as many as you can in one reply; whenever you stop, I'll reply "next" and you continue with the following number. Don't ask me questions in between.
"""


def anim_prompt(char, name, entry, scene):
    frames = entry.get("frames", 4)
    return f"""Redraw the attached pose sheet ("{name}", {frames} frames) again as my character from ref_1.jpg and ref_2.jpg earlier in this chat: {g.CHARS[char]['desc']}.

Keep the {frames} frames side by side in one row, evenly spaced, with the same poses, framing, size and props as the pose sheet. Use my character's own hair, horns or fins, wings or tail and outfit, the same as in every other sheet.

What the animation shows: {scene}

Crisp chibi pixel art like the pose sheet, solid flat magenta (#FF00FF) background, no text, no grid lines, no frame borders, wide landscape image.
"""


README = """Claude Ojousama · 精灵图绘制包 / Sprite-sheet pack
==================================================

★ 有 Codex（用 ChatGPT Plus / Pro 登录）就最省事，全自动：
  1. 安装并登录：npm i -g @openai/codex，然后 codex login（选 ChatGPT 账号登录）。
  2. 在终端里进入解压后的这个文件夹（cd claude-ojousama-gpt-pack），运行：
       codex -s workspace-write -a never
  3. 打开 CODEX_PROMPT.txt，全选复制，粘贴给 Codex，回车。
  它会一张张画完，全部存进 output/（dragon_01_typing.png … whale_47_magic.png）。
  中途停了（额度用完、断网、关了窗口）：重新运行第 2、3 步，已经画好的会自动跳过。
  画完把 output 文件夹打包发回给我就好。
  画图很耗 Codex 额度（大约是普通对话的 3–5 倍），{total} 张可能要分几次额度窗口才能画完。

★ With Codex (signed in with ChatGPT Plus / Pro) it's fully automatic:
  1. Install and sign in: npm i -g @openai/codex, then codex login (sign in with ChatGPT).
  2. In a terminal, cd into this unzipped folder and run:
       codex -s workspace-write -a never
  3. Copy all of CODEX_PROMPT.txt, paste it into Codex and press Enter.
  It draws every sheet into output/ (dragon_01_typing.png ... whale_47_magic.png).
  If it stops (usage limit, network, closed window), repeat steps 2 and 3: finished ones are skipped.
  When it's done, zip the output folder and send it back.
  Image generation uses Codex limits 3-5x faster than normal turns, so {total} sheets may span a few limit windows.

没有 Codex 的话，用下面的 ChatGPT 网页方法。 / Without Codex, use the ChatGPT web steps below.
==================================================

谢谢帮忙！这个包用来在 ChatGPT 里画两个桌宠角色的动作图：
  dragon/  ChatGPT 龙娘（白龙大姐姐）
  whale/   DeepSeek 鲸鱼娘（蓝色鲸鱼女仆）
每个角色 {count} 个动作，每个动作一张图（一张图里横排 4 帧），按 {batch} 个一组分成 {batches} 组（batch_1、batch_2…）。

【怎么画】每一组开一个新的 ChatGPT 对话：
1. 把 batch_N 文件夹里的全部图片（2 张立绘 + {batch} 张姿势图）一次拖进对话框。
2. 打开同一文件夹里的 PROMPT.txt，全选复制，粘贴，发送。
3. ChatGPT 每画一张会先写出文件名（如 "01_typing.png"），把图下载、改成这个名字，放进 results/。
4. 它停下来时回复 next，直到这一组画完；然后新开对话做下一组。
5. 全部画完后把 dragon/results 和 whale/results 打包发回给我就好。

【小贴士】
- batch_1、batch_2 里是最常用的动作，时间不够的话先画这两组。
- 某张不满意：在同一个对话里上传那张姿势图，粘贴 redo_prompts/ 里同名的提示词重画；或者直接说 "redo 3, keep the horns the same as the reference"。
- 如果 ChatGPT 说一次不能上传这么多文件，就分两条消息发：先发立绘和提示词，再发姿势图。
- 4 帧要横排、分开、姿势和参考图一致；背景是纯洋红色（之后会自动抠掉），不要有文字和格子线。像素不用完美，之后会统一缩小和调色。

----------------------------------------------------------------------

Thanks for helping! This pack is for drawing two desktop-pet characters' animations in ChatGPT:
  dragon/  the ChatGPT dragon girl (a gentle white dragon big sister)
  whale/   the DeepSeek whale girl (a blue whale maid)
{count} animations each, one picture per animation (4 frames side by side), in groups of {batch} ({batches} groups: batch_1, batch_2, ...).

HOW: one new ChatGPT chat per group.
1. Drag every picture in the batch_N folder (2 reference pictures + {batch} pose sheets) into the chat at once.
2. Open PROMPT.txt in the same folder, copy all of it, paste and send.
3. Before each picture ChatGPT writes the file name (e.g. "01_typing.png"): download the picture under that name into results/.
4. Whenever it stops, reply "next" until the group is done; then start a new chat for the next group.
5. When everything is done, zip dragon/results and whale/results and send them back.

TIPS
- batch_1 and batch_2 hold the animations she uses most: do those first if time is short.
- To redo one: in the same chat, attach its pose sheet and paste the matching prompt from redo_prompts/, or just say "redo 3, keep the horns the same as the reference".
- If ChatGPT won't take that many files at once, send the reference pictures with the prompt first, then the pose sheets.
- 4 separate frames in one row, matching the pose sheet; flat magenta background (removed later); no text or grid lines. Pixels needn't be perfect: everything is resized and recoloured afterwards.
"""


CODEX_PROMPT = """Generate pixel-art sprite sheets for a desktop pet with your built-in image generation ($imagegen, the built-in image_gen tool; no API key, no CLI fallback). Work through every sheet without stopping to ask me anything.

FILES (all relative to this folder)
- Two characters: dragon/ and whale/. Do all of dragon/ first, then all of whale/.
- Character references: <character>/batch_1/ref_1.jpg and ref_2.jpg.
- Pose sheets: <character>/batch_*/NN_name_pose.png ({count} per character, numbered 01-{count:02d}). Each is a finished 4-frame animation of a different character (an orange-haired girl with a sunflower clip and a beige cardigan).
- What each sheet must show: <character>/redo_prompts/NN_name.txt. Follow it exactly.

FOR EACH POSE SHEET, in number order
1. Skip it if output/<character>_NN_name.png already exists (so this prompt can be re-run to resume).
2. Make sure ref_1.jpg, ref_2.jpg and the pose sheet are visible to you (open them with view_image; open the refs again whenever they are no longer in view).
3. Call image_gen once: generate a new image that redraws the pose sheet as the character in ref_1/ref_2, following NN_name.txt. Input images: ref_1 and ref_2 = character reference, pose sheet = pose, layout and size reference. Landscape 1536x1024. Exactly 4 frames side by side, evenly spaced, same poses and props as the pose sheet, crisp chibi pixel art, solid flat magenta #FF00FF background, no text, grid lines or borders.
4. Copy the generated PNG from $CODEX_HOME/generated_images/ (usually ~/.codex/generated_images/) to output/<character>_NN_name.png, for example output/dragon_01_typing.png. Never overwrite an existing file there.
5. Only regenerate (once) if the result clearly has the wrong character or not 4 frames. Don't polish or iterate otherwise.

Keep going until all {total} files are in output/, then list any that failed. Keep progress messages to one short line per sheet.
"""


def small_png(path, limit=1024):
    from PIL import Image
    im = Image.open(path).convert("RGBA")
    im.thumbnail((limit, limit), Image.LANCZOS)
    flat = Image.new("RGB", im.size, (255, 255, 255))
    flat.paste(im, mask=im.split()[3])
    return flat


def build(out):
    anims = g.manifest()
    jobs = g.claude_jobs()
    names = order()
    tmp = out + ".d"
    shutil.rmtree(tmp, ignore_errors=True)
    top = os.path.join(tmp, "claude-ojousama-gpt-pack")
    os.makedirs(top)
    os.makedirs(os.path.join(top, "output"))
    with open(os.path.join(top, "output", "PUT_PICTURES_HERE.txt"), "w", encoding="utf-8") as f:
        f.write("Codex writes dragon_01_typing.png, ..., whale_47_magic.png here.\n")
    with open(os.path.join(top, "CODEX_PROMPT.txt"), "w", encoding="utf-8") as f:
        f.write(CODEX_PROMPT.format(count=len(names), total=2 * len(names)))
    with open(os.path.join(top, "README.txt"), "w", encoding="utf-8") as f:
        f.write(README.format(count=len(names), total=2 * len(names), batch=BATCH, batches=-(-len(names) // BATCH)))
    for char in ("dragon", "whale"):
        d = os.path.join(top, char)
        os.makedirs(os.path.join(d, "results"))
        os.makedirs(os.path.join(d, "redo_prompts"))
        refs = [small_png(r) for r in sorted(glob.glob(os.path.join(ROOT, g.CHARS[char]["refs"])))[:2]]
        tags = [(f"{i:02d}_{name}", name) for i, name in enumerate(names, 1)]
        for b in range(0, len(tags), BATCH):
            items = tags[b : b + BATCH]
            bd = os.path.join(d, f"batch_{b // BATCH + 1}")
            os.makedirs(bd)
            for k, im in enumerate(refs, 1):
                im.save(os.path.join(bd, f"ref_{k}.jpg"), quality=90)
            for tag, name in items:
                with open(os.path.join(bd, tag + "_pose.png"), "wb") as f:
                    f.write(g.pose_reference(anims[name], g.KEY_COLOR))
            with open(os.path.join(bd, "PROMPT.txt"), "w", encoding="utf-8") as f:
                f.write(batch_prompt(char, items, jobs))
        for tag, name in tags:
            with open(os.path.join(d, "redo_prompts", tag + ".txt"), "w", encoding="utf-8") as f:
                f.write(anim_prompt(char, name, anims[name], scene(jobs, name, char)))
        with open(os.path.join(d, "results", "PUT_PICTURES_HERE.txt"), "w", encoding="utf-8") as f:
            f.write("01_typing.png, 02_idle.png, ...\n")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for base, _, files in os.walk(top):
            for fn in sorted(files):
                full = os.path.join(base, fn)
                z.write(full, os.path.relpath(full, tmp))
    shutil.rmtree(tmp)
    print(f"{out}: {len(names)} animations x 2 characters")


if __name__ == "__main__":
    build(os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "claude-ojousama-gpt-pack.zip"))
