import { spawn, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceDirectory = path.resolve(scriptDirectory, "..");
const edgePath =
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const port = 9333;
const profileDirectory = path.join(
  workspaceDirectory,
  "artifacts",
  "edge-popup-test-profile",
);
const pageUrl = "http://127.0.0.1:8123/popup.html";

const edge = spawn(
  edgePath,
  [
    "--headless",
    "--disable-gpu",
    "--no-sandbox",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDirectory}`,
    pageUrl,
  ],
  { stdio: "ignore" },
);

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function findPageTarget() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const target = targets.find(
        (candidate) =>
          candidate.type === "page" && candidate.url.startsWith(pageUrl),
      );
      if (target) {
        return target;
      }
    } catch {
      // Browser debugging endpoint is still starting.
    }
    await delay(100);
  }
  throw new Error("Could not find the popup page in Edge.");
}

function connect(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  let nextId = 1;

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) {
      return;
    }
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) {
      reject(new Error(message.error.message));
    } else {
      resolve(message.result);
    }
  });

  const ready = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  function send(method, params = {}) {
    const id = nextId;
    nextId += 1;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  return { socket, ready, send };
}

let client;
try {
  const target = await findPageTarget();
  client = connect(target.webSocketDebuggerUrl);
  await client.ready;
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  await delay(300);

  await client.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      const api = globalThis.chrome && typeof globalThis.chrome === "object"
        ? globalThis.chrome
        : {};
      api.tabs = {
        query: async () => [{ url: "https://example.org/current-tab" }],
      };
      try {
        globalThis.chrome = api;
      } catch {
        // The existing chrome object is used when direct replacement fails.
      }
    })();`,
  });
  await client.send("Page.reload");
  await delay(500);

  await client.send("Runtime.evaluate", {
    expression: `document.querySelectorAll(".current-site-button")[0].click()`,
  });
  await delay(100);
  const currentSiteValue = await client.send("Runtime.evaluate", {
    expression: `(() => ({
      value: document.querySelector("#pageA").value,
      chromeType: typeof globalThis.chrome,
      tabsType: typeof globalThis.chrome?.tabs,
      queryType: typeof globalThis.chrome?.tabs?.query,
      message: document.querySelector("#formMessage").textContent,
    }))()`,
    returnByValue: true,
  });
  if (!currentSiteValue.result?.value) {
    throw new Error(
      `Current website evaluation failed: ${JSON.stringify(currentSiteValue)}`,
    );
  }
  if (currentSiteValue.result.value.value !== "https://example.org/current-tab") {
    throw new Error(
      `Current website fill failed: ${JSON.stringify(
        currentSiteValue.result.value,
      )}`,
    );
  }
  const currentSiteShot = await client.send("Page.captureScreenshot", {
    format: "png",
  });
  writeFileSync(
    path.join(workspaceDirectory, "artifacts", "popup-current-site.png"),
    Buffer.from(currentSiteShot.data, "base64"),
  );

  const setup = await client.send("Runtime.evaluate", {
    expression: `(() => {
      const setValue = (selector, value) => {
        const input = document.querySelector(selector);
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      };
      setValue("#pageA", "example.com");
      setValue("#pageB", "w3.org");
      document
        .querySelectorAll(".slot-row")[0]
        .querySelectorAll("button")[1]
        .click();
      return true;
    })()`,
    returnByValue: true,
  });
  if (setup.exceptionDetails) {
    throw new Error(setup.exceptionDetails.text);
  }

  await client.send("Page.reload");
  await delay(500);

  const result = await client.send("Runtime.evaluate", {
    expression: `(() => ({
      pageA: document.querySelector("#pageA").value,
      pageB: document.querySelector("#pageB").value,
      slotSummary: document
        .querySelectorAll(".slot-row")[0]
        .querySelector(".slot-summary span").textContent,
    }))()`,
    returnByValue: true,
  });
  const values = result.result.value;
  if (
    values.pageA !== "https://example.com/" ||
    values.pageB !== "https://w3.org/" ||
    !values.slotSummary.includes("example.com")
  ) {
    throw new Error(`Persisted values did not survive reload: ${JSON.stringify(values)}`);
  }

  console.log(
    `Popup persistence test passed: ${values.pageA} | ${values.pageB}`,
  );

  await client.send("Page.navigate", {
    url: "http://127.0.0.1:8123/split.html?mode=center&angle=12",
  });
  await delay(500);

  const centerInitial = await client.send("Runtime.evaluate", {
    expression: `(() => ({
      rotateHidden: document.querySelector("#rotateHandle").hidden,
      endpointDisplay: getComputedStyle(
        document.querySelector("#leftHandle"),
      ).display,
    }))()`,
    returnByValue: true,
  });
  if (
    centerInitial.result.value.rotateHidden !== true ||
    centerInitial.result.value.endpointDisplay !== "none"
  ) {
    throw new Error(
      `Center mode initial state is incorrect: ${JSON.stringify(
        centerInitial.result.value,
      )}`,
    );
  }

  await client.send("Runtime.evaluate", {
    expression: `document
      .querySelector("#dragGrip")
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      )`,
  });
  await delay(100);
  const revealed = await client.send("Runtime.evaluate", {
    expression: `!document.querySelector("#rotateHandle").hidden`,
    returnByValue: true,
  });
  if (revealed.result.value !== true) {
    throw new Error("Center rotation control did not appear.");
  }

  await delay(5200);
  const hiddenAgain = await client.send("Runtime.evaluate", {
    expression: `document.querySelector("#rotateHandle").hidden`,
    returnByValue: true,
  });
  if (hiddenAgain.result.value !== true) {
    throw new Error("Center rotation control did not hide after five seconds.");
  }

  await client.send("Page.navigate", {
    url: "http://127.0.0.1:8123/split.html?mode=two-point&angle=24",
  });
  await delay(500);
  const twoPointState = await client.send("Runtime.evaluate", {
    expression: `(() => ({
      rotateHidden: document.querySelector("#rotateHandle").hidden,
      leftDisplay: getComputedStyle(
        document.querySelector("#leftHandle"),
      ).display,
      rightDisplay: getComputedStyle(
        document.querySelector("#rightHandle"),
      ).display,
    }))()`,
    returnByValue: true,
  });
  if (
    twoPointState.result.value.rotateHidden !== true ||
    twoPointState.result.value.leftDisplay === "none" ||
    twoPointState.result.value.rightDisplay === "none"
  ) {
    throw new Error(
      `Two-point mode is incorrect: ${JSON.stringify(
        twoPointState.result.value,
      )}`,
    );
  }

  console.log(
    "Rotation controls passed: two endpoints visible by default; center button expires after 5 seconds.",
  );

  await client.send("Page.navigate", {
    url: "http://127.0.0.1:8123/split.html?mode=two-point&angle=24&panel=1",
  });
  await delay(500);
  await client.send("Runtime.evaluate", {
    expression: `document.querySelector(".appearance-settings")
        .scrollIntoView({ block: "center" });
      document.querySelector("#colorPickerToggle").click();
      document.querySelectorAll(".color-swatch")[5].click();`,
  });
  await delay(100);

  const colorState = await client.send("Runtime.evaluate", {
    expression: `(() => {
      const railStyle = getComputedStyle(document.querySelector(".drag-rail"));
      return {
        color: getComputedStyle(document.documentElement)
          .getPropertyValue("--divider-color")
          .trim(),
        backgroundColor: railStyle.backgroundColor,
        popoverOpen: !document.querySelector("#colorPopover").hidden,
      };
    })()`,
    returnByValue: true,
  });
  if (
    colorState.result.value.color !== "#3978e6" ||
    colorState.result.value.backgroundColor !== "rgb(57, 120, 230)" ||
    colorState.result.value.popoverOpen !== true
  ) {
    throw new Error(
      `Color picker is incorrect: ${JSON.stringify(colorState.result.value)}`,
    );
  }

  const colorShot = await client.send("Page.captureScreenshot", {
    format: "png",
  });
  writeFileSync(
    path.join(workspaceDirectory, "artifacts", "appearance-color.png"),
    Buffer.from(colorShot.data, "base64"),
  );

  await client.send("Runtime.evaluate", {
    expression: `document.querySelector("#thicknessToggle").click();
      const range = document.querySelector("#thicknessRange");
      range.value = "16";
      range.dispatchEvent(new Event("input", { bubbles: true }));
      range.dispatchEvent(new Event("change", { bubbles: true }));`,
  });
  await delay(100);
  const thicknessState = await client.send("Runtime.evaluate", {
    expression: `(() => ({
      railHeight: getComputedStyle(document.querySelector(".drag-rail")).height,
      colorHidden: document.querySelector("#colorPopover").hidden,
      thicknessOpen: !document.querySelector("#thicknessPopover").hidden,
      value: document.querySelector("#thicknessOutput").textContent,
    }))()`,
    returnByValue: true,
  });
  if (
    thicknessState.result.value.railHeight !== "16px" ||
    thicknessState.result.value.colorHidden !== true ||
    thicknessState.result.value.thicknessOpen !== true ||
    thicknessState.result.value.value !== "16 px"
  ) {
    throw new Error(
      `Thickness control is incorrect: ${JSON.stringify(
        thicknessState.result.value,
      )}`,
    );
  }

  const thicknessShot = await client.send("Page.captureScreenshot", {
    format: "png",
  });
  writeFileSync(
    path.join(workspaceDirectory, "artifacts", "appearance-thickness.png"),
    Buffer.from(thicknessShot.data, "base64"),
  );

  await client.send("Runtime.evaluate", {
    expression: `document.querySelector("#backColorToggle").click();
      document.querySelectorAll(".nav-color-swatch")[2].click();
      document.querySelector("#forwardColorToggle").click();
      document.querySelectorAll(".nav-color-swatch")[5].click();`,
  });
  await delay(100);
  const navColorState = await client.send("Runtime.evaluate", {
    expression: `(() => ({
      backColor: getComputedStyle(document.documentElement)
        .getPropertyValue("--nav-back-color")
        .trim(),
      forwardColor: getComputedStyle(document.documentElement)
        .getPropertyValue("--nav-forward-color")
        .trim(),
      popoverOpen: !document.querySelector("#navColorPopover").hidden,
      kicker: document.querySelector(".panel-kicker").textContent.trim(),
      title: document.querySelector(".panel-header h1").textContent.trim(),
    }))()`,
    returnByValue: true,
  });
  if (
    navColorState.result.value.backColor !== "#ff761a" ||
    navColorState.result.value.forwardColor !== "#39a96b" ||
    navColorState.result.value.popoverOpen !== true ||
    navColorState.result.value.kicker !== "这里是设置喵" ||
    navColorState.result.value.title !== "选择两个网页"
  ) {
    throw new Error(
      `Navigation colors or settings titles are incorrect: ${JSON.stringify(
        navColorState.result.value,
      )}`,
    );
  }

  const navColorShot = await client.send("Page.captureScreenshot", {
    format: "png",
  });
  writeFileSync(
    path.join(workspaceDirectory, "artifacts", "navigation-colors.png"),
    Buffer.from(navColorShot.data, "base64"),
  );

  console.log(
    "Appearance controls passed: divider and navigation colors plus thickness apply live.",
  );

  await client.send("Runtime.evaluate", {
    expression: `(() => {
      class FakeTrack {
        constructor(kind) {
          this.kind = kind;
          this.enabled = true;
          this.listeners = new Map();
        }
        addEventListener(type, listener) {
          this.listeners.set(type, listener);
        }
        stop() {
          this.enabled = false;
        }
      }
      class FakeStream {
        constructor(tracks) {
          this.tracks = tracks;
        }
        getAudioTracks() {
          return this.tracks.filter((track) => track.kind === "audio");
        }
        getVideoTracks() {
          return this.tracks.filter((track) => track.kind === "video");
        }
        getTracks() {
          return this.tracks.slice();
        }
      }
      class FakeAnalyser {
        constructor() {
          this.frequencyBinCount = 128;
          this.fftSize = 512;
          this.smoothingTimeConstant = 0;
        }
        connect() {}
        disconnect() {}
        getByteFrequencyData(data) {
          const now = performance.now();
          for (let index = 0; index < data.length; index += 1) {
            data[index] =
              20 + Math.abs(Math.sin(index * 0.37 + now * 0.006)) * 110;
          }
        }
      }
      class FakeAudioContext {
        constructor() {
          this.state = "running";
        }
        resume() {
          return Promise.resolve();
        }
        createMediaStreamSource() {
          return { connect() {}, disconnect() {} };
        }
        createAnalyser() {
          return new FakeAnalyser();
        }
        close() {
          this.state = "closed";
          return Promise.resolve();
        }
      }
      window.MediaStream = FakeStream;
      window.AudioContext = FakeAudioContext;
      Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
        configurable: true,
        value: async () =>
          new FakeStream([new FakeTrack("audio"), new FakeTrack("video")]),
      });
      document.querySelector("#audioToggle")
        .scrollIntoView({ block: "center" });
      document.querySelector("#audioToggle").click();
      return true;
    })()`,
    returnByValue: true,
  });
  await delay(350);

  const audioState = await client.send("Runtime.evaluate", {
    expression: `(() => ({
      active: document.body.classList.contains("audio-reactive"),
      pressed: document.querySelector("#audioToggle")
        .getAttribute("aria-pressed"),
      status: document.querySelector("#audioStatus").textContent,
      bars: document.querySelectorAll(".audio-bar").length,
      span: (() => {
        const positions = Array.from(document.querySelectorAll(".audio-pair"))
          .map((pair) => Number.parseFloat(pair.style.left));
        return Math.max(...positions) - Math.min(...positions);
      })(),
      scales: Array.from(document.querySelectorAll(".audio-bar"))
        .slice(0, 5)
        .map((bar) => bar.style.transform),
    }))()`,
    returnByValue: true,
  });
  const audioValues = audioState.result.value;
  if (
    audioValues.active !== true ||
    audioValues.pressed !== "true" ||
    !audioValues.status.includes("正在响应") ||
    audioValues.bars !== 40 ||
    audioValues.span !== 294 ||
    new Set(audioValues.scales).size < 2
  ) {
    throw new Error(
      `Audio response is incorrect: ${JSON.stringify(audioValues)}`,
    );
  }

  const audioSettingsShot = await client.send("Page.captureScreenshot", {
    format: "png",
  });
  writeFileSync(
    path.join(workspaceDirectory, "artifacts", "audio-settings.png"),
    Buffer.from(audioSettingsShot.data, "base64"),
  );

  await client.send("Runtime.evaluate", {
    expression: `document.querySelector("#panelClose").click()`,
  });
  await delay(200);
  const audioWaveShot = await client.send("Page.captureScreenshot", {
    format: "png",
  });
  writeFileSync(
    path.join(workspaceDirectory, "artifacts", "audio-response.png"),
    Buffer.from(audioWaveShot.data, "base64"),
  );

  await client.send("Runtime.evaluate", {
    expression: `document.querySelector("#panelToggle").click();
      document.querySelector("#audioToggle").click();`,
  });
  await delay(100);
  const stoppedAudio = await client.send("Runtime.evaluate", {
    expression: `(() => ({
      active: document.body.classList.contains("audio-reactive"),
      pressed: document.querySelector("#audioToggle")
        .getAttribute("aria-pressed"),
    }))()`,
    returnByValue: true,
  });
  if (
    stoppedAudio.result.value.active !== false ||
    stoppedAudio.result.value.pressed !== "false"
  ) {
    throw new Error("Audio response did not stop cleanly.");
  }

  console.log(
    "Audio response passed: 40 mirrored bars respond to synthetic system audio and stop cleanly.",
  );

  await client.send("Page.navigate", {
    url: "http://127.0.0.1:8123/split.html?mode=two-point&angle=18&x=1",
  });
  await delay(500);

  const navigationLayout = await client.send("Runtime.evaluate", {
    expression: `(() => {
      const left = document.querySelector("#leftHandle").getBoundingClientRect();
      const right = document.querySelector("#rightHandle").getBoundingClientRect();
      return {
        buttons: document.querySelectorAll(".nav-button").length,
        clusters: document.querySelectorAll(".nav-cluster").length,
        rotorTransform: getComputedStyle(
          document.querySelector("#dividerRotor"),
        ).transform,
        paneAMaskTransform: getComputedStyle(
          document.querySelector("#clipA"),
        ).transform,
        paneAInverseTransform: getComputedStyle(
          document.querySelector("#paneA"),
        ).transform,
        paneAClipPath: getComputedStyle(
          document.querySelector("#clipA"),
        ).clipPath,
        paneAMaskWidth: Number.parseFloat(
          document.querySelector("#maskA").style.width,
        ),
        handlesInViewport: left.left >= 0 && right.right <= innerWidth,
        backBackground: getComputedStyle(
          document.querySelector(
            '#navPositive [data-command="back"]',
          ),
        ).backgroundColor,
        backColor: getComputedStyle(
          document.querySelector(
            '#navPositive [data-command="back"]',
          ),
        ).color,
        forwardBackground: getComputedStyle(
          document.querySelector(
            '#navPositive [data-command="forward"]',
          ),
        ).backgroundColor,
        forwardColor: getComputedStyle(
          document.querySelector(
            '#navPositive [data-command="forward"]',
          ),
        ).color,
      };
    })()`,
    returnByValue: true,
  });
  if (
    navigationLayout.result.value.buttons !== 6 ||
    navigationLayout.result.value.clusters !== 2 ||
    navigationLayout.result.value.rotorTransform === "none" ||
    navigationLayout.result.value.paneAMaskTransform === "none" ||
    navigationLayout.result.value.paneAInverseTransform === "none" ||
    navigationLayout.result.value.paneAClipPath !== "none" ||
    !(navigationLayout.result.value.paneAMaskWidth > 0) ||
    navigationLayout.result.value.handlesInViewport !== true ||
    navigationLayout.result.value.backBackground !== "rgb(128, 240, 255)" ||
    navigationLayout.result.value.backColor !== "rgb(23, 104, 117)" ||
    navigationLayout.result.value.forwardBackground !== "rgb(255, 168, 243)" ||
    navigationLayout.result.value.forwardColor !== "rgb(157, 60, 140)"
  ) {
    throw new Error(
      `Navigation layout is incorrect: ${JSON.stringify(
        navigationLayout.result.value,
      )}`,
    );
  }

  await client.send("Runtime.evaluate", {
    expression: `document.querySelector("#paneA").contentWindow.location.href =
      "demo-b.html"`,
  });
  await delay(350);
  const paneAAfterNavigate = await client.send("Runtime.evaluate", {
    expression: `document.querySelector("#paneA").contentWindow.document.title`,
    returnByValue: true,
  });
  if (!paneAAfterNavigate.result.value.includes("网页 B")) {
    throw new Error("Pane A did not navigate independently.");
  }

  await client.send("Runtime.evaluate", {
    expression: `document
      .querySelector('#navPositive [data-command="back"]')
      .click()`,
  });
  await delay(350);
  const paneAAfterBack = await client.send("Runtime.evaluate", {
    expression: `document.querySelector("#paneA").contentWindow.document.title`,
    returnByValue: true,
  });
  if (!paneAAfterBack.result.value.includes("网页 A")) {
    throw new Error("Positive-side back button did not control pane A.");
  }

  await client.send("Runtime.evaluate", {
    expression: `document.querySelector("#paneB").contentWindow.location.href =
      "demo-a.html"`,
  });
  await delay(350);
  await client.send("Runtime.evaluate", {
    expression: `document
      .querySelector('#navNegative [data-command="back"]')
      .click()`,
  });
  await delay(350);
  const paneBAfterBack = await client.send("Runtime.evaluate", {
    expression: `document.querySelector("#paneB").contentWindow.document.title`,
    returnByValue: true,
  });
  if (!paneBAfterBack.result.value.includes("网页 B")) {
    throw new Error("Negative-side back button did not control pane B.");
  }

  await client.send("Runtime.evaluate", {
    expression: `document.querySelector("#paneA").contentWindow.__navigationTest = 1;
      document
        .querySelector('#navPositive [data-command="reload"]')
        .click()`,
  });
  await delay(350);
  const paneAReloaded = await client.send("Runtime.evaluate", {
    expression: `document.querySelector("#paneA").contentWindow.__navigationTest === undefined`,
    returnByValue: true,
  });
  if (paneAReloaded.result.value !== true) {
    throw new Error("Positive-side reload button did not reload pane A.");
  }

  const navigationShot = await client.send("Page.captureScreenshot", {
    format: "png",
  });
  writeFileSync(
    path.join(workspaceDirectory, "artifacts", "navigation-controls.png"),
    Buffer.from(navigationShot.data, "base64"),
  );

  console.log(
    "Navigation controls passed: both mirrored clusters control their own pane independently.",
  );

  await client.send("Runtime.evaluate", {
    expression: `(() => {
      const token = document.documentElement.dataset.navigationToken;
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            channel: "orange-split-navigation-v1",
            type: "media-state",
            token,
            playing: true,
          },
          source: document.querySelector("#paneA").contentWindow,
          origin: location.origin,
        }),
      );
    })()`,
  });
  await delay(100);
  const safeMode = await client.send("Runtime.evaluate", {
    expression: `(() => ({
      active: document.body.classList.contains("video-safe-mode"),
      dividerTransform: getComputedStyle(
        document.querySelector("#dividerRotor"),
      ).transform,
      maskTransform: getComputedStyle(
        document.querySelector("#clipA"),
      ).transform,
      frameTransform: getComputedStyle(
        document.querySelector("#paneA"),
      ).transform,
      badgeVisible: !document.querySelector("#videoModeBadge").hidden,
    }))()`,
    returnByValue: true,
  });
  const safeValues = safeMode.result.value;
  if (
    safeValues.active !== true ||
    safeValues.dividerTransform === "none" ||
    safeValues.maskTransform !== "none" ||
    safeValues.frameTransform !== "none" ||
    safeValues.badgeVisible !== true
  ) {
    throw new Error(
      `Video safe mode is incorrect: ${JSON.stringify(safeValues)}`,
    );
  }

  const safeModeShot = await client.send("Page.captureScreenshot", {
    format: "png",
  });
  writeFileSync(
    path.join(workspaceDirectory, "artifacts", "video-safe-mode.png"),
    Buffer.from(safeModeShot.data, "base64"),
  );

  await client.send("Runtime.evaluate", {
    expression: `(() => {
      const token = document.documentElement.dataset.navigationToken;
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            channel: "orange-split-navigation-v1",
            type: "media-state",
            token,
            playing: false,
          },
          source: document.querySelector("#paneA").contentWindow,
          origin: location.origin,
        }),
      );
    })()`,
  });
  await delay(1100);
  const restoredMode = await client.send("Runtime.evaluate", {
    expression: `!document.body.classList.contains("video-safe-mode")`,
    returnByValue: true,
  });
  if (restoredMode.result.value !== true) {
    throw new Error("Free-angle mode did not resume after video stopped.");
  }

  console.log(
    "Video-safe mode passed: rectangular rendering activates during playback and restores free-angle mode after pause.",
  );
} finally {
  if (client) {
    client.socket.close();
  }
  spawnSync("taskkill", ["/PID", String(edge.pid), "/T", "/F"], {
    stdio: "ignore",
  });
}
