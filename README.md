# TMCP — The Morse Code Project

**A Morse code radio you can open in a browser and talk to a real person on.**

No account. No sign-up. No database. No app store. One HTML file.

Type Morse on a telegraph key, and the other operator's phone beeps and decodes it in
real time — anywhere on Earth, on any phone made in the last decade.

Made by **Rekib Ali** · GitHub: [**TwilightRaaz**](https://github.com/TwilightRaaz)

---

## What this is

Before there were phones, there was radio, and before radio was voice, it was dots and
dashes. TMCP brings that back — but the "airwaves" are the internet.

You press a key. The other operator hears a beep, sees the dots and dashes scroll past,
and the letters assemble themselves into words. That's the whole idea.

It looks and feels like a piece of radio hardware: a power dial, a status lamp, a tuning
ruler, a telegraph key. But it is one file of HTML that runs in your browser.

---

## Why it's built the way it is

- **Nothing to install.** Send someone a link. That's the whole onboarding.
- **Nothing to sign up for.** No email, no password, no account.
- **No server of ours.** It uses a public MQTT broker as the relay, so there is no
  backend to pay for, maintain, or lose.
- **It runs on cheap phones.** Tuned for a Redmi 5A and an OPPO A78 — no heavy graphics,
  no 3D, no camera.

---

## The three ways to transmit

### 1. Local Airways — by distance

Your phone asks for GPS, then narrows the airwaves down to the area around you. Pick how
far you want to reach:

| Band | Radius | Right for |
|---|---|---|
| Whisper | 11 m | Same room |
| Walkie | 110 m | Same building |
| Block | 1.1 km | Same street |
| City | 11 km | Same city |
| Region | 111 km | Same state |
| Global | Earth | Anyone, anywhere |

**Be honest with yourself about these numbers.** They are not physical range — they are a
GPS grid filter. Everyone shares the same broker; the band decides which grid cells you
listen to. Each cell is scanned along with its eight neighbours so two people standing on
a boundary still hear each other.

In practice, **Walkie is the reliable "same building" setting.** Whisper's cell is 11 m,
which is smaller than the GPS accuracy of most phones, so two handsets in the same room
can land in different cells. If Local Airways refuses to connect you, drop to Global —
it needs no GPS at all and will always find the other operator.

### 2. Private Band — by frequency and password

Tune to any frequency you and your partner agree on, then both enter the same passcode.
The app derives a private channel from `HMAC-SHA256(passcode, frequency)`, so nobody on
Earth can find your channel without both pieces.

This is the mode to use for a two-person conversation. Pick something like `741.2` and a
passcode you can say out loud. There are no chat links and no QR codes by design — the
frequency and the passcode *are* the invitation.

### 3. Sonic Sync — by sound

Don't want to type a six-digit frequency on the other person's phone? Put the two phones
next to each other.

Tap **Send** on one and the app plays the frequency as a short burst of tones. Tap
**Receive** on the other and it listens through the microphone and tunes itself. No
network configuration, no typing — the phones just talk to each other in sound.

---

## How to use it

**You need two people, each with a phone, both online.**

1. **Open the link** on both phones and tap the big power dial.
   The lamp turns **STANDBY**, then **ON AIR** once the link is open.
2. **Tune to the same place on both phones.** Tap the sliders icon and either:
   - pick the same **band** in Local Airways, or
   - both enter the same **frequency and passcode** in Private Band.
3. **Allow location** if you use Local Airways. Without GPS that mode has no channel to
   sit in — Private Band works regardless.
4. **Send a letter.** Press and hold the **KEY**:
   - a quick tap (under ¼ second) is a **dot** `•`
   - a longer hold is a **dash** `—`
   The Morse box fills up — it holds four characters at a time.
5. **Press the arrow** to send the letter. Nothing reaches the other phone until you do.
   Nothing is ever sent automatically.
6. **Watch the other phone.** The tape shows dots and dashes as they arrive, the box
   underneath turns them into letters, and the phone beeps and vibrates.

A few things that make life easier:

- **SPACE** inserts a word break.
- **×** deletes the last dot or dash you keyed.
- **Clear** under the Receiver wipes incoming text; **Clear** under the Transmitter wipes
  what you've sent. They are separate on purpose.
- The **speaker icon** mutes incoming beeps — handy in a quiet room.
- **POWER OFF** ends the session. Nothing else does. Refresh the page, close the tab,
  lose the network — when you come back you're still on your channel, until you power off.

The lamp tells you where you stand: **OFFLINE** (grey), **STANDBY** (amber), **ON AIR**
(green), **ERROR** (red).

---

## Where it stops — read this before you trust it

This is a project, not a secure communication tool. It's fair to know the edges.

- **Both phones need internet.** There is no offline mode. The app opens without a
  connection, but it cannot send or receive anything. It is not a real radio: your
  keypress goes to a public broker on the internet and back down to the other phone,
  which takes about 300 ms even if you're in the same room.
- **The broker is public and free.** `broker.emqx.io` is a public test broker with no
  uptime guarantee. Anyone can subscribe to the Global band and read everything on it.
  **Do not send anything private on Global.**
- **Private Band hides the channel, not the content.** The passcode keeps strangers from
  *finding* your channel, but the traffic itself is not encrypted on the wire. It is
  considerably better than Global, and nowhere near Signal.
- **GPS is coarse.** Local Airways is only as precise as your phone's location fix. It is
  a clever way to sort nearby operators into rooms, not a measurement of distance.
- **Two strangers can collide.** If someone else picks your exact frequency and passcode,
  they land in your channel. Choose something unguessable.

Use it to talk to a friend across the world, or across a table — just don't file your
taxes over it.

---

## Running it yourself

**The easy way:** open the live URL on any device. That's it.

**The nearly-as-easy way:** download `index.html` and open it in a browser. Everything —
the styling, the code, the MQTT client, the font — is inside that one file. No folder, no
dependencies, no build step. Note that GPS and microphone access require HTTPS or
`localhost`, so opening a local file will disable Local Airways and Sonic Sync.

**Hosting it:** it works on GitHub Pages, Netlify, Cloudflare Pages — anywhere that serves
static files. Upload `index.html` and `.nojekyll`, enable Pages, done. Full steps are in
[DEPLOY.md](DEPLOY.md).

---

## Want to change it?

The source is included under `source/`.

| File | What's in it |
|---|---|
| `source/src/index.html` | the markup |
| `source/src/style.css` | all styling, geometry taken from the design frames |
| `source/src/app.js` | everything else: Morse tables, MQTT, GPS grid, the dial, audio |
| `source/build.py` | inlines the three above plus the MQTT client and font |

```
cd source
python3 build.py
```

That regenerates `index.html`. No packages to install.

Under the hood: MQTT.js over secure WebSockets, the Web Audio API for tones, the
`crypto.subtle` HMAC for private channels, `navigator.geolocation` for the grid and
`navigator.vibrate` for feedback. Vanilla JavaScript, no framework.

---

## Credits

**Made by Rekib Ali — [@TwilightRaaz](https://github.com/TwilightRaaz)**

The interface was designed in Figma and rebuilt from the source vectors; the dial, spacing
and colour values are measurements from those frames, not approximations.

Built because Morse code is a lovely thing and it deserved a modern front door.
