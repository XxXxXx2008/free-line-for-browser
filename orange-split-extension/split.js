import {
  normalizeAngle,
  rotateLineAroundPivot,
} from "./geometry.mjs";

const splitStage = document.querySelector("#splitStage");
const paneA = document.querySelector("#paneA");
const paneB = document.querySelector("#paneB");
const paneAClipContainer = document.querySelector("#clipA");
const paneBClipContainer = document.querySelector("#clipB");
const paneAMaskBody = document.querySelector("#maskA");
const paneBMaskBody = document.querySelector("#maskB");
const divider = document.querySelector("#divider");
const dividerRotor = document.querySelector("#dividerRotor");
const dragRail = document.querySelector("#dragRail");
const dragGrip = document.querySelector("#dragGrip");
const leftHandle = document.querySelector("#leftHandle");
const rightHandle = document.querySelector("#rightHandle");
const rotateHandle = document.querySelector("#rotateHandle");
const angleBadge = document.querySelector("#angleBadge");
const gestureHint = document.querySelector("#gestureHint");
const gestureAction = document.querySelector("#gestureAction");
const panelToggle = document.querySelector("#panelToggle");
const panelClose = document.querySelector("#panelClose");
const controlPanel = document.querySelector("#controlPanel");
const addressForm = document.querySelector("#addressForm");
const addressA = document.querySelector("#addressA");
const addressB = document.querySelector("#addressB");
const addressMessage = document.querySelector("#addressMessage");
const swapPanesButton = document.querySelector("#swapPanes");
const resetDividerButton = document.querySelector("#resetDivider");
const openPaneAButton = document.querySelector("#openPaneA");
const openPaneBButton = document.querySelector("#openPaneB");
const rotationTwoPoint = document.querySelector("#rotationTwoPoint");
const rotationCenter = document.querySelector("#rotationCenter");
const colorPickerToggle = document.querySelector("#colorPickerToggle");
const thicknessToggle = document.querySelector("#thicknessToggle");
const colorPopover = document.querySelector("#colorPopover");
const thicknessPopover = document.querySelector("#thicknessPopover");
const currentColorSwatch = document.querySelector("#currentColorSwatch");
const colorValue = document.querySelector("#colorValue");
const customColor = document.querySelector("#customColor");
const colorSwatches = Array.from(document.querySelectorAll(".color-swatch"));
const backColorToggle = document.querySelector("#backColorToggle");
const forwardColorToggle = document.querySelector("#forwardColorToggle");
const navColorPopover = document.querySelector("#navColorPopover");
const navColorTitle = document.querySelector("#navColorTitle");
const navCustomColor = document.querySelector("#navCustomColor");
const navColorSwatches = Array.from(
  document.querySelectorAll(".nav-color-swatch"),
);
const backButtonSwatch = document.querySelector("#backButtonSwatch");
const forwardButtonSwatch = document.querySelector("#forwardButtonSwatch");
const backButtonColorValue = document.querySelector("#backButtonColorValue");
const forwardButtonColorValue = document.querySelector(
  "#forwardButtonColorValue",
);
const thicknessRange = document.querySelector("#thicknessRange");
const thicknessValue = document.querySelector("#thicknessValue");
const thicknessOutput = document.querySelector("#thicknessOutput");
const audioToggle = document.querySelector("#audioToggle");
const audioStatus = document.querySelector("#audioStatus");
const audioBars = document.querySelector("#audioBars");
const navPositive = document.querySelector("#navPositive");
const navNegative = document.querySelector("#navNegative");
const videoModeBadge = document.querySelector("#videoModeBadge");
const edgeLabelA = document.querySelector(".edge-label-a");
const edgeLabelB = document.querySelector(".edge-label-b");

