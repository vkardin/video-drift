<p align="center"><img src=".github/assets/project-banner.svg" alt="Video Drift by vkardin" width="100%"></p>

<h1 align="center">Video Drift</h1>

<p align="center"><b>A floating video player that remembers where you stopped</b><br>
English · <a href="README.ru.md">Русский</a> · <a href="README.uk.md">Українська</a></p>

<p align="center">
<a href="../../releases"><img alt="Chrome" src="https://img.shields.io/github/v/release/vkardin/video-drift?label=Chrome&logo=googlechrome&logoColor=white"></a>
<a href="../../releases"><img alt="Firefox" src="https://img.shields.io/github/v/release/vkardin/video-drift?label=Firefox&logo=firefoxbrowser&logoColor=white"></a>
<a href="https://vkardin.github.io/video-drift/"><img alt="Website" src="https://img.shields.io/badge/site-vkardin.github.io%2Fvideo--drift-222"></a>
<a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-blue"></a>
</p>

Video Drift pops any web video into a floating window that stays on top while you work. The site's subtitles go with it, the exact second you stopped is remembered for every video, and your notes to the frame export to a tidy Markdown file. Works on YouTube, Twitch, online courses and any other site with HTML5 video. Free, no account needed.

## Version 2.0

A dedicated viewing library groups Continue, Watch later and Bookmarks, with search and site filters. Export a JSON backup and merge it back on another installation. The in-page player remembers its position and size, offers expandable controls and an A–B repeat button (set A, set B, click again to clear). Subtitle size, background and bottom offset are adjustable in the popup settings. Select between multiple videos in the current frame. Existing 1.x history and bookmarks remain compatible.

## Install

- **Chrome, Edge, Brave, Opera:** Chrome Web Store listing is on the way; meanwhile use the zip below
- **Firefox:** Firefox Add-ons listing is on the way; meanwhile use the zip below
- **Manual install:** zip files for Chrome and Firefox on the [Releases](../../releases) page. Chrome: unzip, open `chrome://extensions`, turn on Developer mode, click *Load unpacked*. Firefox: `about:debugging` → *Load Temporary Add-on*

## Features

- Floating window with its own controls (Document Picture-in-Picture), native PiP as a fallback, or a mini player over the page
- Subtitles drawn by the site (YouTube, Netflix, Video.js, Plyr, JW Player and more) stay with the video
- Remembers the playback position of every video and offers *Continue from 12:34?*
- **Continue** tab: recent unfinished videos with progress and a link to the saved moment. History stays on this device; remove individual videos, clear the list, or disable recording in Settings
- **Bookmarks** tab: all saved videos and notes, searchable by title, site or note. Edit notes, open a saved moment, and export one video or everything to Markdown. Available even on a tab without a video
- Bookmarks with notes to the frame; export one video or everything to Markdown for Obsidian or Notion
- Copy a link that opens the video at the current second
- Seek bar, speed 0.25×–4×, volume presets and hotkeys right in the player
- Shadow mode: opacity 30–100% for the mini player over the page
- Choose which buttons the player shows; English, Русский, Українська; light and dark popup

### Hotkeys

| Action | Keys |
|---|---|
| Float the video / bring it back | <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> on the page |
| Faster / slower | <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>.</kbd> / <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>,</kbd> |
| Bookmark the current moment | <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd> |
| In the floating window | <kbd>Space</kbd>, <kbd>←</kbd>/<kbd>→</kbd> ±5 s, <kbd>&lt;</kbd>/<kbd>&gt;</kbd> speed |

## Privacy

Video Drift collects no data and sends nothing anywhere: everything runs on your device. [Privacy policy](https://vkardin.github.io/video-drift/privacy.html).

## Feedback and support

- Ideas and bug reports: [feedback page](https://vkardin.github.io/video-drift/support.html) or [GitHub Issues](../../issues/new/choose)
- Support the project with crypto: [https://vkardin.github.io/video-drift/#donate](https://vkardin.github.io/video-drift/#donate)

## Repository

| Folder | What is inside |
|---|---|
| [`extension/`](extension) | Extension source (load via `chrome://extensions` → Developer mode → Load unpacked) |
| [`docs/`](docs) | Website, served by GitHub Pages |
| [`store/`](store) | Store listing texts and graphics specification |
| [`tools/`](tools) | `build.py` packs the Chrome and Firefox zips |


## License

[MIT](LICENSE) © vkardin

## Development checks

```bash
npm ci
npx playwright install chromium
npm test
python3 tools/build.py
```

The tests cover legacy storage, sync quota fallback, history, bookmark editing and search,
Markdown downloads, EN/RU/UK popup layouts, delayed media metadata, and returning the
video from the in-page player with mirrored subtitles. Browser tests use local fixtures
with extension API and media state stubs; live sites, real Document PiP and Firefox
still need manual checks. Set `CHROMIUM_PATH` to use an existing Chromium executable.

<!-- project-family:start -->

[**vkardin / tools — all projects ↗**](https://vkardin.github.io/video-glow/projects/)
## More tools by vkardin

| Project | Projects |
| --- | --- |
| **[Video Glow](https://vkardin.github.io/video-glow/)** | Ambient light around web videos. Soft glow, LED strips and room colour. [GitHub](https://github.com/vkardin/video-glow) |
| **[Leveler](https://vkardin.github.io/leveler/)** | Even loudness, clearer dialogue, an equalizer and playback speed controls. [GitHub](https://github.com/vkardin/leveler) |
| **[Snapt](https://vkardin.github.io/snapt/)** | Capture, annotate and export. A Windows, macOS and Linux app, plus a browser extension. [GitHub](https://github.com/vkardin/snapt) |
| **[UNI](https://vkardin.github.io/uni-homebot/)** | Your home server in Telegram: apps, monitoring, notifications and a Mini App. [GitHub](https://github.com/vkardin/uni-homebot) |

[github.com/vkardin](https://github.com/vkardin) · Independent tools · open source
<!-- project-family:end -->
