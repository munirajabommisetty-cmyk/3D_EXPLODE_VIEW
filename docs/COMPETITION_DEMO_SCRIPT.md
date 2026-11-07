# GestureLab CAD: 3-Minute Demo Script

**Great Indian AI Internship Challenge 2026 by Gnani AI · Jugaad Genius Award entry**
*("The most creative or unexpected use of Gnani AI's models")*

**Story:** ① a question that makes the viewer think → ② the problem → ③ our solution → ④ the full live demo → ⑤ impact & benefits → ⑥ conclusion. Powered by **Gnani Prisma** (listening) and **Gnani Timbre** (speaking).

---

## Part A: Official rules this video follows

These come from Gnani AI's challenge page. Each is built into the script.

| Official rule | How this video meets it |
| :--- | :--- |
| "Record a video of your application **working**" | Every feature shown is live in the real app. No mock-ups, slides of fake screens or stock footage. |
| Explain **what you built** | ③ Our solution (0:40–0:55) states it; ④ Live demo (0:55–2:25) shows it working. |
| Explain **which Gnani AI technology** is used, and **name the models** | **Gnani Prisma** and **Gnani Timbre** are named in ③ Our solution, on screen at the moment each one works in the live demo (1:10–1:55), and again in ⑤ Impact & benefits. |
| **No misleading demos** | The voice question is **spoken live** and the answer is the **real** response. Any shortened answer is captioned *"(shortened for time)"*. The app's own labels ("Engineering explanation", "Not simulated in this app") stay visible. |
| **Synthetic data only**: no real phone numbers, Aadhaar, PAN or recorded calls | The app uses only 3D model data. Nothing personal appears. Hide notifications, email and browser profile pictures. |
| No bought engagement or paid promotion | Not part of the video. Share the post genuinely afterwards. |
| Post must **tag Gnani AI** and use **#GreatIndianAIInternshipChallenge #GnaniAI** | Done in the post text (see `docs/COMPETITION_SOCIAL_POST.md`), and shown on the closing card. |
| Final submission names the models and each member's contribution | Closing card: *"Built with Gnani Prisma & Gnani Timbre · by [your name]"*. Contributions go in the emailed form. |

**Never say or show:** that the app is used by colleges, that it improved marks, that it won an award, or that it simulates forces or failures. None of these are true yet.

---

## Part B: Before recording (10 minutes)

1. Start the backend (`python -m uvicorn app.main:app --port 8000` in `backend/`) and the frontend (`npm run dev` in `frontend/`). Close the terminals' windows from view afterwards. **Never show a terminal, `.env` file or API key.**
2. Open Chrome or Edge, **maximise it first**, open `http://localhost:5173`, then press **F5** (reload at the final size). Use 100% zoom and one tab, and hide the bookmarks bar.
3. Turn on Windows **Do not disturb**. Close email, WhatsApp, Slack and anything with notifications.
4. Mic test: press **M**, say *"Zoom in"*, check that the transcript appears, then reload (F5) so the tutor starts empty.
5. Camera test (for the gesture shot): good light on your hand and a plain background. Click **Camera & gestures → Start Camera**, check that a hand skeleton appears, then **Stop Camera**.
6. Rehearse **once**: *"Can you explain how this gearbox works?"* and *"What happens if I remove this gear?"* Each real answer uses Gnani and Gemini credits.
7. Recording setup: see Part E.

---

## Part C: The script (≈ 180 seconds)

**Flow:** ① Opening question → ② The problem → ③ Our solution → ④ Live demo → ⑤ Impact & benefits → ⑥ Conclusion

| # | Section | Time | Length |
| :--- | :--- | :--- | :--- |
| ① | Opening question: make the viewer think | 0:00–0:20 | 20 s |
| ② | The problem | 0:20–0:40 | 20 s |
| ③ | Our solution | 0:40–0:55 | 15 s |
| ④ | Live demo (3D, Gnani voice, point and ask) | 0:55–2:25 | 90 s |
| ⑤ | Impact & benefits | 2:25–2:50 | 25 s |
| ⑥ | Conclusion | 2:50–3:00 | 10 s |

Narration is about 300 words at a calm pace (~150 words per minute). The rest of the time belongs to the app itself: your live question and the real **Gnani Timbre** voice.

---

### ① Opening question: make them think (0:00–0:20)

The video opens on a question, not on the product. Let the viewer try to answer it in their head.