const geometryStorageKey = "orangeSplit.state";
const settingsStorageKey = "orangeSplit.settings";
const extensionApi = globalThis.chrome;
const navigationChannel = "orange-split-navigation-v1";
const navigationToken =
  globalThis.crypto?.randomUUID?.() ||
  `orange-split-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function resolveLocalUrl(path) {
  try {
    return extensionApi.runtime.getURL(path);
  } catch {
    return new URL(path, window.location.href).href;
  }
}

const demoAUrl = resolveLocalUrl("demo-a.html");
const demoBUrl = resolveLocalUrl("demo-b.html");

const state = {
  x: 0.5,
  y: 0.5,
  angle: 0,
  swapped: false,
  rotationMode: "two-point",
  spanRatio: 0.18,
  dividerColor: "#ff761a",
  dividerThickness: 6,
  backButtonColor: "#80f0ff",
  forwardButtonColor: "#ffa8f3",
};

const pages = {
  a: demoAUrl,
  b: demoBUrl,
  displayA: "",
  displayB: "",
};

let dragState = null;
let geometryFrame = 0;
let hintTimer = 0;
let rotateControlTimer = 0;
let audioAnimationFrame = 0;
let audioDisplayStream = null;
let audioContext = null;
let audioSource = null;
let audioAnalyser = null;
let audioFrequencyData = null;
let audioTrack = null;
let audioActive = false;
let audioToggleBusy = false;
let activeVideoTrack = null;
let videoSafeMode = false;
let videoSafeExitTimer = 0;
let activeNavColorTarget = "back";
const videoPlayingFrames = new Set();

const audioLevelCount = 10;
const audioBarOffsets = Array.from(
  { length: audioLevelCount },
  (_, index) => Math.round(26 + (index * (147 - 26)) / (audioLevelCount - 1)),
);
const audioPairsByLevel = Array.from(
  { length: audioLevelCount },
  () => [],
);
const frameBridgeReadyFrames = new Set();

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function normalizeUrl(value, fallback) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return { url: fallback, display: "" };
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
    throw new Error("只允许加载 http 或 https 网页。");
  }

  return { url: parsed.href, display: parsed.href };
}

function restoreState(value) {
  if (!value || typeof value !== "object") {
    return;
  }

  if (Number.isFinite(value.x)) {
    state.x = clamp(value.x, 0, 1);
  }
  if (Number.isFinite(value.y)) {
    state.y = clamp(value.y, 0, 1);
  }
  if (Number.isFinite(value.angle)) {
    state.angle = normalizeAngle(value.angle);
  }
  if (value.rotationMode === "center" || value.rotationMode === "two-point") {
    state.rotationMode = value.rotationMode;
  }
  if (Number.isFinite(value.spanRatio)) {
    state.spanRatio = clamp(value.spanRatio, 0.06, 0.46);
  }
  if (
    typeof value.dividerColor === "string" &&
    /^#[0-9a-f]{6}$/i.test(value.dividerColor)
  ) {
    state.dividerColor = value.dividerColor.toLowerCase();
  }
  if (Number.isFinite(value.dividerThickness)) {
    state.dividerThickness = clamp(
      Math.round(value.dividerThickness),
      2,
      20,
    );
  }
  if (
    typeof value.backButtonColor === "string" &&
    /^#[0-9a-f]{6}$/i.test(value.backButtonColor)
  ) {
    state.backButtonColor = value.backButtonColor.toLowerCase();
  }
  if (
    typeof value.forwardButtonColor === "string" &&
    /^#[0-9a-f]{6}$/i.test(value.forwardButtonColor)
  ) {
    state.forwardButtonColor = value.forwardButtonColor.toLowerCase();
  }
  state.swapped = Boolean(value.swapped);
}

async function readStoredValues() {
  try {
    return await extensionApi.storage.local.get([
      geometryStorageKey,
      settingsStorageKey,
    ]);
  } catch {
    return {};
  }
}

async function persistGeometry() {
  try {
    await extensionApi.storage.local.set({
      [geometryStorageKey]: {
        x: state.x,
        y: state.y,
        angle: state.angle,
        swapped: state.swapped,
        rotationMode: state.rotationMode,
        spanRatio: state.spanRatio,
        dividerColor: state.dividerColor,
        dividerThickness: state.dividerThickness,
        backButtonColor: state.backButtonColor,
        forwardButtonColor: state.forwardButtonColor,
      },
    });
  } catch {
    // Geometry remains fully usable when storage is unavailable.
  }
}

async function persistPages() {
  try {
    await extensionApi.storage.local.set({
      [settingsStorageKey]: {
        pageA: pages.displayA,
        pageB: pages.displayB,
        updatedAt: Date.now(),
      },
    });
  } catch {
    // Page loading is independent from persistence.
  }
}

function setFrameSource(frame, url) {
  if (frame.getAttribute("src") !== url) {
    frame.setAttribute("src", url);
  }
}

function applyPagesToFrames({ force = false } = {}) {
  if (force || paneA.getAttribute("src") !== pages.a) {
    setFrameSource(paneA, pages.a);
  }
  if (force || paneB.getAttribute("src") !== pages.b) {
    setFrameSource(paneB, pages.b);
  }

  addressA.value = pages.displayA;
  addressB.value = pages.displayB;
}

function updateAngleBadge() {
  angleBadge.textContent = `${Math.round(state.angle)}°`;
  divider.setAttribute(
    "aria-valuetext",
    `角度 ${Math.round(state.angle)} 度`,
  );
}

function getNavigationFrame(side) {
  if (side === "positive") {
    return state.swapped ? paneB : paneA;
  }
  return state.swapped ? paneA : paneB;
}

function getFrameForClusterPosition(cluster) {
  const rect = cluster.getBoundingClientRect();
  const geometry = getEffectiveGeometry();
  const radians = (geometry.angle * Math.PI) / 180;
  const normalX = Math.sin(radians);
  const normalY = -Math.cos(radians);
  const signedDistance =
    (rect.left + rect.width / 2 - geometry.centerX) * normalX +
    (rect.top + rect.height / 2 - geometry.centerY) * normalY;

  return getNavigationFrame(
    signedDistance >= 0 ? "positive" : "negative",
  );
}

function updateNavigationLabels() {
  const positiveFrame = getFrameForClusterPosition(navPositive);
  const negativeFrame = getFrameForClusterPosition(navNegative);
  const labels = {
    back: "后退",
    forward: "前进",
    reload: "刷新",
  };

  for (const [cluster, frame] of [
    [navPositive, positiveFrame],
    [navNegative, negativeFrame],
  ]) {
    const paneName = frame === paneA ? "A" : "B";
    const pageLabel = `网页 ${paneName}`;
    cluster.dataset.pane = paneName;
    cluster.setAttribute("aria-label", `${pageLabel}导航`);
    for (const button of cluster.querySelectorAll("[data-command]")) {
      const action = labels[button.dataset.command];
      button.title = `${pageLabel}：${action}`;
      button.setAttribute("aria-label", `${pageLabel}${action}`);
    }
  }
}

function updateVideoSafeMode() {
  window.clearTimeout(videoSafeExitTimer);
  videoSafeExitTimer = 0;

  if (videoPlayingFrames.size > 0) {
    if (!videoSafeMode) {
      videoSafeMode = true;
      document.body.classList.add("video-safe-mode");
      rotateHandle.hidden = true;
      videoModeBadge.hidden = false;
      scheduleGeometry();
    }
    return;
  }

  if (!videoSafeMode) {
    return;
  }

  videoSafeExitTimer = window.setTimeout(() => {
    if (videoPlayingFrames.size > 0) {
      return;
    }
    videoSafeMode = false;
    document.body.classList.remove("video-safe-mode");
    videoModeBadge.hidden = true;
    scheduleGeometry();
  }, 900);
}

function armFrameBridge(frame) {
  try {
    frame.contentWindow?.postMessage(
      {
        channel: navigationChannel,
        type: "arm",
        token: navigationToken,
      },
      "*",
    );
  } catch {
    // Navigation controls remain available when the frame cannot be reached.
  }
}

function sendFrameNavigationCommand(frame, command) {
  try {
    const frameWindow = frame.contentWindow;
    if (!frameWindow) {
      return;
    }

    // This succeeds only for same-origin local demo frames.
    void frameWindow.document;
    if (command === "back") {
      frameWindow.history.back();
    } else if (command === "forward") {
      frameWindow.history.forward();
    } else if (command === "reload") {
      frameWindow.location.reload();
    }
    return;
  } catch {
    // Cross-origin frames are controlled by the injected content-script bridge.
  }

  armFrameBridge(frame);
  try {
    frame.contentWindow?.postMessage(
      {
        channel: navigationChannel,
        type: "command",
        token: navigationToken,
        command,
      },
      "*",
    );
  } catch {
    // Ignore frames that have been detached during navigation.
  }

}

function buttonInkForBackground(color) {
  if (color === "#80f0ff") {
    return "#176875";
  }
  if (color === "#ffa8f3") {
    return "#9d3c8c";
  }

  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  const brightness = (red * 299 + green * 587 + blue * 114) / 1000;
  const channels =
    brightness > 145
      ? [red * 0.34, green * 0.34, blue * 0.34]
      : [
          red + (255 - red) * 0.82,
          green + (255 - green) * 0.82,
          blue + (255 - blue) * 0.82,
        ];

  return `#${channels
    .map((channel) =>
      Math.round(clamp(channel, 0, 255))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function renderAppearance() {
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty("--divider-color", state.dividerColor);
  rootStyle.setProperty(
    "--divider-width",
    `${state.dividerThickness}px`,
  );
  rootStyle.setProperty("--nav-back-color", state.backButtonColor);
  rootStyle.setProperty(
    "--nav-back-ink",
    buttonInkForBackground(state.backButtonColor),
  );
  rootStyle.setProperty("--nav-forward-color", state.forwardButtonColor);
  rootStyle.setProperty(
    "--nav-forward-ink",
    buttonInkForBackground(state.forwardButtonColor),
  );

  const colorLabel = state.dividerColor.toUpperCase();
  currentColorSwatch.style.backgroundColor = state.dividerColor;
  colorValue.textContent = colorLabel;
  customColor.value = state.dividerColor;
  for (const swatch of colorSwatches) {
    swatch.classList.toggle(
      "is-selected",
      swatch.dataset.color?.toLowerCase() === state.dividerColor,
    );
  }

  backButtonSwatch.style.backgroundColor = state.backButtonColor;
  forwardButtonSwatch.style.backgroundColor = state.forwardButtonColor;
  backButtonColorValue.textContent = state.backButtonColor.toUpperCase();
  forwardButtonColorValue.textContent =
    state.forwardButtonColor.toUpperCase();
  navColorTitle.textContent =
    activeNavColorTarget === "back"
      ? "选择返回按钮颜色"
      : "选择下一页按钮颜色";
  const activeNavColor =
    activeNavColorTarget === "back"
      ? state.backButtonColor
      : state.forwardButtonColor;
  navCustomColor.value = activeNavColor;
  for (const swatch of navColorSwatches) {
    swatch.classList.toggle(
      "is-selected",
      swatch.dataset.color?.toLowerCase() === activeNavColor,
    );
  }

  thicknessRange.value = String(state.dividerThickness);
  thicknessValue.textContent = `${state.dividerThickness} px`;
  thicknessOutput.textContent = `${state.dividerThickness} px`;
  const rangeProgress =
    ((state.dividerThickness - 2) / (20 - 2)) * 100;
  thicknessRange.style.setProperty(
    "--range-progress",
    `${rangeProgress}%`,
  );
}

function controlRadius() {
  return state.spanRatio * Math.min(window.innerWidth, window.innerHeight);
}

function constrainHorizontalCenter() {
  const width = window.innerWidth;
  const effectiveAngle = videoSafeMode ? 90 : state.angle;
  const radians = (effectiveAngle * Math.PI) / 180;
  const handleHorizontalReach =
    Math.abs(Math.cos(radians)) * controlRadius() + 20;
  const minimumFraction = Math.min(handleHorizontalReach / width, 0.5);
  state.x = clamp(state.x, minimumFraction, 1 - minimumFraction);
}

function getEffectiveGeometry() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  return {
    width,
    height,
    centerX: state.x * width,
    centerY: videoSafeMode ? height / 2 : state.y * height,
    angle: videoSafeMode ? 90 : state.angle,
    safeMode: videoSafeMode,
  };
}

