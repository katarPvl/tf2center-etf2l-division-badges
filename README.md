# TF2Center ETF2L Division Badges

Browser extension that shows ETF2L division badges next to players on TF2Center lobby pages.

This is an unofficial community project. It is not affiliated with TF2Center or ETF2L.

---

## Features

* Shows ETF2L division badges on TF2Center lobby pages.
* Detects players by TF2Center profile links.
* Extracts SteamID64 from player profile URLs.
* Uses ETF2L API v2.
* Caches lookup results locally to reduce API requests.
* Adds small colored badges next to player names.

---

## Supported pages

The extension runs only on TF2Center lobby pages:

```text
https://tf2center.com/lobbies/*
https://www.tf2center.com/lobbies/*
```

It does not run on the TF2Center lobby list page.

---

## Project files

```text
manifest.json      Extension manifest, permissions and content script config
background.js      ETF2L API lookup, cache and background message handler
contentScript.js   TF2Center page scanner and badge renderer
styles.css         Badge styles
```

---

# Installation guide — English

## Google Chrome / Chromium / Brave / Opera

1. Download this repository.
2. Extract the ZIP archive if you downloaded it from GitHub.
3. Open your browser.
4. Go to:

```text
chrome://extensions
```

5. Enable **Developer mode**.
6. Click **Load unpacked**.
7. Select the project folder.

Important: select the folder that contains `manifest.json`.

Correct folder:

```text
tf2center-etf2l-division-badges/
├── manifest.json
├── background.js
├── contentScript.js
└── styles.css
```

Wrong folder:

```text
tf2center-etf2l-division-badges-main/
└── tf2center-etf2l-division-badges/
    ├── manifest.json
    ├── background.js
    ├── contentScript.js
    └── styles.css
```

If the browser says that `manifest.json` is missing, you selected the wrong folder.

---

## Microsoft Edge

1. Download this repository.
2. Extract the ZIP archive.
3. Open Microsoft Edge.
4. Go to:

```text
edge://extensions
```

5. Enable **Developer mode**.
6. Click **Load unpacked**.
7. Select the folder that contains `manifest.json`.

---

## Yandex Browser

1. Download this repository.
2. Extract the ZIP archive.
3. Open Yandex Browser.
4. Go to:

```text
browser://extensions
```

5. Enable **Developer mode**.
6. Click **Load unpacked extension**.
7. Select the project folder or select `manifest.json` inside the project folder.

The selected folder must contain:

```text
manifest.json
background.js
contentScript.js
styles.css
```

---

## How to check if it works

1. Open a TF2Center lobby page, for example:

```text
https://tf2center.com/lobbies/1234567
```

2. Wait a few seconds.
3. ETF2L division badges should appear next to player names if the extension finds ETF2L data for them.

To debug:

1. Open the lobby page.
2. Press `F12`.
3. Open the **Console** tab.
4. Check for extension errors.

---

# Инструкция по установке — Русский

## Google Chrome / Chromium / Brave / Opera

1. Скачайте этот репозиторий.
2. Распакуйте ZIP-архив, если скачивали проект с GitHub.
3. Откройте браузер.
4. Перейдите на страницу:

```text
chrome://extensions
```

5. Включите **Режим разработчика**.
6. Нажмите **Загрузить распакованное расширение** / **Load unpacked**.
7. Выберите папку проекта.

Важно: нужно выбрать именно ту папку, внутри которой лежит `manifest.json`.

Правильно:

```text
tf2center-etf2l-division-badges/
├── manifest.json
├── background.js
├── contentScript.js
└── styles.css
```

Неправильно:

```text
tf2center-etf2l-division-badges-main/
└── tf2center-etf2l-division-badges/
    ├── manifest.json
    ├── background.js
    ├── contentScript.js
    └── styles.css
```

Если браузер пишет, что `manifest.json` не найден, значит выбрана не та папка.

---

## Microsoft Edge

1. Скачайте этот репозиторий.
2. Распакуйте ZIP-архив.
3. Откройте Microsoft Edge.
4. Перейдите на страницу:

```text
edge://extensions
```

5. Включите **Режим разработчика**.
6. Нажмите **Load unpacked** / **Загрузить распакованное**.
7. Выберите папку, где лежит `manifest.json`.

---

## Yandex Browser

1. Скачайте этот репозиторий.
2. Распакуйте ZIP-архив.
3. Откройте Яндекс Браузер.
4. Перейдите на страницу:

```text
browser://extensions
```

5. Включите **Режим разработчика**.
6. Нажмите **Загрузить распакованное расширение**.
7. Выберите папку проекта или файл `manifest.json` внутри папки проекта.

В выбранной папке должны лежать:

```text
manifest.json
background.js
contentScript.js
styles.css
```

---

## Как проверить работу

1. Откройте страницу конкретного лобби TF2Center, например:

```text
https://tf2center.com/lobbies/1234567
```

2. Подождите несколько секунд.
3. Рядом с никами игроков должны появиться бейджи ETF2L-дивизионов, если расширение смогло найти данные игрока в ETF2L.

Для проверки ошибок:

1. Откройте страницу лобби.
2. Нажмите `F12`.
3. Откройте вкладку **Console** / **Консоль**.
4. Проверьте, нет ли ошибок расширения.

---

## Notes

This extension uses only local browser storage and ETF2L API requests.

It does not require your Steam password, TF2Center password, ETF2L password, or any API key.

---

## License

MIT
