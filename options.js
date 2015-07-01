function localSetup() {
  document.getElementById("jv-settings-checkbox").addEventListener("change",
      jv_EnabledToggled);
  document.getElementById("jv-settings-save-button").addEventListener("click",
      jv_saveSettings);
  jv_checkSettings();
}

document.addEventListener('DOMContentLoaded', localSetup);
