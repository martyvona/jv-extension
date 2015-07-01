_debug("Setting up settings.");

function disableOption(disabled, containerId) {
  if (isChrome()) {
    elts = document.options_form[containerId];
    if (!elts.length) {
      elts.disabled = disabled;
    }
    for (var i = 0; i < elts.length; ++i) {
      elts[i].disabled = disabled;
    }
  } else {
    document.getElementById(containerId).disabled = disabled;
  }
}

function setAllDisabled(disabled) {
  var i;
  for (i = 0; i < prefs.length; ++i) {
    disableOption(disabled, prefs[i].containerId);
  }
}

function setupBoolPref(pref) {
  var value = getPrefs().getBoolPref(pref.prefName);
  if (isChrome()) {
    var true_elt = document.getElementById(pref.trueId);
    var false_elt = document.getElementById(pref.falseId);
    if (getPrefs().prefSet(pref.prefName)) { // Else leave the defaults.
      if (true_elt) {
        true_elt.checked = value;
      }
      if (false_elt) {
        false_elt.checked = !value;
      }
    } else {
      getPrefs().setBoolPref(pref.prefName, (true_elt && true_elt.checked));
    }
  } else {
    var group = document.getElementById(pref.containerId);
    if (!group) {
      var true_elt = document.getElementById(pref.trueId);
      var false_elt = document.getElementById(pref.falseId);
      if (true_elt) {
        true_elt.checked = value;
      }
      if (false_elt) {
        false_elt.checked = !value;
      }
      if (!true_elt && !false_elt) {
        alert("Couldn't find " + pref.containerId);
      }
      return;
    }
    var elt;
    if (value) {
      elt = document.getElementById(pref.trueId);
    }
    if (!elt || !value) {
      elt = document.getElementById(pref.falseId);
    }
    if (!elt) { // bad pref?
      alert("Failed to find " + pref.trueId + " or " + pref.falseId);
      elt = document.getElementById(pref.trueId);
    }
    if (elt) {
      group.selectedItem = elt;
    }
  }
}

function setupStringPref(pref) {
  var value = getPrefs().getStringPref(pref.prefName);
  var elt = document.getElementById(pref.containerId);
  if (getPrefs().prefSet(pref.prefName)) { // Else leave the defaults.
    elt.value = value;
  } else {
    getPrefs().setStringPref(pref.prefName, elt.value);
  }
}

function saveBoolPref(pref) {
  var elt = document.getElementById(pref.trueId);
  getPrefs().setBoolPref(pref.prefName,
      isChrome() ? elt.checked : elt.selected);
}

function saveStringPref(pref) {
  var elt = document.getElementById(pref.containerId);
  getPrefs().setStringPref(pref.prefName, elt.value);
}

function saveEnableFlag() {
  var elt = document.getElementById("jv-settings-checkbox");
  if (!elt) {
    alert("Couldn't find checkbox!");
    return;
  }
  var enabled = getEnabledPref();
  if (elt.checked != enabled) {
    enabled = elt.checked;
    saveEnabledPref(enabled);
  }
  return enabled;
}

function jv_checkSettings() {
  //dumpLocalStorage();
  var i;
  try {
    for (i = 0; i < prefs.length; ++i) {
      if (prefs[i].isBool)
        setupBoolPref(prefs[i]);
      else
        setupStringPref(prefs[i]);
    }
    // set 'enabled' checkbox
    var elt = document.getElementById("jv-settings-checkbox");
    if (!elt) {
      alert("missing elt!");
    }
    var enabled = getEnabledPref();
    if (elt) {
      elt.checked = enabled;
    }
    setAllDisabled(!enabled);
  } catch (ex) {
    popup(stringifyObj(ex));
  }
}

function jv_EnabledToggled() {
  var elt = document.getElementById("jv-settings-checkbox");
  if (!elt) {
    alert("Couldn't find checkbox!");
    return;
  }
  setAllDisabled(!elt.checked);
}

function jv_saveSettings() {
  // Radio buttons first
  var i;
  for (i = 0; i < prefs.length; ++i) {
    if (prefs[i].isBool)
      saveBoolPref(prefs[i]);
    else
      saveStringPref(prefs[i]);
  }

  // Now the global enable flag
  var enabled = saveEnableFlag();

  // Now tell everybody
  notifyAll(enabled);
}

if (!isChrome()) {
  function jv_settingsKeypress(evt) {
    if (evt.keyCode == evt.DOM_VK_ESCAPE)
      window.close();
  }

  window.addEventListener("keypress", jv_settingsKeypress, true);
  window.addEventListener("load", jv_checkSettings, true);
}

_debug("Set up settings.");