| On screen | Action |
| :--- | :--- |
| Landing page: the live, exploded 3D gearbox, slowly turning. Nothing else. | Mouse completely still |
| **Caption 1 (0:02):** `Look at this machine. What does each part do?` | |
| **Caption 2 (0:09):** `What would happen if one gear were missing?` | |
| **Caption 3 (0:15):** `…and who would you ask?` | |

> **Say:** "Look at this machine. Can you tell what each part does? What would happen if one of these gears were missing? *(pause two seconds)* And if you had that question right now, who would you ask?"

*Hold the pause. The silence is what makes the viewer think.*

### ② The problem (0:20–0:40)

| On screen | Action |
| :--- | :--- |
| Click **Open the gearbox** → the full gearbox in the workspace, auto-rotating | One click, then hands off |
| **Caption:** `Students can SEE a machine, but they can't ASK it anything` | |

> **Say:** "That's the problem for most engineering students. We learn machines from textbooks, flat diagrams and CAD files. A 3D model shows *what* the parts look like, but not *why* they're there or *how* they work together. And when a question comes up, there's usually no one to ask, and rarely anyone who explains it in our own language."

### ③ Our solution (0:40–0:55)

| On screen | Action |
| :--- | :--- |
| Press **[** (parts tree) and **]** (part inspector), then point the mouse at the **Voice tutor** bar | Two key presses, one mouse move |
| **Caption:** `GestureLab CAD: a 3D engineering tutor you can talk to` | |
| **Caption 2:** `Speak → Gnani Prisma → AI lesson → parts light up in 3D → Gnani Timbre speaks` | |

> **Say:** "So I built GestureLab CAD: a 3D model that becomes a tutor. You point at a part and ask out loud. Gnani Prisma understands you, the AI plans an answer from the model's real parts, those parts light up, and Gnani Timbre explains, step by step."

### ④ Live demo (0:55–2:25)

**Caption for the whole section:** `LIVE · nothing pre-recorded`

#### 4a. Explore the real 3D model (0:55–1:10)

| Time | Action | What appears |
| :--- | :--- | :--- |
| 0:55 | Click **Sun Gear** in the parts tree | Sun Gear turns orange; the inspector shows *Central Driving Input* and **Component Relationships** (*Driven By → Primary Drive Shaft*, *Mates With → Planet Gear A…*) |
| 1:02 | Click **Explode** | Parts separate into a colour-coded X-ray view with labels |
| 1:07 | Click **Reassemble** (top bar), then press **Esc** | Back together; nothing selected |

> **Say:** "Every part comes from the model's real data: its role, and what it drives. One click takes it apart; one click puts it back."

#### 4b. Ask with your voice: Gnani Prisma and Gnani Timbre (1:10–1:55)

| Time | Action | What appears |
| :--- | :--- | :--- |
| 1:10 | Press **M** | **"Listening… I stop when you stop"** |
| 1:11 | **Speak clearly:** *"Can you explain how this gearbox works?"* | **"Understanding…"**, then **YOU ASKED "Can you explain how this gearbox works?"** |
| 1:16 | Wait | **"Preparing an explanation…"**, then **"Explaining — step 1 of N"** and the step bar |
| 1:20–1:55 | **Stay silent and let the app speak** | **Gnani Timbre** reads each step aloud. Two gears light up at a time, with **"Shown in the 3D model: Sun Gear · Planet Gear A"**. The parts may separate in a later step. |

**Captions, timed to the screen:**
- Transcript appears: `Gnani Prisma: my voice → text`
- "Preparing…": `AI builds a lesson, checked against the real model`
- First spoken step: `Gnani Timbre: each step spoken while its parts light up`

> **Say** (only during "Preparing…", **never over Timbre**): "I asked that live. Gnani Prisma turned it into text. Now listen to Gnani Timbre."

**Rule:** keep **at least 15 seconds of the real Timbre voice** with nothing over it. If the answer runs long, cut it at 1:55 and add `(answer shortened for time)`. Never edit the transcript or the speech.

#### 4c. Point with your hand, ask with your voice (1:55–2:25)