function getControlPoints() {
  const geometry = getEffectiveGeometry();
  const radians = (geometry.angle * Math.PI) / 180;
  const { centerX, centerY } = geometry;
  const radius = controlRadius();
  const unitX = Math.cos(radians);
  const unitY = Math.sin(radians);

  return {
    center: { x: centerX, y: centerY },
    left: {
      x: centerX - unitX * radius,
      y: centerY - unitY * radius,
    },
    right: {
      x: centerX + unitX * radius,
      y: centerY + unitY * radius,
    },
  };
}

function updatePaneMask(frame, maskBody, anchor, side, geometry) {
  const { width, height, centerX, centerY, angle, safeMode } = geometry;
  if (safeMode) {
    const isRight = side === "positive";
    anchor.style.transform = "none";
    maskBody.style.left = `${isRight ? centerX : 0}px`;
    maskBody.style.top = "0px";
    maskBody.style.width = `${isRight ? width - centerX : centerX}px`;
    maskBody.style.height = `${height}px`;
    frame.style.width = `${width}px`;
    frame.style.height = `${height}px`;
    frame.style.left = `${isRight ? -centerX : 0}px`;
    frame.style.top = "0px";
    frame.style.transform = "none";
    return;
  }

  const radians = (angle * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const maskExtent = (Math.hypot(width, height) * 1.2 + 40) * 2;
  const bodyLeft = -maskExtent;
  const bodyTop = side === "positive" ? -maskExtent : 0;

  // Invert the rotated mask coordinate system so the page itself stays upright.
  const pageLeft = -centerX * cosine - centerY * sine;
  const pageTop = centerX * sine - centerY * cosine;

  anchor.style.transform =
    `translate3d(${centerX}px, ${centerY}px, 0) rotate(${angle}deg)`;
  maskBody.style.left = `${bodyLeft}px`;
  maskBody.style.top = `${bodyTop}px`;
  maskBody.style.width = `${maskExtent * 2}px`;
  maskBody.style.height = `${maskExtent}px`;

  frame.style.width = `${width}px`;
  frame.style.height = `${height}px`;
  frame.style.left = "0px";
  frame.style.top = "0px";
  frame.style.transform =
    `translate3d(${pageLeft - bodyLeft}px, ${pageTop - bodyTop}px, 0) ` +
    `rotate(${-angle}deg)`;
}

function renderGeometry() {
  geometryFrame = 0;
  constrainHorizontalCenter();
  const geometry = getEffectiveGeometry();
  const { width, height, centerX, centerY, angle } = geometry;
  const diagonal = Math.hypot(width, height) * 1.2 + 40;
  const radius = controlRadius();

  document.documentElement.style.setProperty("--diagonal", `${diagonal}px`);
  divider.style.left = `${centerX}px`;
  divider.style.top = `${centerY}px`;
  dividerRotor.style.transform = `rotate(${angle}deg)`;
  leftHandle.style.left = `${-radius - 10}px`;
  rightHandle.style.left = `${radius - 10}px`;

  updatePaneMask(
    paneA,
    paneAMaskBody,
    paneAClipContainer,
    state.swapped ? "negative" : "positive",
    geometry,
  );
  updatePaneMask(
    paneB,
    paneBMaskBody,
    paneBClipContainer,
    state.swapped ? "positive" : "negative",
    geometry,
  );
  updateNavigationLabels();

  edgeLabelA.textContent = state.swapped ? "B" : "A";
  edgeLabelB.textContent = state.swapped ? "A" : "B";
  updateAngleBadge();
}

function scheduleGeometry() {
  if (geometryFrame) {
    return;
  }
  geometryFrame = window.requestAnimationFrame(renderGeometry);
}

function markInteracted() {
  window.clearTimeout(hintTimer);
  gestureHint.classList.add("is-hidden");
}

function beginMove(event, { centerClick = false } = {}) {
  if (event.button !== 0) {
    return;
  }

  event.preventDefault();
  markInteracted();
  divider.classList.add("is-active");
  event.currentTarget.setPointerCapture(event.pointerId);
  dragState = {
    mode: "move",
    pointerId: event.pointerId,
    captureTarget: event.currentTarget,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startX: state.x,
    startY: state.y,
    moved: false,
    centerClick,
  };
  document.body.classList.add("dragging");
}

function beginEndpointRotate(event, side) {
  if (event.button !== 0) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  markInteracted();
  divider.classList.add("is-active");
  event.currentTarget.setPointerCapture(event.pointerId);
  const points = getControlPoints();

  dragState = {
    mode: "endpoint-rotate",
    pointerId: event.pointerId,
    captureTarget: event.currentTarget,
    pivot: side === "left" ? points.right : points.left,
    side,
    startClientX: event.clientX,
    startClientY: event.clientY,
    moved: false,
  };
  document.body.classList.add("dragging");
}

function beginRotate(event) {
  if (event.button !== 0) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  window.clearTimeout(rotateControlTimer);
  revealRotateControl();
  markInteracted();
  divider.classList.add("is-active");
  rotateHandle.setPointerCapture(event.pointerId);

  const centerX = state.x * window.innerWidth;
  const centerY = state.y * window.innerHeight;
  const pointerAngle =
    (Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180) /
    Math.PI;

  dragState = {
    mode: "rotate",
    pointerId: event.pointerId,
    captureTarget: rotateHandle,
    angleOffset: state.angle - pointerAngle,
    moved: false,
  };
  document.body.classList.add("dragging");
}

function continueDrag(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) {
    return;
  }

  event.preventDefault();
  if (
    dragState.mode !== "endpoint-rotate" &&
    Math.hypot(
      event.clientX - dragState.startClientX,
      event.clientY - dragState.startClientY,
    ) > 3
  ) {
    dragState.moved = true;
  }

  if (dragState.mode === "move") {
    const deltaX = (event.clientX - dragState.startClientX) / window.innerWidth;
    state.x = clamp(dragState.startX + deltaX, 0, 1);
    if (!videoSafeMode) {
      const deltaY =
        (event.clientY - dragState.startClientY) / window.innerHeight;
      state.y = clamp(dragState.startY + deltaY, 0, 1);
    }
  } else if (dragState.mode === "endpoint-rotate") {
    const nextState = rotateLineAroundPivot({
      pointer: { x: event.clientX, y: event.clientY },
      pivot: dragState.pivot,
      side: dragState.side,
      width: window.innerWidth,
      height: window.innerHeight,
      minimumDimension: Math.min(window.innerWidth, window.innerHeight),
    });
    if (!nextState) {
      return;
    }

    dragState.moved = true;
    state.x = nextState.x;
    state.y = nextState.y;
    state.angle = nextState.angle;
    state.spanRatio = nextState.spanRatio;
  } else {
    const centerX = state.x * window.innerWidth;
    const centerY = state.y * window.innerHeight;
    const distance = Math.hypot(event.clientX - centerX, event.clientY - centerY);
    if (distance < 8) {
      return;
    }

    const pointerAngle =
      (Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180) /
      Math.PI;
    state.angle = normalizeAngle(pointerAngle + dragState.angleOffset);
  }

  scheduleGeometry();
}

