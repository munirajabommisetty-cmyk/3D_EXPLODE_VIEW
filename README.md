# GestureLab CAD

### Explore in 3D. Interact with AI. Understand How Things Work.

**GestureLab CAD** is an AI-powered, voice-interactive 3D learning and exploration platform designed to make complex concepts easier to explore and understand.

Traditional learning often relies on static diagrams, images, and explanations. However, understanding how individual components connect, interact, and function as part of a larger system can be challenging.

GestureLab CAD addresses this challenge by bringing together **interactive 3D visualization, AI-powered explanations, voice interaction, and gesture-based controls** in one platform.

Whether exploring a mechanical gearbox, understanding a suspension bridge, examining a steam engine, or learning about the human eye, users can interact with 3D models and ask questions to gain a clearer understanding of how things work.

---

## Project Overview

GestureLab CAD aims to transform passive learning into an interactive exploration experience.

Instead of simply viewing a diagram or model, users can:

* Explore complex structures through interactive 3D models.
* Rotate, zoom, and inspect individual components.
* Understand how different components work together.
* Ask questions naturally using voice interaction.
* Receive AI-generated explanations.
* Listen to explanations through text-to-speech.
* Interact with 3D environments using hand gestures.

The platform is designed for students, educators, and curious learners across multiple domains.

---

## Key Features

### 1. Interactive 3D Visualization

* Explore detailed 3D models.
* Rotate, zoom, and inspect structures.
* Select individual components.
* Understand the relationships between different parts.

### 2. AI-Powered Explanations

* Ask questions about the displayed 3D models.
* Receive context-aware AI-generated explanations.
* Understand complex concepts through natural-language interaction.

### 3. Voice-Based Interaction

GestureLab CAD integrates Gnani AI speech technologies to provide a natural voice interaction experience.

* **Gnani AI Prisma – Speech-to-Text (STT):** Converts spoken questions into text.
* **Gemini AI – Reasoning and Response Generation:** Processes the transcribed question and generates an explanation.
* **Gnani AI Timbre – Text-to-Speech (TTS):** Converts the generated explanation into spoken audio.

This creates a voice interaction pipeline that allows users to ask questions and listen to AI-generated responses.

### 4. Gesture-Based Controls

* Interact with 3D models using hand gestures.
* Detect hand landmarks using MediaPipe.
* Recognize supported gestures for controlling the 3D environment.
* Provide an alternative to conventional mouse-based interaction.

### 5. Multi-Domain Exploration

GestureLab CAD is not restricted to mechanical engineering. It supports exploration across different domains.

| Domain                        | Example Models                  |
| ----------------------------- | ------------------------------- |
| Mechanical Engineering        | Gearbox and internal mechanisms |
| Architecture & Infrastructure | Suspension bridge               |
| Mechanical Systems            | Steam engine                    |
| Biology & Human Anatomy       | Human eye                       |

---

## How the AI Voice Interaction Works

The voice assistant follows this processing pipeline:

```text
          User Speaks a Question
                    |
                    v
          Gnani AI Prisma (STT)
                    |
                    v
             Speech to Text
                    |
                    v
              Gemini AI
        Reasoning & Response Generation
                    |
                    v
          Gnani AI Timbre (TTS)
                    |
                    v
          Generated Speech Audio
                    |
                    v
          User Hears Explanation
```

The separation of speech recognition, AI reasoning, and speech generation allows each component to perform its specific responsibility.

---

## Technology Stack

| Component            | Technology      |
| -------------------- | --------------- |
| Frontend             | React           |
| Programming Language | TypeScript      |
| 3D Visualization     | Three.js        |
| Hand Tracking        | MediaPipe       |
| Backend              | Python, FastAPI |
| AI Reasoning         | Google Gemini   |
| Speech-to-Text       | Gnani AI Prisma |
| Text-to-Speech       | Gnani AI Timbre |

---

## System Architecture

At a high level, GestureLab CAD consists of the following components:

```text
                  USER
                   |
          +--------+--------+
          |                 |
          v                 v
     3D Interaction     Voice Input
          |                 |
          v                 v
    React + Three.js   Gnani AI Prisma
          |                 |
          |                 v
          |            FastAPI Backend
          |                 |
          |                 v
          |              Gemini AI
          |                 |
          |                 v
          |           Generated Response
          |                 |
          |                 v
          |           Gnani AI Timbre
          |                 |
          +--------+--------+
                   |
                   v
             USER EXPERIENCE

       MediaPipe Hand Tracking
                   |
                   v
          Gesture Recognition
                   |
                   v
           3D Scene Controls
```

*Conceptual architecture illustrating the major components and their responsibilities.*

---

## Who Can Benefit?

**Students**

* Explore difficult academic concepts visually.
* Understand complex structures and mechanisms.
* Clarify doubts through AI-powered assistance.

**Educators**

* Support explanations with interactive 3D models.
* Demonstrate how components and systems work.

**Curious Learners**

* Explore real-world structures and systems.
* Learn through visual interaction and natural questions.

---

## Project Vision

Our vision is to make complex concepts easier to explore, understand, and interact with.

By combining 3D visualization, AI-powered explanations, voice technologies, and gesture recognition, GestureLab CAD aims to create a more engaging way to learn about the world around us.

**More than just viewing 3D models — explore, interact, and understand.**

---

## Project Status

GestureLab CAD is an actively developed project.

The platform brings together multiple technologies into a unified interactive learning experience. Features and supported models may evolve as development continues.

---

## Future Scope

Potential areas for further development include:

* Expanding the collection of 3D educational models.
* Supporting additional domains and subjects.
* Improving AI explanations and model-specific context.
* Enhancing gesture recognition and interaction.
* Improving the overall learning experience and accessibility.

---

## Acknowledgements

This project integrates technologies and tools from:

* Google Gemini
* Gnani AI – Prisma and Timbre
* Three.js
* MediaPipe
* React
* FastAPI

---

## Author

**Muniraja**

B.Tech – Artificial Intelligence & Machine Learning

---

### GestureLab CAD

**Explore in 3D. Interact with AI. Understand How Things Work.**
