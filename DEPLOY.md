# Deploying TMCP to GitHub Pages

The folder is ready. It contains exactly two files:

    index.html   426 KB  — the entire app (HTML + CSS + JS + MQTT + font, all inlined)
    .nojekyll            — tells Pages to serve files verbatim, no Jekyll processing

No build step, no dependencies, no external requests. Upload these two files and it runs.

---

## Option A — Browser only (no git, no terminal)

1. Go to https://github.com/new
2. **Repository name:** `tmcp`
3. **Visibility:** Public — required. GitHub Pages on a free account cannot serve a private repo.
4. Leave everything else alone. Click **Create repository**.
5. On the empty repo page click **uploading an existing file**.
6. Drag in **both** `index.html` and `.nojekyll`.
   - `.nojekyll` is a hidden file. If your file picker hides it, enable "show hidden files"
     (Mac: `Cmd+Shift+.` — Windows: View → Hidden items).
   - If you cannot get it in, skip it. The app still works; the file simply avoids a
     Jekyll pass over an HTML file that has nothing to process.
7. Click **Commit changes**.
8. Go to **Settings → Pages** (left sidebar).
9. Under **Build and deployment**:
   - **Source:** Deploy from a branch
   - **Branch:** `main`  ·  **Folder:** `/ (root)`
   - Click **Save**.
10. Wait 1–3 minutes. Refresh. A banner appears:

        Your site is live at https://YOURNAME.github.io/tmcp/

That URL works on any device, anywhere, over HTTPS.

---

## Option B — Git command line

From inside this `tmcp-deploy` folder:

```bash
git init
git add index.html .nojekyll
git commit -m "TMCP — The Morse Code Project"
git branch -M main
git remote add origin https://github.com/YOURNAME/tmcp.git
git push -u origin main
```

Then **Settings → Pages → Source: Deploy from a branch → main → / (root) → Save**.

URL: `https://YOURNAME.github.io/tmcp/`

---

## After it goes live — check these three things

1. Open the URL. The power dial appears. Tap it → LED turns **STANDBY**, then **ON AIR**.
   - **STANDBY** = app open but no channel tuned yet.
   - **ON AIR** = subscribed to a live channel. If it says ERROR, the broker is unreachable.
2. Tap the settings icon → **Local Airways**. Allow the location prompt on both phones.
   The strip must read `GPS lock · ±NNm`. Without this, Local Airways has no channel.
3. Send a letter from phone A, watch phone B. Nothing on A's own receiver — that is correct.

---

## Two-device testing, correctly

Both phones must be on the **same band** and reach the **same GPS cell**.

- **Walkie (110 m)** is the realistic "same building" setting. Whisper's 11 m cell is
  smaller than real GPS accuracy, so it is unreliable between two separate phones.
- **Global** needs no GPS at all — both phones on Earth band hear each other. Use this
  first to prove the link works, then step down to Walkie.
- If both phones are on the same phone number's hotspot, GPS may drift. Global always works.

---

## Things to know before you publish

- **Public repository.** The `index.html` is readable by anyone. There are no secrets in it
  (no keys, no tokens) — but the private-band scheme is `HMAC-SHA256(passcode, frequency)`.
  Publishing the source does not weaken it; the passcode itself is never stored.
- **Free broker.** `broker.emqx.io` is a public test broker with no uptime guarantee and no
  privacy. Anyone on Earth can subscribe to `tmcp/global/band` and read it. Do not send
  anything you would not shout in a street.
- **Custom domain** is optional and not needed. The `github.io` URL is already HTTPS, which
  is what the GPS and microphone APIs require — no extra setup.
- **Updates:** re-run `python3 build.py` in `/home/user/tmcp`, copy `index.html` here,
  upload again. Pages rebuilds in about a minute.
