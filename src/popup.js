const openPanelButton = document.getElementById("openPanel");
const openOptionsButton = document.getElementById("openOptions");
const statusEl = document.getElementById("status");

openPanelButton.addEventListener("click", async () => {
  statusEl.textContent = "";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error("没有找到当前标签页。");
    }

    await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_PANEL" });
    window.close();
  } catch (error) {
    statusEl.textContent = "当前页面无法打开助手，请刷新网页后再试。";
  }
});

openOptionsButton.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

