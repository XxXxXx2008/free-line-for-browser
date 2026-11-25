(function () {
  "use strict";

  const channel = "orange-split-navigation-v1";
  let token = "";
  let armed = false;
  let parentOrigin = "";
  let reportedPlaying = false;
  let mediaIntentTimer = 0;

  function isExtensionOrigin(origin) {
    return origin.startsWith("chrome-extension://");
  }

  function navigateInFrame(url) {
    if (!/^https?:/i.test(url)) {
      return;
    }
    window.location.assign(url);
  }

  function handleClick(event) {
    if (event.defaultPrevented || event.button !== 0) {
      return;
    }

    const target = event.target;
    const link =
      target && typeof target.closest === "function"
        ? target.closest("a[href]")
        : null;
    if (!link || link.hasAttribute("download")) {
      return;
    }
    if (!/^https?:/i.test(link.href)) {
      return;
    }

    const linkTarget = String(link.target || "").toLowerCase();
    const shouldStayInPane =
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      (linkTarget !== "" && linkTarget !== "_self");
    if (!shouldStayInPane) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    navigateInFrame(link.href);
  }

  function handleSubmit(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) {
      return;
    }

    const formTarget = String(form.target || "").toLowerCase();
    if (formTarget !== "" && formTarget !== "_self") {
      form.target = "_self";
    }
  }

  function armBridge() {
    if (armed) {
      return;
    }
    armed = true;
    document.addEventListener("click", handleClick, true);
    document.addEventListener("submit", handleSubmit, true);
    document.addEventListener(
      "pointerdown",
      function (event) {
        const target = event.target;
        const player =
          target && typeof target.closest === "function"
            ? target.closest("video, .bpx-player-video-wrap, .bpx-player-container")
            : null;
        if (player) {
          window.clearTimeout(mediaIntentTimer);
          reportMediaState(true);
          mediaIntentTimer = window.setTimeout(function () {
            const anyPlaying = Array.from(
              document.querySelectorAll("video"),
            ).some((video) => !video.paused && !video.ended);
            if (!anyPlaying) {
              reportMediaState(false);
            }
          }, 1500);
        }
      },
      true,
    );
    document.addEventListener(
      "play",
      function (event) {
        if (event.target instanceof HTMLVideoElement) {
          window.clearTimeout(mediaIntentTimer);
          reportCurrentMediaState();
        }
      },
      true,
    );
    for (const eventName of ["pause", "ended"]) {
      document.addEventListener(
        eventName,
        function (event) {
          if (event.target instanceof HTMLVideoElement) {
            window.clearTimeout(mediaIntentTimer);
            window.setTimeout(reportCurrentMediaState, 0);
          }
        },
        true,
      );
    }

    const currentVideo = Array.from(document.querySelectorAll("video")).find(
      (video) => !video.paused && !video.ended,
    );
    if (currentVideo) {
      reportMediaState(true);
    }
  }

  function reportMediaState(playing) {
    if (!armed || reportedPlaying === playing || !parentOrigin) {
      return;
    }
    reportedPlaying = playing;
    window.parent.postMessage(
      {
        channel,
        type: "media-state",
        token,
        playing,
      },
      parentOrigin,
    );
  }

  function reportCurrentMediaState() {
    const anyPlaying = Array.from(document.querySelectorAll("video")).some(
      (video) => !video.paused && !video.ended,
    );
    reportMediaState(anyPlaying);
  }

  function handleCommand(message) {
    if (message.command === "back") {
      window.history.back();
    } else if (message.command === "forward") {
      window.history.forward();
    } else if (message.command === "reload") {
      window.location.reload();
    }
  }

  window.addEventListener("message", function (event) {
    if (
      event.source !== window.parent ||
      !isExtensionOrigin(event.origin) ||
      !event.data ||
      event.data.channel !== channel
    ) {
      return;
    }

    if (event.data.type === "arm" && typeof event.data.token === "string") {
      token = event.data.token;
      parentOrigin = event.origin;
      armBridge();
      window.parent.postMessage(
        {
          channel,
          type: "ready",
          token,
        },
        event.origin,
      );
      return;
    }

    if (
      event.data.type === "command" &&
      token &&
      event.data.token === token
    ) {
      handleCommand(event.data);
    }
  });
})();
