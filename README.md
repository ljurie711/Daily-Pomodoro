# 🍅 Daily Pomodoro

A calm, good-looking Pomodoro timer you can install as an app in Google Chrome. It has no dependencies or build step, and it works offline once installed.

**Live app:** https://ljurie711.github.io/Daily-Pomodoro/

## Features

- **Classic cycle:** 25 min focus → 5 min short break, with a 15 min long break after every 4 focus sessions. Every duration can be changed.
- **Sound:**
  - A chime when each section ends: bell, marimba, digital, or none.
  - Optional ambient focus noise: white, brown, or rain. You can also keep the noise playing during breaks.
- **On-screen reminders:**
  - A desktop notification that stays visible until you dismiss it.
  - A full-window reminder card inside the app.
  - A live countdown in the tab title and favicon.
- **Break recommendations:** each break suggests a refreshing activity, such as eye resets, stretching, a short walk, water, or guided box breathing. Click "Another idea" if one doesn't fit.
- **Daily stats:** pomodoros against your daily goal, focus minutes, and a day streak. Everything is stored locally in your browser.
- **Auto-start toggle:** off by default. Turn it on in Settings to chain sections automatically.
- **Themes and layout:** dark and light themes, a responsive layout, and support for reduced-motion settings.

## Make it easy to open every day (Chrome)

1. Open the live app in **Chrome**.
2. Click the **install icon** in the address bar, or **⋮ → Cast, save, and share → Install page as app**. You can also use the **Install** button in the app's top bar.
3. **Pin it:**
   - Right-click the Daily Pomodoro icon on the taskbar and choose **Pin to taskbar**.
   - It is also added to your Start menu.
4. *(Optional)* **Launch it when you sign in:**
   1. Go to `chrome://apps`.
   2. Right-click **Daily Pomodoro** and choose **Start app when you sign in**.
5. Click **Enable notifications** in the app so reminders appear even when the window is in the background.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Space` | Start / pause |
| `R` | Reset current section |
| `S` | Skip to next section |
| `N` | Toggle focus noise |
| `Esc` | Close the reminder or settings |

## Why these break ideas?

Short breaks work best when you step **away from the screen**:
- Look at something about 20 ft (6 m) away to relax your eyes.
- Move your body to get your blood flowing again.
- Drink some water.
- Breathe slowly to calm your nervous system.

Long breaks are for real recovery: a walk outside, a snack, a short lie-down, or a chat with someone. Checking email or social media during a break usually leaves you *more* tired for the next session.

## Run locally

Any static file server works, for example:

```powershell
npx serve .
# or
python -m http.server 8000
```

Then open `http://localhost:8000`. Opening `index.html` directly also works, but you won't be able to install the app or use it offline that way.

## Deploying (GitHub Pages)

To enable the site: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `/ (root)`**.

When you change the app files, increase the `CACHE` version in `sw.js` so installed copies pick up the update.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | App layout |
| `styles.css` | Themes and styling |
| `app.js` | Timer logic, settings, stats, notifications |
| `audio.js` | Chimes and ambient noise (Web Audio, no audio files) |
| `breaks.js` | Break recommendations |
| `sw.js`, `manifest.webmanifest`, `icons/` | Installable app and offline support |