function endDrag(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) {
    return;
  }

  const finishedDrag = dragState;
  if (finishedDrag.captureTarget.hasPointerCapture(event.pointerId)) {
    finishedDrag.captureTarget.releasePointerCapture(event.pointerId);
  }
  dragState = null;
  document.body.classList.remove("dragging");
  window.setTimeout(() => divider.classList.remove("is-active"), 650);
  if (
    finishedDrag.mode === "move" &&
    finishedDrag.centerClick &&
    !finishedDrag.moved &&
    state.rotationMode === "center"
  ) {
    revealRotateControl();
  }
  if (finishedDrag.mode === "rotate") {
    scheduleRotateControlHide();
  }
  persistGeometry();
}

function revealRotateControl() {
  if (state.rotationMode !== "center") {
    return;
  }

  rotateHandle.hidden = false;
  window.clearTimeout(rotateControlTimer);
  rotateControlTimer = window.setTimeout(hideRotateControl, 5000);
}

function hideRotateControl() {
  if (dragState?.mode === "rotate") {
    return;
  }
  rotateHandle.hidden = true;
}

function scheduleRotateControlHide() {
  window.clearTimeout(rotateControlTimer);
  rotateControlTimer = window.setTimeout(hideRotateControl, 5000);
}

function handleGripKeyboard(event) {
  const key = event.key;
  if (
    state.rotationMode === "center" &&
    (key === "Enter" || key === " ")
  ) {
    event.preventDefault();
    revealRotateControl();
    return;
  }
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key)) {
    return;
  }

  event.preventDefault();
  markInteracted();
  divider.classList.add("is-active");

  if (event.shiftKey) {
    if (key === "ArrowLeft" || key === "ArrowUp") {
      state.angle = normalizeAngle(state.angle - 2);
    } else {
      state.angle = normalizeAngle(state.angle + 2);
    }
  } else {
    const step = event.altKey ? 1 : 8;
    if (key === "ArrowLeft") {
      state.x = clamp(state.x - step / window.innerWidth, 0, 1);
    } else if (key === "ArrowRight") {
      state.x = clamp(state.x + step / window.innerWidth, 0, 1);
    } else if (key === "ArrowUp") {
      state.y = clamp(state.y - step / window.innerHeight, 0, 1);
    } else if (key === "ArrowDown") {
      state.y = clamp(state.y + step / window.innerHeight, 0, 1);
    }
  }

  scheduleGeometry();
  persistGeometry();
  window.setTimeout(() => divider.classList.remove("is-active"), 650);
}

