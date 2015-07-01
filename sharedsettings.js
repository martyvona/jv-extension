function JvBoolPref(containerId, trueSuffix, falseSuffix, prefName, varName,
    onUpdate) {
  this.containerId = "jv-settings-" + containerId;
  this.trueId = this.containerId + trueSuffix;
  this.falseId = this.containerId + falseSuffix;
  this.prefName = prefName;
  this.varName = varName;
  this.onUpdate = onUpdate;
  this.isBool = true;
  return this;
}

function JvStringPref(containerId, prefName, varName, onUpdate) {
  this.containerId = "jv-settings-" + containerId;
  this.prefName = prefName;
  this.varName = varName;
  this.onUpdate = onUpdate;
  this.isBool = false;
  return this;
}

var prefs = [
  new JvBoolPref(
      "tab-handling",
      "-ignore", "-insert",
      "tab.handling.ignore",
      "neverHandleTab",
      null),
  new JvBoolPref(
      "default-mode",
      "-insert", "-normal",
      "default.mode.insert",
      "defaultModeInsert",
      null),
  new JvBoolPref(
      "undo-mode",
      "-vi", "-vim",
      "undo.mode.vi",
      "undoModeVi",
      null),
  new JvBoolPref(
      "visual-bell",
      "-inhibit", "-allow",
      "visual.bell.inhibit",
      "inhibitVisualBell",
      null),
  new JvBoolPref(
      "status-bar",
      "-show", "-hide",
      "status.bar.show",
      "showStatusBar",
      function (jsvim) {
        if (jsvim.showStatusBar) {
          jsvim.setUpStatusBar();
        } else {
          jsvim.removeStatusBar();
        }
      }),
  new JvBoolPref(
    "change-textarea-appearance", "-on", "-off",
    "change.textarea.appearance", "changeTextareaAppearance", null),
  new JvBoolPref(
    "change-divhack-appearance", "-on", "-off",
    "change.divhack.appearance", "changeDivhackAppearance", null),
  new JvBoolPref(
      "debugging-asserts",
      "-popup", "-ignore",
      "debugging.asserts.popup",
      "popupOnAssert",
      null),
  new JvBoolPref(
    "disallowed-just-eat-esc", "-on", "-off",
    "disallowed.justeatesc", "disallowedJustEatEsc", null),
  new JvStringPref(
    "disallowed-host-patterns",
    "disallowed.host.patterns", "disallowedHostPatterns", null),
  new JvBoolPref(
    "divhack-disabled", "-on", "-off",
    "divhack.disabled", "divhackDisabled", null),
  new JvBoolPref(
    "divhack-just-eat-esc", "-on", "-off",
    "divhack.justeatesc", "divhackJustEatEsc", null),
  new JvBoolPref(
    "divhack-allow-html", "-on", "-off",
    "divhack.allowhtml", "divhackAllowEditingAboveHTML", null),
  new JvBoolPref(
    "divhack-debug", "-on", "-off",
    "divhack.debug", "divhackDebug", null),
  new JvBoolPref(
    "divhack-disable-status-bar", "-on", "-off",
    "divhack.disablestatusbar", "divhackDisableStatusBar", null),
];

// This chrome prefs stuff shouldn't be shared; there should be a server side
// and a client side.  Most of the existing code should be server-side.  The
// notification on changes will be very custom--the call to setUpStatusBar, for
// example.
function getPrefs() {
  if (isChrome()) {
    if (!window.jvPrefs) {
      window.jvPrefs = {
        prefSet : function(prefName) {
          return prefName in localStorage;
        },
        getBoolPref : function(prefName) {
          var val = localStorage[prefName];
          return typeof(val) == "string" ? (val == "true") : val;
        },
        setBoolPref : function(prefName, value) {
          localStorage[prefName] =
              (typeof(value) == "string") ? (value == "true") : value;
        },
        getStringPref : function(prefName) {
          return localStorage[prefName];
        },
        setStringPref : function(prefName, value) {
          localStorage[prefName] = value;
        }
      };
    }
    return window.jvPrefs;
  } else {
    var prefsvc = Components.classes["@mozilla.org/preferences-service;1"].
      getService(Components.interfaces.nsIPrefService);

    return prefsvc.getBranch("extensions.jv.");
  }
}

function getEnabledPref() {
  // Default to on when installed.
  if (isChrome() && !getPrefs().prefSet("enabled"))
    return true;
  return getPrefs().getBoolPref("enabled");
}

function saveEnabledPref(enabled) {
  getPrefs().setBoolPref("enabled", enabled);
}

function isEnabled() {
  if (isChrome()) {
    if (!jsvim.enabled) {
      return false;
    }
  } else if (!getEnabledPref()) {
    return false;
  }
  return this.lenabled;
}

// Not used in Chrome.
function updateEditorPrefs() {
  var i;
  popup("in updateEditorPrefs");
  if (!this.e) {
    // disabled
    return;
  }
  if (!this.updateEpoch) {
    this.updateEpoch = 1;
  }
  if (this.updateEpoch != this.getVar(this.VarNames.UPDATE_EPOCH)) {
    for (i = 0; i < prefs.length; ++i) {
      var pref = prefs[i];
      this[prefs[i].varName] =
        (pref.isBool) ?
        getPrefs().getBoolPref(prefs[i].prefName) :
        getPrefs().getStringPref(prefs[i].prefName);
      if (prefs[i].onUpdate) {
        prefs[i].onUpdate(this);
      }
    }
    this.setVar(this.VarNames.UPDATE_EPOCH, this.updateEpoch);
  }
}

function notifyAll(enabled) {
  try {
    // Enabled is already stored, so we don't need to send it.
    if (isChrome()) {
      chrome.extension.sendRequest({"message" : "preferencesChanged"});
      return;
    }

    var wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]
      .getService(Components.interfaces.nsIWindowMediator);
    var enumerator = wm.getEnumerator("navigator:browser");
    if (enumerator) {
      while (enumerator.hasMoreElements()) {
        var w = enumerator.getNext();
        if (w && w.jsvim) {
          var epoch = w.jsvim.updateEpoch;
          if (!epoch) {
            epoch = 1;
          }
          w.jsvim.updateEpoch = epoch + 1;
          w.jsvim.updatePopup();
          w.jsvim.updateIcon();
          w.jsvim.updateEditorPrefs();
          if (!enabled) {
            w.removeEventListener("focus", w.jsvim, true);
            w.removeEventListener("keypress", w.jsvim, true);
            w.removeEventListener("click", w.jsvim, true);
          } else {
            w.addEventListener("focus", w.jsvim, true);
            w.addEventListener("keypress", w.jsvim, true);
            w.addEventListener("click", w.jsvim, true);
          }
        }
      }
    }
  } catch (ex) {
    // TODO: Should this be a popup?
    _debug(stringifyObj(ex));
  }
  
}
