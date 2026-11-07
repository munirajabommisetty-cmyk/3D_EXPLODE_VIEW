# GestureLab CAD: Social Post Drafts (not published)

Replace the `[…]` placeholders before posting. Tag **Gnani AI** with the platform's @-mention picker so it becomes a real tag; typed text alone is not a tag.

> **Video length on X:** standard (non-Premium) X accounts accept videos up to **2 min 20 s**. For X, either post from a Premium account, or upload a 2:20 cut (drop the 02:20–02:45 section and shorten the opening). LinkedIn accepts the full 3-minute video.

---

## LinkedIn post

What if a student could **point at a gear, ask "what happens if I remove this?", and watch the answer happen in 3D?** 🎙️⚙️

Mechanical engineering students meet complex assemblies through textbooks, static diagrams and CAD models. They can *look* at a planetary gearbox, but understanding what each part does and how the whole mechanism works usually needs someone to explain it, ideally in their own language.

So I built **GestureLab CAD**, a voice- and gesture-driven 3D engineering tutor, for the **#GreatIndianAIInternshipChallenge** by @Gnani AI.

🔹 **Who it's for:** mechanical and diploma students, engineering beginners, and educators who demonstrate mechanisms.

🔹 **How it works**
- 🎙️ **Gnani Prisma** (speech-to-text) turns a spoken question, in English, Telugu or Hindi, into text.
- 🧠 **Gemini** writes a short step-by-step lesson plan from the model's real parts and connections. Every step is checked before it runs.
- 🧊 **Three.js** highlights the exact parts being explained, or separates the assembly.
- 🔊 **Gnani Timbre** (text-to-speech) speaks each step **while** those parts light up.
- ✋ Hand gestures through an ordinary webcam: point at a part and "this gear" means that part.

🔹 **Why it's a creative use of Gnani AI:** the voice doesn't just listen and talk. It *drives* an interactive engineering model. Speech becomes a 3D action, and every spoken explanation is synchronised with what the student sees. All it needs is a laptop and a webcam, in the student's own language.

🎬 3-minute demo below 👇: a live voice question, the step-by-step answer in 3D, a "what if I remove this gear?" question, and gesture control.

Built with React, TypeScript, Three.js, FastAPI, MediaPipe, Gnani Prisma, Gnani Timbre and Gemini.

[Video attached]
[Optional: GitHub link]

@Gnani AI (LinkedIn page: linkedin.com/company/gnani-ai, choose it from the @-mention list)
#GreatIndianAIInternshipChallenge #GnaniAI #EngineeringEducation #VoiceAI #3D #EdTech

---

## X (Twitter) post (≤ 280 characters with the tag)

Point at a gear. Ask "what if I remove this?" See the answer in 3D. ⚙️

GestureLab CAD: a voice + gesture engineering tutor. Gnani Prisma hears the question; Gnani Timbre speaks each step as the parts light up.

@GnaniAi #GreatIndianAIInternshipChallenge #GnaniAI

[Video attached: 2:20 cut unless the account is Premium]

*(Optional reply-thread tweet:)* Under the hood: Gnani Prisma (STT) → Gemini lesson plan, checked against the real model → Three.js highlights → Gnani Timbre (TTS) in English, Telugu and Hindi. Built for mechanical and diploma students. [GitHub link]

---

## After posting (Step 4: final submission)

| Item | Value |
| :--- | :--- |
| Demo video | `[path / link to the exported video]` |
| Written explanation | `docs/COMPETITION_PROJECT_EXPLANATION.md` |
| Gnani models / APIs used | Gnani Prisma (STT, `stt/v3`); Gnani Timbre (TTS, `timbre-v2.5`) |
| LinkedIn post URL | `[paste the LinkedIn post link]` |
| X post URL | `[paste the X post link]` |
| Deadline | **10 November 2026, 11:59 PM IST** |

Tagging alone does not complete the entry. Nominate one post link per platform in Step 4.