function setRotationMode(mode, { persist = true } = {}) {
  if (mode !== "center" && mode !== "two-point") {
    return;
  }

  state.rotationMode = mode;
  document.body.dataset.rotationMode = mode;
  rotationTwoPoint.checked = mode === "two-point";
  rotationCenter.checked = mode === "center";
  gestureAction.textContent =
    mode === "two-point" ? "拖动两端小点旋转" : "点击中心点旋转";

  if (mode === "two-point") {
    rotateHandle.hidden = true;
    window.clearTimeout(rotateControlTimer);
  }

  if (persist) {
    persistGeometry();
  }
}

function setPanelOpen(isOpen) {
  controlPanel.hidden = !isOpen;
  panelToggle.setAttribute("aria-expanded", String(isOpen));
  splitStage.classList.toggle("panel-open", isOpen);
  if (isOpen) {
    addressMessage.textContent = "";
  } else {
    closeAppearancePopovers();
  }
}

function closeAppearancePopovers() {
  colorPopover.hidden = true;
  thicknessPopover.hidden = true;
  navColorPopover.hidden = true;
  colorPickerToggle.setAttribute("aria-expanded", "false");
  thicknessToggle.setAttribute("aria-expanded", "false");
  backColorToggle.setAttribute("aria-expanded", "false");
  forwardColorToggle.setAttribute("aria-expanded", "false");
}

function toggleAppearancePopover(target) {
  const shouldShowColor = target === "color" && colorPopover.hidden;
  const shouldShowThickness =
    target === "thickness" && thicknessPopover.hidden;
  const isNavColor = target === "back" || target === "forward";
  const shouldShowNavColor =
    isNavColor &&
    (navColorPopover.hidden || activeNavColorTarget !== target);

  if (shouldShowNavColor) {
    activeNavColorTarget = target;
  }

  colorPopover.hidden = !shouldShowColor;
  thicknessPopover.hidden = !shouldShowThickness;
  navColorPopover.hidden = !shouldShowNavColor;
  colorPickerToggle.setAttribute(
    "aria-expanded",
    String(shouldShowColor),
  );
  thicknessToggle.setAttribute(
    "aria-expanded",
    String(shouldShowThickness),
  );
  backColorToggle.setAttribute(
    "aria-expanded",
    String(shouldShowNavColor && activeNavColorTarget === "back"),
  );
  forwardColorToggle.setAttribute(
    "aria-expanded",
    String(shouldShowNavColor && activeNavColorTarget === "forward"),
  );
  renderAppearance();
}

