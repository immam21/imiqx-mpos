(function () {
  let deferredPrompt = null;

  function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  }

  function updateOnlineState() {
    const online = navigator.onLine;
    document.body.classList.toggle("is-offline", !online);
    document.body.classList.toggle("is-online", online);
    document.querySelectorAll("[data-pwa-status]").forEach((node) => {
      node.textContent = online ? "Ready offline" : "Offline mode";
    });
  }

  function updateDisplayMode() {
    document.body.classList.toggle("is-standalone", isStandalone());
  }

  function setInstallUi(visible) {
    document.querySelectorAll("[data-install-action]").forEach((node) => {
      node.hidden = !visible;
    });
    const banner = document.getElementById("install-banner");
    if (banner) {
      banner.classList.toggle("show", visible);
    }
  }

  async function promptInstall() {
    if (!deferredPrompt) {
      return;
    }
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    setInstallUi(false);
  }

  function init(options = {}) {
    updateOnlineState();
    updateDisplayMode();

    window.addEventListener("online", () => {
      updateOnlineState();
      if (typeof options.onOnline === "function") {
        options.onOnline();
      }
    });
    window.addEventListener("offline", updateOnlineState);

    window.addEventListener("beforeinstallprompt", (event) => {
      if (!document.querySelector("[data-install-action]")) {
        return;
      }
      event.preventDefault();
      deferredPrompt = event;
      setInstallUi(true);
    });

    window.addEventListener("appinstalled", () => {
      deferredPrompt = null;
      setInstallUi(false);
      updateDisplayMode();
    });

    document.querySelectorAll("[data-install-action]").forEach((node) => {
      node.addEventListener("click", promptInstall);
    });
    document.querySelectorAll("[data-install-dismiss]").forEach((node) => {
      node.addEventListener("click", () => setInstallUi(false));
    });

    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("sw.js").then((registration) => {
          if (typeof options.onRegistered === "function") {
            options.onRegistered(registration);
          }
        }).catch(() => {});
      });
    }
  }

  window.OneCounterPWA = { init };
})();