function onReadEnables(enables) {
  document.getElementById("local").checked = enables.local;
  document.getElementById("global").checked = enables.global;
}
// We just fire off a request to the tab, and accept the answer from any
// script that answers.  If there's more than on iframe, whoever answers
// first wins.  Or maybe Chrome just picks one to talk to; I don't know.
function setUpCheckboxes() {
  document.getElementById("global").addEventListener("click",
    function () {
      onButtonClicked("global");
    });
  document.getElementById("local").addEventListener("click",
    function () {
      onButtonClicked("local");
    });
  chrome.tabs.getSelected(null, function(tab) {
    chrome.tabs.sendRequest(tab.id,
                            {"message" : "read_enables"},
                            onReadEnables);
  });
}

// This request proxies through the background page, so that it'll reach
// all iframes in the tab.
function onButtonClicked(which) {
  chrome.tabs.getSelected(null, function(tab) {
    chrome.extension.sendRequest({"message" : "toggle_enable",
                                   "data" : which,
                                   "tabId" : tab.id} );
    window.close();
  });
}

document.addEventListener('DOMContentLoaded', setUpCheckboxes);