function setDividerColor(value, { persist = true } = {}) {
  if (!/^#[0-9a-f]{6}$/i.test(value)) {
    return;
  }

  state.dividerColor = value.toLowerCase();
  renderAppearance();
  if (persist) {
    persistGeometry();
  }
}

function setNavButtonColor(target, value, { persist = true } = {}) {
  if (!/^#[0-9a-f]{6}$/i.test(value)) {
    return;
  }

  if (target === "forward") {
    state.forwardButtonColor = value.toLowerCase();
  } else {
    state.backButtonColor = value.toLowerCase();
  }
  renderAppearance();
  if (persist) {
    persistGeometry();
  }
}

function setDividerThickness(value, { persist = true } = {}) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return;
  }

  state.dividerThickness = clamp(Math.round(numericValue), 2, 20);
  renderAppearance();
  if (persist) {
    persistGeometry();
  }
}

function buildAudioBars() {
  if (audioBars.childElementCount > 0) {
    return;
  }

  for (let levelIndex = 0; levelIndex < audioLevelCount; levelIndex += 1) {
    for (const direction of [-1, 1]) {
      const pair = document.createElement("span");
      pair.className = "audio-pair";
      pair.style.left = `${direction * audioBarOffsets[levelIndex]}px`;

      const upper = document.createElement("i");
      upper.className = "audio-bar audio-bar-up";
      const lower = document.createElement("i");
      lower.className = "audio-bar audio-bar-down";

      pair.append(upper, lower);
      audioBars.append(pair);
      audioPairsByLevel[levelIndex].push(upper, lower);
    }
  }
  setAudioBarLevels(Array(audioLevelCount).fill(0));
}

function setAudioBarLevels(levels) {
  for (let index = 0; index < audioPairsByLevel.length; index += 1) {
    const scaleY = Math.max(0.05, levels[index]);
    for (const bar of audioPairsByLevel[index]) {
      bar.style.transform = `scaleY(${scaleY})`;
    }
  }
}

function setAudioResponseUi(active, status) {
  audioActive = active;
  audioToggle.classList.toggle("is-active", active);
  audioToggle.setAttribute("aria-pressed", String(active));
  audioStatus.textContent = status;
  document.body.classList.toggle("audio-reactive", active);

  if (!active) {
    setAudioBarLevels(Array(audioLevelCount).fill(0));
  }
}

function renderAudioFrame(timestamp) {
  if (!audioActive || !audioAnalyser || !audioFrequencyData) {
    return;
  }

  audioAnalyser.getByteFrequencyData(audioFrequencyData);
  const usableBins = Math.max(
    1,
    Math.floor(audioFrequencyData.length * 0.72),
  );
  const levels = [];

  for (let index = 0; index < audioLevelCount; index += 1) {
    const start = Math.floor(
      Math.pow(index / audioLevelCount, 1.55) * usableBins,
    );
    const end = Math.max(
      start + 1,
      Math.floor(
        Math.pow((index + 1) / audioLevelCount, 1.55) * usableBins,
      ),
    );
    let total = 0;
    let peak = 0;
    for (let bin = start; bin < end; bin += 1) {
      const value = audioFrequencyData[bin] || 0;
      total += value;
      peak = Math.max(peak, value);
    }

    const average = total / Math.max(1, end - start);
    const signal = (average * 0.4 + peak * 0.6) / 165;
    const contrast = Math.pow(clamp(signal, 0, 1), 1.45);
    const wave =
      0.015 +
      (Math.sin(timestamp * 0.004 + index * 0.9) * 0.5 + 0.5) * 0.018;
    levels.push(clamp(contrast + wave, 0.015, 1));
  }

  setAudioBarLevels(levels);
  audioAnimationFrame = window.requestAnimationFrame(renderAudioFrame);
}

async function startAudioResponse() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    setAudioResponseUi(
      false,
      "当前浏览器不支持系统音频共享功能",
    );
    return;
  }

  audioToggleBusy = true;
  audioToggle.disabled = true;
  audioStatus.textContent = "请选择共享内容并勾选音频…";

  try {
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });
    audioDisplayStream = displayStream;
    const audioTracks = displayStream.getAudioTracks();
    if (audioTracks.length === 0) {
      throw new Error("AUDIO_TRACK_MISSING");
    }

    activeVideoTrack = displayStream.getVideoTracks()[0] || null;
    if (activeVideoTrack) {
      activeVideoTrack.enabled = false;
      activeVideoTrack.addEventListener(
        "ended",
        () => {
          if (audioActive) {
            stopAudioResponse({
              status: "共享已结束，音频响应已停止",
            });
          }
        },
        { once: true },
      );
    }

    const AudioContextClass =
      window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error("AUDIO_CONTEXT_UNSUPPORTED");
    }

    audioContext = new AudioContextClass();
    await audioContext.resume();
    audioTrack = audioTracks[0];
    const audioOnlyStream = new MediaStream([audioTrack]);
    audioSource = audioContext.createMediaStreamSource(audioOnlyStream);
    audioAnalyser = audioContext.createAnalyser();
    audioAnalyser.fftSize = 512;
    audioAnalyser.smoothingTimeConstant = 0.76;
    audioFrequencyData = new Uint8Array(audioAnalyser.frequencyBinCount);
    audioSource.connect(audioAnalyser);

    audioTrack.addEventListener(
      "ended",
      () => {
        if (audioActive) {
          stopAudioResponse({
            status: "音频轨道已结束，音频响应已停止",
          });
        }
      },
      { once: true },
    );

    setAudioResponseUi(
      true,
      "正在响应系统 / 标签页音频",
    );
    audioAnimationFrame = window.requestAnimationFrame(renderAudioFrame);
  } catch (error) {
    let status = "无法启动音频响应，请重试";
    if (error?.name === "NotAllowedError") {
      status = "已取消，或未授予共享音频权限";
    } else if (error?.message === "AUDIO_TRACK_MISSING") {
      status = "未获取到音频，请在共享窗口中勾选音频";
    } else if (error?.message === "AUDIO_CONTEXT_UNSUPPORTED") {
      status = "当前浏览器不支持 Web Audio";
    }
    stopAudioResponse({ status });
  } finally {
    audioToggleBusy = false;
    audioToggle.disabled = false;
  }
}

