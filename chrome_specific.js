// This file is all [or most of] the chrome-specific code that is needed by the
// content script.  It's roughly the equivalent of the FF-only overlay.js.

(function () {

  var p = JsVim.prototype;

  function updatePageAction(enabled) {
    assert(typeof enabled == 'string');
    var message = {
      "message" : "updatePageAction",
      "data" : enabled
    };
    this.port.postMessage(message);
  }

  // No way to hide one, yet, but deleting textareas is somewhat rare, so that's
  // probably fine.  The tricky bit is knowing when we're down to 0 textareas in
  // this tab, especially given that we will have multiple content scripts if
  // we've got multiple iframes.
  function displayPageAction() {
    this.port.postMessage({"message": "showPageAction"});
  }

  function onFoundTextArea() {
    this.displayPageAction();
  }

  // I use "active" instead of "enabled", because we don't know if this is due
  // to enabled or lenabled.
  function handleEnableChange(active) {
    if (active) {
      window.addEventListener("DOMNodeInsertedIntoDocument",
          jsvim.setUpElementIfNeededForEvent, true);
    } else {
      window.removeEventListener("DOMNodeInsertedIntoDocument",
          jsvim.setUpElementIfNeededForEvent, true);
    }
    jsvim.setUpDocument(document, active);
  }

  function onDisconnect() {
    handleEnableChange(false);
  }

  function handlePreferences(payload) {
    for (var i in payload) {
      if (jsvim[i] != payload[i]) {
        jsvim[i] = payload[i];
        if (i == "enabled") {
          if (jsvim.lenabled) {
            handleEnableChange(jsvim[i]);
          }
          jsvim.updatePageAction(
            jsvim[i] ?
              (jsvim.disallowed ?
               (jsvim.disallowedJustEatEsc ?
                "disallowed_just_eat_esc" : "disabled") :
               (jsvim.lenabled ? "enabled" : "locally_disabled")) :
            "disabled");
        } else if (i == "showStatusBar" && jsvim["enabled"] && jsvim.lenabled) {
          if (jsvim[i]) {
            jsvim.setUpStatusBar();
          } else {
            jsvim.removeStatusBar();
          }
        }
      }
    }
  }

  function sendEnableUpdate(enabled) {
    this.port.postMessage({"message" : "setEnabled", "data" : enabled});
  }

  function handleToggleEnableFromPopup(which) {
    switch(which) {
      case "local":
        var newState = !jsvim.lenabled;
        jsvim.lenabled = newState;
        if (jsvim.enabled && !jsvim.disallowed) {
          handleEnableChange(newState);
          jsvim.updatePageAction(
              jsvim.lenabled ? "enabled" : "locally_disabled");
        }
        break;
      case "global":
        // This does all updates, including icon.
        jsvim.sendEnableUpdate(!jsvim.enabled);
        break;
      default:
        popup("didn't recognize enabled toggle '" + which + "'!");
    }
  }

  function init() {
    this.port = chrome.extension.connect();
    this.port.onMessage.addListener(onPortMessage);
    chrome.extension.onRequest.addListener(onExtensionRequest);
    this.port.onDisconnect.addListener(onDisconnect);
    this.port.postMessage({"message" : "requestPreferences"});
  }

  function onExtensionRequest(request, sender, sendResponse) {
    try {
      switch(request.message) {
        case "read_enables":
          sendResponse({
            global: jsvim.enabled,
            local: jsvim.lenabled
          });
          break;
        default:
          popup("chrome_specific.js got unknown extension request: " +
              stringifyObj(request));
          sendResponse({});
          break;
      }
    } catch (ex) {
      popup(stringifyObj(ex));
    }
  }

  function onPortMessage(request) {
    try {
      switch(request.message) {
        case "preferences":
          handlePreferences(request.data);
          break;
        case "toggle_enable":
          handleToggleEnableFromPopup(request.data);
          break;
        case "clipboardState":
          handleClipboardState(request.data);
          break;
        default:
          popup("chrome_specific.js got unknown port message: " +
              stringifyObj(request));
          break;
      }
    } catch (ex) {
      logStack(ex);
      popup(stringifyObj(ex));
    }
  }

  function requestClipboard() {
    var message = {
      "message" : "getClipboard"
    };
    this.port.postMessage(message);
  }

  // It might be nicer to use the actual CLIP register, but we don't have the
  // register names here.
  var clipboardCache = "";

  // We should have called requestClipboard and gotten a response by now.
  function getClipboard() {
    return clipboardCache;
  }

  function setClipboard(text) {
    clipboardCache = text; // Cache it just in case.
    this.port.postMessage({"message" : "setClipboard", "data" : text});
  }

  function handleClipboardState(text) {
    clipboardCache = text;
    try {
      jsvim.processQueue(true);
    } catch (ex) { // TODO: Share this block with enqueueOrHandle somehow?
      if (ex == "DONE") { // TODO: This is Consts.DONE.
        // Aborted; nothing more to do.
      } else if (ex == "Assertion failed!") {
        // Already displayed.
      } else if (ex.name == "NS_ERROR_FAILURE") {
        // Most likely our textarea just went away due to the action of the page
        // we're editing.  There's nothing we can do, so just give up.
        // TODO: Is this actually Firefox-only?
      } else {
        popup("Error in processQueue:\n" + stringifyObj(ex));
      }
      jsvim.getQueue().clear();
    }
  }

  p.getPrefs = getPrefs;
  p.inExtension = true; // Store here that we're running in extension context.
  p.init = init;
  p.isEnabled = isEnabled; // From sharedsettings.js
  p.onFoundTextArea = onFoundTextArea;
  p.updatePageAction = updatePageAction;
  p.displayPageAction = displayPageAction;
  p.sendEnableUpdate = sendEnableUpdate;
  p.requestClipboard = requestClipboard;
  p.getClipboard = getClipboard;
  p.setClipboard = setClipboard;

  jsvim.init();

})();
