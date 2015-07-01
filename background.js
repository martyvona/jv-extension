var portInfo = {};
var nextPort = 0;

function musterPrefs() {
  var p = getPrefs();
  var data = {};
  for (var i=0; i < prefs.length; ++i) {
    data[prefs[i].varName] =
      (prefs[i].isBool) ?
      p.getBoolPref(prefs[i].prefName) : p.getStringPref(prefs[i].prefName);
  }
  data.enabled = getEnabledPref();
  var msg = {
    "message" : "preferences",
    "data" : data
  };
  return msg;
}

function broadcastSettings() {
  var prefs = musterPrefs();
  for (entry in portInfo) {
    portInfo[entry].port.postMessage(prefs);
  }
}

function onPortMessage(request, portIndex, port, tabId) {
  if (tabId < 0) {
    // This happens during some chrome instant search requests.  I think the
    // tab either vanishes before the message gets here or has an invalid
    // tabId due to some internal magic.  At any rate, let's just ignore
    // these, as we can't do anything useful with them.
    return;
  }
  try {
    switch(request.message) {
      case "requestPreferences":
        port.postMessage(musterPrefs());
        break;
      case "setEnabled":
        saveEnabledPref(request.data);
        broadcastSettings();
        break;
      case "updatePageAction":
        updateActionDisplay(request.data, portInfo[portIndex].tabId);
        break;
      case "showPageAction":
        chrome.pageAction.show(portInfo[portIndex].tabId);
        break;
      case "setClipboard":
        setClipboard(request.data);
        break;
      case "getClipboard":
        port.postMessage(getClipboard());
        break;
      default:
        popup("Got unknown request: " + stringifyObj(request));
        break;
    }
  } catch (ex) {
    popup(ex);
  }
}

function updateActionDisplay(enabled, tab) {
  var icon;
  var text;
  switch(enabled) {
    case "enabled":
      icon = 'statusbar-active.png';
      text = 'jV is on';
      break;
    case "disabled":
      icon = 'statusbar-inactive.png';
      text = 'jV is off';
      break;
    case "locally_disabled":
      icon = 'statusbar-locally-inactive.png';
      text = 'jV is disabled for this tab';
      break;
    case "disallowed_just_eat_esc":
      icon = 'statusbar-locally-inactive.png';
      text = 'jV is disabled for this tab, but is still eating ESC to avoid inadvertent window closing';
      break;
    default:
      popup("didn't recognize enabled state '" + enabled + "'!");
      assert(false);
  }
  chrome.pageAction.setTitle({tabId: tab, title: text});
  chrome.pageAction.setIcon({tabId: tab, path: icon});
}

function setClipboard(text) {
  var elt = document.getElementById("clipboard");
  elt.value = text;
  elt.select();
  document.execCommand("Copy");
}

function getClipboard() {
  var elt = document.getElementById("clipboard");
  elt.value = "";
  elt.select();
  document.execCommand("Paste");
  var msg = {
    "message" : "clipboardState",
    "data" : elt.value
  };
  return msg;
}

function onDisconnect(portIndex) {
  assert(portInfo[portIndex]);
  delete portInfo[portIndex]; // Should only happen when the tab's closed.
}

function onScriptConnected(port) {
  var portIndex = nextPort;
  var localPort = port;
  var localTabId = port.sender.tab.id;
  portInfo[portIndex] = { port : port, tabId : port.sender.tab.id};
  port.onMessage.addListener(function(msg) {
    onPortMessage(msg, portIndex, localPort, localTabId);
  });
  port.onDisconnect.addListener(function() {
    onDisconnect(portIndex);
  });
  ++nextPort;
}

function onExtensionRequest(message, sender, sendResponse) {
  try {
    switch(message.message) {
    case "preferencesChanged":
      broadcastSettings();
      break;
    case "toggle_enable":
      for (var entry in portInfo) {
        if (portInfo[entry].tabId == message.tabId) {
          // Don't break--we could have multiple iframes in a single tab.
          portInfo[entry].port.postMessage(message);
        }
      }
      break;
    default:
      popup("Background.html got unknown request: " +
          stringifyObj(request));
      break;
    }
  } catch (ex) {
    popup(ex);
  }
  sendResponse({});
}

chrome.extension.onRequest.addListener(onExtensionRequest);
chrome.extension.onConnect.addListener(onScriptConnected);

// Clean up from previous extension loads--remove when crbug.com/75329 is
// fixed.
chrome.windows.getAll({populate: true}, function(windows) {
  for (var i=0; i < windows.length; ++i) {
    for (var j=0; j < windows[i].tabs.length; ++j) {
      chrome.pageAction.hide(windows[i].tabs[j].id);
    }
  }
});
