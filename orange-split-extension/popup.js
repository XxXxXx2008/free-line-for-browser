(function () {
  "use strict";

  const form = document.querySelector("#splitForm");
  const pageAInput = document.querySelector("#pageA");
  const pageBInput = document.querySelector("#pageB");
  const swapButton = document.querySelector("#swapButton");
  const currentSiteButtons = Array.from(
    document.querySelectorAll(".current-site-button"),
  );
  const message = document.querySelector("#formMessage");
  const slotList = document.querySelector("#slotList");
  const storageKey = "orangeSplit.settings";
  const slotsStorageKey = "orangeSplit.slots";
  const localDraftStorageKey = "orangeSplit.popupDraft.v1";
  const localSlotsStorageKey = "orangeSplit.popupSlots.v1";
  const slotCount = 4;
  const extensionApi = globalThis.chrome;
  let slots = Array.from({ length: slotCount }, () => null);

  function normalizeUrl(value) {
    const trimmed = value.trim();
    if (!trimmed) {
      return "";
    }

    const withProtocol = /^[a-z][a-z\d+.-]*:/i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;

    let parsed;
    try {
      parsed = new URL(withProtocol);
    } catch {
      throw new Error("请输入有效的 http 或 https 地址。");
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("只允许打开 http 或 https 网页。");
    }

    return parsed.href;
  }

  function setMessage(text) {
    message.textContent = text;
  }

  function currentSettings() {
    return {
      pageA: pageAInput.value,
      pageB: pageBInput.value,
      updatedAt: Date.now(),
    };
  }

  function readLocalValue(key) {
    try {
      const value = window.localStorage.getItem(key);
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  }

  function writeLocalValue(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // chrome.storage.local remains the primary persistence layer.
    }
  }

  function compactUrl(value) {
    const trimmed = String(value || "").trim();
    if (!trimmed) {
      return "空";
    }
    return trimmed
      .replace(/^https?:\/\//i, "")
      .replace(/\/$/, "")
      .slice(0, 34);
  }

  function renderSlots() {
    slotList.replaceChildren();

    slots.forEach((slot, index) => {
      const row = document.createElement("div");
      row.className = "slot-row";

      const summary = document.createElement("div");
      summary.className = "slot-summary";
      const title = document.createElement("strong");
      title.textContent = `槽位 ${index + 1}`;
      const urls = document.createElement("span");
      urls.textContent = slot
        ? `${compactUrl(slot.pageA)} / ${compactUrl(slot.pageB)}`
        : "尚未保存";
      summary.append(title, urls);

      const loadButton = document.createElement("button");
      loadButton.type = "button";
      loadButton.className = "slot-action";
      loadButton.textContent = "载入";
      loadButton.disabled = !slot;
      loadButton.addEventListener("click", () => {
        if (!slot) {
          return;
        }
        pageAInput.value = slot.pageA || "";
        pageBInput.value = slot.pageB || "";
        persistDraft();
        setMessage(`已载入槽位 ${index + 1}。`);
      });

      const saveButton = document.createElement("button");
      saveButton.type = "button";
      saveButton.className = "slot-action";
      saveButton.textContent = "保存";
      saveButton.addEventListener("click", () => saveSlot(index));

      row.append(summary, loadButton, saveButton);
      slotList.append(row);
    });
  }

  async function persistSlots() {
    writeLocalValue(localSlotsStorageKey, slots);
    if (!extensionApi?.storage?.local) {
      return;
    }

    try {
      await extensionApi.storage.local.set({ [slotsStorageKey]: slots });
    } catch {
      setMessage("常用网址槽位保存失败。");
    }
  }

  function saveSlot(index) {
    try {
      const pageA = normalizeUrl(pageAInput.value);
      const pageB = normalizeUrl(pageBInput.value);
      if (!pageA && !pageB) {
        setMessage("请先填写至少一个网址，再保存到槽位。");
        return;
      }

      slots[index] = { pageA, pageB };
      pageAInput.value = pageA;
      pageBInput.value = pageB;
      persistDraft();
      persistSlots();
      renderSlots();
      setMessage(`当前网址组合已保存到槽位 ${index + 1}。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法保存槽位。");
    }
  }

  function persistDraft() {
    const settings = currentSettings();
    writeLocalValue(localDraftStorageKey, settings);
    if (!extensionApi?.storage?.local) {
      return;
    }

    extensionApi.storage.local
      .set({ [storageKey]: settings })
      .catch(() => {
        setMessage("网址暂时无法自动保存。");
      });
  }

  async function restoreSettings() {
    if (!extensionApi?.storage?.local) {
      const localDraft = readLocalValue(localDraftStorageKey);
      if (localDraft) {
        pageAInput.value = localDraft.pageA || "";
        pageBInput.value = localDraft.pageB || "";
      }
      const localSlots = readLocalValue(localSlotsStorageKey);
      if (Array.isArray(localSlots)) {
        slots = Array.from({ length: slotCount }, (_, index) => {
          const slot = localSlots[index];
          if (!slot || typeof slot !== "object") {
            return null;
          }
          return {
            pageA: String(slot.pageA || ""),
            pageB: String(slot.pageB || ""),
          };
        });
      }
      renderSlots();
      return;
    }

    try {
      const result = await extensionApi.storage.local.get([
        storageKey,
        slotsStorageKey,
      ]);
      const localDraft = readLocalValue(localDraftStorageKey);
      const storedSettings = result[storageKey];
      const settings =
        Number(localDraft?.updatedAt || 0) >=
        Number(storedSettings?.updatedAt || 0)
          ? localDraft
          : storedSettings;
      if (settings) {
        pageAInput.value = settings.pageA || "";
        pageBInput.value = settings.pageB || "";
      }

      const localSlots = readLocalValue(localSlotsStorageKey);
      const availableSlots = Array.isArray(localSlots)
        ? localSlots
        : result[slotsStorageKey];
      if (Array.isArray(availableSlots)) {
        slots = Array.from({ length: slotCount }, (_, index) => {
          const slot = availableSlots[index];
          if (!slot || typeof slot !== "object") {
            return null;
          }
          return {
            pageA: String(slot.pageA || ""),
            pageB: String(slot.pageB || ""),
          };
        });
      }
      renderSlots();
    } catch {
      setMessage("暂时无法读取上次的网页地址。");
      renderSlots();
    }
  }

  async function saveSettings(settings) {
    writeLocalValue(localDraftStorageKey, settings);
    if (!extensionApi?.storage?.local) {
      return;
    }

    try {
      await extensionApi.storage.local.set({ [storageKey]: settings });
    } catch {
      // The split view still works when extension storage is unavailable.
    }
  }

  function openSplit(pageA, pageB) {
    const splitUrl = extensionApi?.runtime?.getURL
      ? extensionApi.runtime.getURL("split.html")
      : new URL("split.html", window.location.href).href;
    const target = new URL(splitUrl);
    if (pageA) {
      target.searchParams.set("a", pageA);
    }
    if (pageB) {
      target.searchParams.set("b", pageB);
    }

    try {
      extensionApi.tabs.create({ url: target.href });
    } catch {
      window.open(target.href, "_blank", "noopener");
    }
  }

  async function fillCurrentSite(button) {
    const target = document.getElementById(button.dataset.target);
    if (!target) {
      return;
    }
    if (!extensionApi?.tabs?.query) {
      setMessage("当前浏览器不支持读取活动标签页。");
      return;
    }

    setMessage("正在读取当前网站…");
    try {
      const tabs = await extensionApi.tabs.query({
        active: true,
        currentWindow: true,
      });
      const rawUrl = tabs[0]?.url || tabs[0]?.pendingUrl || "";
      if (!/^https?:\/\//i.test(rawUrl)) {
        throw new Error(
          "当前标签页不是普通网站，请先切换到需要分屏的网页。",
        );
      }

      target.value = normalizeUrl(rawUrl);
      persistDraft();
      setMessage("已填入当前网站地址。");
      target.focus();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "无法读取当前网站地址。",
      );
    }
  }

  swapButton.addEventListener("click", function () {
    const previousA = pageAInput.value;
    pageAInput.value = pageBInput.value;
    pageBInput.value = previousA;
    persistDraft();
    setMessage("");
    pageAInput.focus();
  });

  for (const button of currentSiteButtons) {
    button.addEventListener("click", () => fillCurrentSite(button));
  }

  pageAInput.addEventListener("input", persistDraft);
  pageBInput.addEventListener("input", persistDraft);
  window.addEventListener("pagehide", persistDraft);

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    setMessage("");

    try {
      const pageA = normalizeUrl(pageAInput.value);
      const pageB = normalizeUrl(pageBInput.value);
      const settings = { pageA, pageB, updatedAt: Date.now() };
      await saveSettings(settings);
      openSplit(pageA, pageB);
      window.close();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法打开分屏。");
    }
  });

  restoreSettings();
  renderSlots();
})();