function stopAudioResponse({ status = "音频响应已关闭" } = {}) {
  audioActive = false;
  window.cancelAnimationFrame(audioAnimationFrame);
  audioAnimationFrame = 0;

  if (audioSource) {
    try {
      audioSource.disconnect();
    } catch {
      // The source may already be disconnected by the browser.
    }
    audioSource = null;
  }
  if (audioAnalyser) {
    try {
      audioAnalyser.disconnect();
    } catch {
      // The analyser may already be disconnected by the browser.
    }
    audioAnalyser = null;
  }
  audioFrequencyData = null;
  audioTrack = null;

  if (audioDisplayStream) {
    for (const track of audioDisplayStream.getTracks()) {
      track.stop();
    }
    audioDisplayStream = null;
  }
  activeVideoTrack = null;

  if (audioContext) {
    audioContext.close().catch(() => {});
    audioContext = null;
  }
  setAudioResponseUi(false, status);
}

async function toggleAudioResponse() {
  if (audioToggleBusy) {
    return;
  }
  if (audioActive) {
    stopAudioResponse();
    return;
  }
  await startAudioResponse();
}

function applyAddressForm(event) {
  event.preventDefault();
  addressMessage.textContent = "";

  try {
    const nextA = normalizeUrl(addressA.value, demoAUrl);
    const nextB = normalizeUrl(addressB.value, demoBUrl);
    const changedA = nextA.url !== pages.a;
    const changedB = nextB.url !== pages.b;

    pages.a = nextA.url;
    pages.b = nextB.url;
    pages.displayA = nextA.display;
    pages.displayB = nextB.display;
    applyPagesToFrames();
    persistPages();

    if (changedA || changedB) {
      addressMessage.textContent = "网页地址已更新。";
    } else {
      addressMessage.textContent = "地址没有变化，页面未重新加载。";
    }
  } catch (error) {
    addressMessage.textContent =
      error instanceof Error ? error.message : "无法更新网页地址。";
  }
}

function swapPanes() {
  state.swapped = !state.swapped;
  scheduleGeometry();
  persistGeometry();
  addressMessage.textContent = "已交换两个网页的显示位置，当前页面未重新加载。";
}

function resetDivider() {
  state.x = 0.5;
  state.y = 0.5;
  state.angle = 0;
  state.spanRatio = 0.18;
  scheduleGeometry();
  persistGeometry();
  addressMessage.textContent = "橙线已恢复到屏幕中央。";
}

function openPage(url) {
  try {
    extensionApi.tabs.create({ url });
  } catch {
    window.open(url, "_blank", "noopener");
  }
}

