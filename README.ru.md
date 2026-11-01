<p align="center"><img src="docs/img/logo.svg" width="96" alt="Video Drift"></p>

<h1 align="center">Video Drift</h1>

<p align="center"><b>Плавающий видеоплеер, который помнит, где вы остановились</b><br>
<a href="README.md">English</a> · Русский · <a href="README.uk.md">Українська</a></p>

<p align="center">
<a href="../../releases"><img alt="Chrome" src="https://img.shields.io/github/v/release/vkardin/video-drift?label=Chrome&logo=googlechrome&logoColor=white"></a>
<a href="../../releases"><img alt="Firefox" src="https://img.shields.io/github/v/release/vkardin/video-drift?label=Firefox&logo=firefoxbrowser&logoColor=white"></a>
<a href="https://vkardin.github.io/video-drift/"><img alt="Website" src="https://img.shields.io/badge/site-vkardin.github.io%2Fvideo--drift-222"></a>
<a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-blue"></a>
</p>

Video Drift выносит любое веб-видео в плавающее окно поверх остальных, пока вы работаете. Субтитры сайта переезжают вместе с ним, точная секунда остановки запоминается для каждого видео, а заметки к кадру выгружаются в аккуратный Markdown. Работает на YouTube, Twitch, онлайн-курсах и любом другом сайте с HTML5-видео. Бесплатно, без аккаунта.

## Установка

- **Chrome, Edge, Brave, Opera:** страница в Chrome Web Store скоро появится, пока ставьте zip ниже
- **Firefox:** страница в Firefox Add-ons скоро появится, пока ставьте zip ниже
- **Вручную:** zip для Chrome и Firefox на странице [Releases](../../releases). Chrome: распакуйте, откройте `chrome://extensions`, включите режим разработчика, нажмите «Загрузить распакованное». Firefox: `about:debugging` → «Загрузить временное дополнение»

## Возможности

- Плавающее окно со своими кнопками (Document Picture-in-Picture), нативный PiP как запасной вариант или мини-плеер поверх страницы
- Субтитры сайта (YouTube, Netflix, Video.js, Plyr, JW Player и другие) остаются с видео
- Запоминает позицию каждого видео и предлагает «Продолжить с 12:34?»
- Закладки с заметками к кадру; экспорт одного видео или всего сразу в Markdown для Obsidian или Notion
- Ссылка, которая открывает видео на текущей секунде
- Полоса перемотки, скорость 0.25×–4×, пресеты громкости и горячие клавиши прямо в плеере
- Режим тени: прозрачность 30–100% для мини-плеера поверх страницы
- Выбор кнопок плеера; English, Русский, Українська; светлый и тёмный попап

### Библиотека просмотра (1.4)

- **Продолжить**: последние недосмотренные видео с прогрессом и переходом к сохранённому моменту. История хранится на устройстве: можно удалить видео, очистить список или отключить сохранение в настройках.
- **Закладки**: общая коллекция с поиском по видео, сайту и заметкам, редактированием заметок и экспортом Markdown. Доступна даже на вкладке без видео.

### Горячие клавиши

| Действие | Клавиши |
|---|---|
| Вынести видео / вернуть | <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> на странице |
| Быстрее / медленнее | <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>.</kbd> / <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>,</kbd> |
| Закладка на текущий момент | <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd> |
| В плавающем окне | <kbd>Пробел</kbd>, <kbd>←</kbd>/<kbd>→</kbd> ±5 с, <kbd>&lt;</kbd>/<kbd>&gt;</kbd> скорость |

## Приватность

Video Drift не собирает данные и ничего никуда не отправляет: всё работает на вашем устройстве. [Политика конфиденциальности](https://vkardin.github.io/video-drift/privacy.html).

## Обратная связь и поддержка

- Идеи и ошибки: [страница обратной связи](https://vkardin.github.io/video-drift/support.html) или [GitHub Issues](../../issues/new/choose)
- Поддержать проект криптовалютой: [https://vkardin.github.io/video-drift/#donate](https://vkardin.github.io/video-drift/#donate)

## Репозиторий

| Папка | Что внутри |
|---|---|
| [`extension/`](extension) | Исходники расширения (загрузка через `chrome://extensions` → режим разработчика → «Загрузить распакованное») |
| [`docs/`](docs) | Сайт на GitHub Pages |
| [`store/`](store) | Тексты для магазинов и спецификация графики |
| [`tools/`](tools) | `build.py` собирает zip для Chrome и Firefox |

## Другие проекты автора

- [Video Glow](https://vkardin.github.io/video-glow/): фоновая подсветка в цветах картинки вокруг любого видео в браузере.
- [Leveler](https://vkardin.github.io/leveler/): выравнивает громкость любого видео: тихие диалоги громче, взрывы тише.
- [Snapt](https://vkardin.github.io/snapt/): быстрые скриншоты с открытым кодом для Windows, macOS и Linux.
- [UNI](https://vkardin.github.io/uni-homebot/): домашний сервер в Telegram, с приложениями, мониторингом и мини-приложением.

## Лицензия

[MIT](LICENSE) © vkardin
