const SETTINGS_KEY = "settings";
const DEFAULT_SETTINGS = { showWinProbability: true };

const checkbox = document.getElementById("showWinProbability");

chrome.storage.sync.get(SETTINGS_KEY).then((data) => {
  const s = { ...DEFAULT_SETTINGS, ...(data?.[SETTINGS_KEY] || {}) };
  checkbox.checked = !!s.showWinProbability;
});

checkbox.addEventListener("change", async () => {
  const data = await chrome.storage.sync.get(SETTINGS_KEY);
  const s = { ...DEFAULT_SETTINGS, ...(data?.[SETTINGS_KEY] || {}) };
  s.showWinProbability = checkbox.checked;
  await chrome.storage.sync.set({ [SETTINGS_KEY]: s });
});