function wireEvents() {
  buildAudioBars();
  dragRail.addEventListener("pointerdown", beginMove);
  dragGrip.addEventListener("pointerdown", (event) => {
    beginMove(event, { centerClick: true });
  });
  leftHandle.addEventListener("pointerdown", (event) => {
    beginEndpointRotate(event, "left");
  });
  rightHandle.addEventListener("pointerdown", (event) => {
    beginEndpointRotate(event, "right");
  });
  rotateHandle.addEventListener("pointerdown", beginRotate);
  dragGrip.addEventListener("keydown", handleGripKeyboard);

  for (const target of [
    dragRail,
    dragGrip,
    leftHandle,
    rightHandle,
    rotateHandle,
  ]) {
    target.addEventListener("pointermove", continueDrag);
    target.addEventListener("pointerup", endDrag);
    target.addEventListener("pointercancel", endDrag);
    target.addEventListener("lostpointercapture", () => {
      dragState = null;
      document.body.classList.remove("dragging");
      scheduleRotateControlHide();
      persistGeometry();
    });
  }

  panelToggle.addEventListener("click", () => {
    setPanelOpen(controlPanel.hidden);
  });
  panelClose.addEventListener("click", () => {
    setPanelOpen(false);
    panelToggle.focus();
  });
  addressForm.addEventListener("submit", applyAddressForm);
  swapPanesButton.addEventListener("click", swapPanes);
  resetDividerButton.addEventListener("click", resetDivider);
  openPaneAButton.addEventListener("click", () => openPage(pages.a));
  openPaneBButton.addEventListener("click", () => openPage(pages.b));
  rotationTwoPoint.addEventListener("change", () => {
    if (rotationTwoPoint.checked) {
      setRotationMode("two-point");
    }
  });
  rotationCenter.addEventListener("change", () => {
    if (rotationCenter.checked) {
      setRotationMode("center");
      addressMessage.textContent =
        "中心旋转已启用。点击橙色中心小点，旋转按钮会显示 5 秒。";
    }
  });
  colorPickerToggle.addEventListener("click", () => {
    toggleAppearancePopover("color");
  });
  thicknessToggle.addEventListener("click", () => {
    toggleAppearancePopover("thickness");
  });
  backColorToggle.addEventListener("click", () => {
    toggleAppearancePopover("back");
  });
  forwardColorToggle.addEventListener("click", () => {
    toggleAppearancePopover("forward");
  });
  for (const swatch of colorSwatches) {
    swatch.style.backgroundColor = swatch.dataset.color;
    swatch.addEventListener("click", () => {
      setDividerColor(swatch.dataset.color);
    });
  }
  customColor.addEventListener("input", () => {
    setDividerColor(customColor.value, { persist: false });
  });
  customColor.addEventListener("change", () => {
    setDividerColor(customColor.value);
  });
  for (const swatch of navColorSwatches) {
    swatch.style.backgroundColor = swatch.dataset.color;
    swatch.addEventListener("click", () => {
      setNavButtonColor(activeNavColorTarget, swatch.dataset.color);
    });
  }
  navCustomColor.addEventListener("input", () => {
    setNavButtonColor(activeNavColorTarget, navCustomColor.value, {
      persist: false,
    });
  });
  navCustomColor.addEventListener("change", () => {
    setNavButtonColor(activeNavColorTarget, navCustomColor.value);
  });
  thicknessRange.addEventListener("input", () => {
    setDividerThickness(thicknessRange.value, { persist: false });
  });
  thicknessRange.addEventListener("change", () => {
    setDividerThickness(thicknessRange.value);
  });
  audioToggle.addEventListener("click", toggleAudioResponse);
  for (const cluster of [navPositive, navNegative]) {
    cluster.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-command]");
      if (!button) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const frame = getFrameForClusterPosition(cluster);
      sendFrameNavigationCommand(frame, button.dataset.command);
    });
  }

  window.addEventListener("resize", scheduleGeometry, { passive: true });
  window.addEventListener("orientationchange", scheduleGeometry, {
    passive: true,
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && audioActive) {
      stopAudioResponse({
        status: "页面隐藏后已停止音频响应",
      });
    }
  });
  window.addEventListener("pagehide", () => {
    if (audioActive || audioDisplayStream) {
      stopAudioResponse();
    }
  });
  paneA.addEventListener("load", () => {
    frameBridgeReadyFrames.delete(paneA);
    videoPlayingFrames.delete(paneA);
    updateVideoSafeMode();
    window.setTimeout(() => armFrameBridge(paneA), 0);
  });
  paneB.addEventListener("load", () => {
    frameBridgeReadyFrames.delete(paneB);
    videoPlayingFrames.delete(paneB);
    updateVideoSafeMode();
    window.setTimeout(() => armFrameBridge(paneB), 0);
  });
  window.addEventListener("message", (event) => {
    if (
      event.data?.channel !== navigationChannel ||
      event.data?.token !== navigationToken
    ) {
      return;
    }

    const sourceFrame =
      event.source === paneA.contentWindow
        ? paneA
        : event.source === paneB.contentWindow
          ? paneB
          : null;
    if (!sourceFrame) {
      return;
    }

    if (event.data.type === "ready" && sourceFrame === paneA) {
      frameBridgeReadyFrames.add(paneA);
    } else if (event.data.type === "ready" && sourceFrame === paneB) {
      frameBridgeReadyFrames.add(paneB);
    } else if (event.data.type === "media-state") {
      if (event.data.playing) {
        videoPlayingFrames.add(sourceFrame);
      } else {
        videoPlayingFrames.delete(sourceFrame);
      }
      updateVideoSafeMode();
    }
  });
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }
    if (
      !colorPopover.hidden ||
      !thicknessPopover.hidden ||
      !navColorPopover.hidden
    ) {
      closeAppearancePopovers();
    } else if (!controlPanel.hidden) {
      setPanelOpen(false);
      panelToggle.focus();
    }
  });
}

async function initialize() {
  const query = new URLSearchParams(window.location.search);
  document.documentElement.dataset.navigationToken = navigationToken;
  const stored = await readStoredValues();
  restoreState(stored[geometryStorageKey]);

  if (Number.isFinite(Number(query.get("x"))) && query.has("x")) {
    state.x = clamp(Number(query.get("x")), 0, 1);
  }
  if (Number.isFinite(Number(query.get("y"))) && query.has("y")) {
    state.y = clamp(Number(query.get("y")), 0, 1);
  }
  if (Number.isFinite(Number(query.get("angle"))) && query.has("angle")) {
    state.angle = normalizeAngle(Number(query.get("angle")));
  }
  if (query.has("swap")) {
    state.swapped = query.get("swap") === "1";
  }
  if (query.get("mode") === "center" || query.get("mode") === "two-point") {
    state.rotationMode = query.get("mode");
  }
  if (
    query.has("color") &&
    /^#[0-9a-f]{6}$/i.test(query.get("color"))
  ) {
    state.dividerColor = query.get("color").toLowerCase();
  }
  if (
    query.has("thickness") &&
    Number.isFinite(Number(query.get("thickness")))
  ) {
    state.dividerThickness = clamp(
      Math.round(Number(query.get("thickness"))),
      2,
      20,
    );
  }

  const storedSettings = stored[settingsStorageKey] || {};
  const queryA = query.has("a") ? query.get("a") : storedSettings.pageA;
  const queryB = query.has("b") ? query.get("b") : storedSettings.pageB;

  const nextA = normalizeUrl(queryA, demoAUrl);
  const nextB = normalizeUrl(queryB, demoBUrl);
  pages.a = nextA.url;
  pages.b = nextB.url;
  pages.displayA = nextA.display;
  pages.displayB = nextB.display;

  applyPagesToFrames();
  setRotationMode(state.rotationMode, { persist: false });
  renderAppearance();
  renderGeometry();
  window.setTimeout(() => {
    armFrameBridge(paneA);
    armFrameBridge(paneB);
  }, 0);
  setPanelOpen(query.get("panel") === "1");

  hintTimer = window.setTimeout(markInteracted, 6000);
}

wireEvents();
initialize();
