function jv_aboutKeypress(evt) {
  if (evt.keyCode == evt.DOM_VK_ESCAPE)
    window.close();
}

window.addEventListener("keypress", jv_aboutKeypress, true);