| Time | Action | What appears |
| :--- | :--- | :--- |
| 1:55 | **Gesture** (only if it worked in rehearsal): **Camera & gestures → Start Camera**, point your index finger at the **Sun Gear**, hold 1.2 s. **Safe alternative:** click Sun Gear in the parts tree. | **"Sun Gear selected — tap the mic (or press M) and ask about it"** |
| 2:02 | Press **M**, say *"What happens if I remove this gear?"* | **"Without the Sun Gear"** (focused), then the parts that depend on it light up: Primary Drive Shaft and Planet Gears A–C. Labels: **Engineering explanation** · **Not simulated in this app** |

**Caption:** `Point at a part + say "this gear": voice and gesture together`

> **Say** (between steps): "I pointed at the sun gear, so 'this gear' means that part. Remember the question at the start, *what if a gear were missing?* Now the machine answers it, and it's honest that this is reasoning, not a simulation."

*Calling back to the opening question here closes the loop for the viewer.*

### ⑤ Impact & benefits (2:25–2:50)

| On screen | Action |
| :--- | :--- |
| Workspace with the tutor's follow-up question buttons visible | No action |
| **Caption (who benefits):** `Mechanical & diploma students · first-time learners · regional-language learners · teachers` | |
| **Caption (why Gnani):** `Gnani Prisma listens · Gnani Timbre speaks · in English, Telugu, Hindi` | |

> **Say:** "Who benefits? Mechanical and diploma students meeting a machine for the first time, students who learn best in Telugu or Hindi, and teachers demonstrating in class, with just a laptop and a webcam. And Gnani's voice models do more than listen and talk here: Prisma turns a question into an action on a real machine, and Timbre explains it in sync with what you see."

### ⑥ Conclusion (2:50–3:00)

| On screen | Action |
| :--- | :--- |
| Full gearbox auto-rotating, then the closing card: **GestureLab CAD · Built with Gnani Prisma & Gnani Timbre · by [your name] · #GreatIndianAIInternshipChallenge #GnaniAI · Jugaad Genius Award entry** | |

> **Say:** "Every student deserves to ask *why*. GestureLab CAD lets them ask the machine itself. Built for engineering learners, powered by Gnani AI. Thank you."

*(Say "entry", never "winner" or "selected".)*

---

## Part D: Optional 60-second cut (Demo Day Drop Award: "best 60-second demo video")

Same order, compressed. **The full, detailed 60-second script (shot list, captions and AI-voice narration clips) is in [`COMPETITION_DEMO_SCRIPT_60S.md`](COMPETITION_DEMO_SCRIPT_60S.md).** Summary:

| Time | Section | Use |
| :--- | :--- | :--- |
| 0:00–0:08 | ① Question | *"What happens if one gear in this machine goes missing? Who would you ask?"* |
| 0:08–0:16 | ② Problem | *"Students can see a 3D machine, but they can't ask it anything, especially in their own language."* |
| 0:16–0:22 | ③ Solution | *"GestureLab CAD: point, ask out loud, and the machine explains itself."* |
| 0:22–0:50 | ④ Live demo | Spoken question → Prisma transcript → Timbre speaking while the gears light up; then point at a gear → "What happens if I remove this gear?" |
| 0:50–0:56 | ⑤ Benefit | *"For engineering students, in their own language, powered by Gnani Prisma and Timbre."* |
| 0:56–1:00 | ⑥ Close | Closing card with both hashtags |

This cut also fits X's 2:20 limit for standard accounts.

---

## Part E: How to record and edit (built-in Windows tools)

**Record: Snipping Tool**
1. Press **Win + Shift + R** (or Snipping Tool → Record) and select the **whole screen**.
2. Turn on **both** the **microphone** and **system audio**, so your question *and* Timbre's voice are recorded.
3. Record the live demo (④, 0:55–2:25) as **one continuous take**: this is the proof that the app works live. Record the opening and closing as separate short takes if easier.
4. Files are saved to `Videos\Screen Recordings`.

**Edit: Clipchamp** (pre-installed)
1. Place the takes on the 0:00–3:00 timeline above.
2. Trim only *waiting* (long "Preparing…" pauses). Caption every shortened answer.
3. Add the captions listed in Part C (simple lower-third text).
4. Add narration in the take or with **Record & create → Audio**. Lower the app volume to about 30% *only* where you narrate, never during the 15 s of real Timbre speech.
5. Export at **1080p**.

**Final check before posting:** watch the export once and look only for keys, file paths, terminals, notifications, email addresses or personal data. Then post it as described in `docs/COMPETITION_SOCIAL_POST.md` and nominate the post link in the submission form.
