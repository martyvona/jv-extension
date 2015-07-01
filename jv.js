/* ***** BEGIN LICENSE BLOCK *****
  Version: GPL 2.0

  This license covers jV, a text editor browser extension.

  Copyright (C) 2013
    Eric Uhrhane,
    Google Inc.,
    Marsette Vona (martyvona@gmail.com)
  Copyright (C) 2012-2013 Eric Uhrhane and Google Inc.
  Copyright (C) 2007-2011 Eric Uhrhane

  This program is free software; you can redistribute it and/or
  modify it under the terms of the GNU General Public License
  as published by the Free Software Foundation; either version 2
  of the License, or (at your option) any later version.

  This program is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU General Public License for more details.

  You should have received a copy of the GNU General Public License
  along with this program; if not, write to the Free Software
  Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
  ***** END LICENSE BLOCK *****/

/*
Feature requests:
  change textarea cursor
  : commands
  work around Firefox spellchecker not doing anything until space after word
  Any j/DOWN/ENTER that can't move should prompt a scroll in the appropriate
    direction [to the max?], to handle wrapped lines at the bottom.
  Add a menu item for preferences to the context menu.

Commands in command mode:
  + - % , [[ ]] { } H L M >> << U m <motion >motion { }
  gq, gk, gj, gI [same as gi?]
  z. z<CR> z-
  gqmotion

Commands in insert mode:
  C-w C-space (C-@) C-v ^u

Colon commands:
  :mode

Preferences:
  allow backspace out of added region (bs=2 or bs=indent,eol,start).
  shiftwidth
  textwidth [just for gq at first]
  no flash on backspace at start of buffer
*/

// Implemented:
//  hjklbBeEwWiIJaAoOpPdcsyDCSYxX0$.RrtTfF;/?nN~|^vV, home, end, del, arrow
//  keys, numbers, escape, ^c, u, ^r, ^[, "[a-z.+*/], G, gg, {^b,^d,^e,^f,^u,^y}
//  [normal mode only].
// Top TODOs [beyond bugs]:
//   >>, << [by how far?]
//   For chrome: clipboard support, now that the API's out of experimental
// Nice-to-haves:
//   Detect if an outside event [such as a paste from the edit menu] has altered
//   the textarea, and do something about it to clean up the undo stack.
//   q<reg>, @, ^a, ^x, \,.
//   Preferences for whitelisting, ts, sw, et.
//   Optional case-insensitive search.
// Much later:
//   advanced search [*, #]
//   m, '
//   :<number>
//   :'<'>s/// or :%s///
//   z*
//   %

// Known incompatibilities:
//   Search strings are Javascript regular expressions, not Vi[m] syntax.
//
//   Scrolling commands scroll by a number of visible lines, not newlines.
//
//   W, w, e don't complain at EOF.
//
//   Ctrl+{home, end} do the wrong thing.
//
//   When using arrow keys, home, and end in insert mode, the multiplier
//   should be ignored, but stored for repeats IFF no text is typed after
//   the arrow keys but before Escape.  We currently ignore it entirely.
//
//   Commands dw, cw on empty line do nothing but flash.  Should delete the
//   whole line [including preceding spaces!] for some reason.
//
//   Redo of an undone 'O' will leave the cursor in the place it was before the
//   original action was done, but measured by #chars-from-beginning-of-file,
//   whereas vim measures it by line-and-#chars-from-beginning-of-line.
//
//   When attempting an illegal or unsupported command in visual mode, visual
//   mode is cancelled.  Vim merely beeps.
//
//   Vim accepts 5"a6"sdd, deleting 30 lines and storing it in s.  I abort when
//   presented with more than one register in a command.

// element is null in the extension case, and in that of the hack holder below.
function JsVim(element) {
  // Registers are shared among all the textareas in a given window.
  this.regs = new Object();
  this.regsLinewise = new Object();
  this.e = element;
  this.lenabled = true;
  return this;
}

// This global variable holds a reference to e, the element affected by the
// current event.  It starts with no element, and will have its element replaced
// as needed as events come in.  It's the [per-window in FF, per-iframe in
// Chrome] extension object in the extension case.
var jsvim = new JsVim();

(function () {
  /* Persistent variable names.

     In command 55"a66d5l, the elements are N0(55), REG(a), N1(66), CMD(d),
     N2(5), MOTION(l).  N[012] are multiplied together to get MUL.
  */
  var VarNames = {
    MODE : "MODE",
    COL : "COL", // for use in moving up+down, when past/at $ on current line
    MUL : "MUL",
    REG : "REG",
    CMD : "CMD",
    MOTION : "MOTION",
    COMBO_CMD_CHAR : "COMBO_CMD_CHAR", // So far only g, for gg, but z,] later.
    INPUT_CHAR_CODE : "INPUT_CHAR_CODE", // So far used only by r.
    OVER : 'OVER', // stores text overwritten by R
    OVER_EXTEND_CHARS : 'OVER_EXTEND_CHARS', // num chars added at EOLN by R
    SEEK : "SEEK", // tTfF
    SEEK_CHAR : "SEEK_CHAR", // the char being sought
    SEARCH : "SEARCH", // ?/
    SEARCH_STR : "SEARCH_STR",
    SEARCH_START_POS : "SEARCH_START_POS",
    FLICKER_START_SEL : "FLICKER_START_SEL",
    FLICKER_END_SEL : "FLICKER_END_SEL",
    LAST_MUL : "LAST_MUL",
    LAST_REG : "LAST_REG",
    LAST_CMD : "LAST_CMD",
    LAST_MOTION : "LAST_MOTION",
    LAST_INPUT_CHAR_CODE : "LAST_INPUT_CHAR_CODE", // So far used only by r.
    LAST_SEEK : "LAST_SEEK",
    LAST_SEEK_CHAR : "LAST_SEEK_CHAR",
    LAST_SEARCH : "LAST_SEARCH",
    LAST_SEARCH_STR : "LAST_SEARCH_STR",
    LAST_DEL_CHARS : "LAST_DEL_CHARS",
    LAST_VISUAL_DX : "LAST_VISUAL_DX", // Stored for "." after visual action.
    LAST_VISUAL_DY : "LAST_VISUAL_DY", // Stored for "." after visual action.
    CUR_NUM : "CUR_NUM", // In-progress number so far, if any.
    BEEPING : "BEEPING",
    VISUAL : "VISUAL", // vV
    VISUAL_USED : "VISUAL_USED", // vV; held here past clear of VISUAL for DOT.
    VISUAL_START_POS : "VISUAL_START_POS",
    VISUAL_END_POS : "VISUAL_END_POS",
    VISUAL_DX : "VISUAL_DX", // Stored for "." after visual action.
    VISUAL_DY : "VISUAL_DY", // Stored for "." after visual action.
    UNDO_START : "UNDO_START",
    UNDO_END : "UNDO_END",
    UNDO_TEXT : "UNDO_TEXT",
    UNDO_DEL_CHARS : "UNDO_DEL_CHARS",
    // If the undo record that of an 'o' or 'O', this is set to the cursor
    // position current before the action, otherwise null.
    UNDO_O : "UNDO_O",
    // In-progress undo record, for compound actions that make non-contiguous
    // changes, otherwise null.  Currently only used for 'J'.
    UNDO_RECORD : "UNDO_RECORD",

    LINE_HEIGHT : "LINE_HEIGHT", // Currently only used as a backup.

    STATUS_BAR : "STATUS_BAR",
    UPDATE_EPOCH : "UPDATE_EPOCH", // Used to detect preference changes.

    // A variable on the element, not the jsvim object
    JV_REMOVAL_FUNCTION : "JV_REMOVAL_FUNCTION",
  };

  // Names of modes
  // We may need one for "Got reg".
  var ModeNames = {
    COMMAND : "COMMAND",     // Used before and between states; may have CMD.
    INSERT : "INSERT",       // In insert mode.
    IN_REG : "IN_REG",       // We just got a ".
    IN_NUM : "IN_NUM",       // Gotten at least one digit, not starting with 0.
    OVERWRITE : "OVERWRITE", // Got R.*.
    SEEK : "SEEK",           // tTfF
    SEARCH : "SEARCH",       // ?/
  };

  // Names of named registers
  var RegNames = {
    DEF : '"',
    INS : '.',
    CLIP : '+',                // System clipboard on any OS.
    SEL : '*',                 // X Selection on systems that support it.
    SEEK : 'SEEK',             // Not retrievable directly.
    SEEK_CHAR : 'SEEK_CHAR',   // Not retrievable directly.
    SEARCH : 'SEARCH',         // Not retrievable directly.
    SEARCH_STR : 'SEARCH_STR', // User types '/', though.
  };

  var Consts = {
    EOLN : '\n',
    EMPTY : "",
    SPACE : ' ',
    BACKSLASH : '\\',
    WHITE : "white",
    BLACK : "black",
    DONE : "DONE", // Thrown by abortCommand.
    SEEK : "SEEK",     // so that code looking at MOTION doesn't get confused
    SEARCH : "SEARCH", // so that code looking at MOTION doesn't get confused
    VISUAL : "VISUAL", // so that code looking at MOTION doesn't get confused
    KEYCODE : "KEYCODE",
    CHARCODE : "CHARCODE",
    BGCOLOR : "#faf6f2" //fae2c8 fff9f9 fff7f7
  };

  var Combos = {
    gg : "gg",
  };

  var Keys = {
    CTRL_B  : 2,      
    CTRL_C  : 3,      
    CTRL_D  : 4,      
    CTRL_E  : 5,      
    CTRL_F  : 6,      
    BS      : 8,      
    TAB     : 9,  // Same as the KeyCode.    
    LF      : 10,     
    CR      : 13,     
    CTRL_R  : 18,      
    CTRL_T  : 20,      
    CTRL_U  : 21,      
    CTRL_V  : 22,      
    CTRL_Y  : 25,      
    ESC     : 27, // Same as the KeyCode.
    SPACE   : 32,     
    QUOTES  : 34,     
    DOLLAR  : 36,     
    PERCENT : 37,     
    L_PAREN : 40,     
    R_PAREN : 41,     
    STAR    : 42,     
    PLUS    : 43,     
    DOT     : 46,     
    SLASH   : 47,     
    N_0     : 48,     
    N_1     : 49,     
    N_2     : 50,     
    N_3     : 51,     
    N_4     : 52,     
    N_5     : 53,     
    N_6     : 54,     
    N_7     : 55,     
    N_8     : 56,     
    N_9     : 57,     
    SEMI    : 59,     
    QUEST   : 63,     
    A       : 65,     
    B       : 66,     
    C       : 67,     
    D       : 68,     
    E       : 69,     
    F       : 70,     
    G       : 71,     
    H       : 72,     
    I       : 73,     
    J       : 74,     
    K       : 75,     
    L       : 76,     
    M       : 77,     
    N       : 78,     
    O       : 79,     
    P       : 80,     
    Q       : 81,     
    R       : 82,     
    S       : 83,     
    T       : 84,     
    U       : 85,     
    V       : 86,     
    W       : 87,     
    X       : 88,     
    Y       : 89,     
    Z       : 90,     
    L_BRAC  : 91,     
    R_BRAC  : 93,     
    CARET   : 94,     
    a       : 97,     
    b       : 98,     
    c       : 99,     
    d       : 100,    
    e       : 101,    
    f       : 102,    
    g       : 103,    
    h       : 104,    
    i       : 105,    
    j       : 106,    
    k       : 107,    
    l       : 108,    
    m       : 109,    
    n       : 110,    
    o       : 111,    
    p       : 112,    
    q       : 113,    
    r       : 114,    
    s       : 115,    
    t       : 116,    
    u       : 117,    
    v       : 118,    
    w       : 119,    
    x       : 120,    
    y       : 121,    
    z       : 122,    
    L_BRACE : 123,    
    PIPE    : 124,    
    R_BRACE : 125,    
    TILDE   : 126,    
  };

  var KeyCodes = {
    BS     :   8, // Same as the Key.
    TAB    :   9, // Same as the Key.
    SHIFT   : 16,
    CTRL    : 17,
    ALT     : 18, // Beware!  This looks like CTRL_R after we remap it!
                  // TODO: In chrome, we think CTRL+ALT is CTLR_R.
    PAUSE   : 19,
    CAPS_LK : 20,
    ESC     : 27, // Same as the Key.
    ARROW_L : 37,
    ARROW_U : 38,
    ARROW_R : 39,
    ARROW_D : 40,
    PAGE_U  : 33,
    PAGE_D  : 34,
    END     : 35,
    HOME    : 36,
    INS     : 45,
    DEL     : 46,
    NUM_LK  : 144,
    L_BRAC  : 219,
    R_BRAC  : 221,
  };

  function getQueue() {
    if (!this.e.queue) {
      this.e.queue = new Queue(20);
    }
    return this.e.queue;
  }

  function getVar(key, def) {
    if (!this.e.vars) {
      this.e.vars = new Object();
    }
    var ret = this.e.vars[key];
    if (ret == null) {
      ret = def;
    }
    return ret;
  }

  function setVar(key, value) {
    if (!this.e.vars) {
      this.e.vars = new Object();
    }
    this.e.vars[key] = value;
  }

  function clearVar(key) {
    if (!this.e.vars) {
      this.e.vars = new Object();
    }
    this.e.vars[key] = null;
  }

  function getReg(reg) {
    if (reg == RegNames.SEL && this.getXSelection) {
      return this.getXSelection();
    } else if (reg == RegNames.CLIP && this.getClipboard) {
      return this.getClipboard();
    }
    if (reg == null) {
      reg = RegNames.DEF;
    }
    var ret = this.regs[reg];
    if (ret == null) {
      ret = Consts.EMPTY;
    }
    return ret;
  }

  function regIsLinewise(reg) {
    if (reg == null) {
      reg = RegNames.DEF;
    }
    return this.regsLinewise[reg];
  }

  function setReg(reg, value, linewise) {
    if (reg == RegNames.SEL && this.setXSelection) {
      this.setXSelection(value);
    } else if (reg == RegNames.CLIP && this.setClipboard) {
      this.setClipboard(value);
    } else {
      this.regs[reg] = value;
    }
    // This can get out of sync with the system clipboard, but there isn't
    // really much we can do about it, and it's just not that big a deal.
    this.regsLinewise[reg] = linewise;
  }

  function getMode() {
    var mode = this.getVar(VarNames.MODE);
    if (!mode) {
      if (this.defaultModeInsert) {
        mode = ModeNames.INSERT;
        this.setVar(VarNames.CMD, Keys.i);
        this.endNonTextCommand(true, mode);
        this.setMode(ModeNames.INSERT);
      } else {
        mode = ModeNames.COMMAND;
      }
    }
    return mode;
  }

  function setMode(mode) {
    if (mode == ModeNames.INSERT || mode == ModeNames.OVERWRITE) {
      this.clearVar(VarNames.COL);
    }
    this.setVar(VarNames.MODE, mode);
    this.updateStatusBar(mode);
  }

  var flickering = false;
  var flickerOffset;

  function doFlicker(element) {
    try {
      if (flickering) {
        popup("doFlicker was REENTRANT!");
        return;
      } else if (!element) {
        popup("doFlicker: element was null!");
        return;
      } else if (!flickerTimeoutId) {
        popup("doFlicker: no flickerTimeoutId implies failed cancel!");
        return;
      }

      this.setTextArea(element);
      flickering = true;
      var start = this.getSelectionStart();
      var end = this.getSelectionEnd();
      var pos = this.getCursorPos();
      if (pos == this.getMaxPos()) {
        scrollToBottom(this.e);
        return; // No need to flicker!
      }
      this.setVar(VarNames.FLICKER_START_SEL, start);
      this.setVar(VarNames.FLICKER_END_SEL, end);
      // Note the use of setSelection, not setCursorPos, so as to get around any
      // special variables.
      this.setSelection(pos + 1, pos + 1);
      var keyCode = KeyCodes.ARROW_L;
      var charCode = 0;
      this.sendKeyEvent(element, keyCode, charCode);
      //element.focus();
    } catch (ex) {
      popup("Error in doFlicker:\n" + stringifyObj(ex));
    } finally {
      flickering = false;
    }
  }

  var flickerTimeoutId = null;
  function flicker(element) {
    if (flickerTimeoutId) {
      clearTimeout(flickerTimeoutId);
      if (!flickerTimeoutId) {
        // This should be impossible, as javascript isn't preemptive.
        popup("FAILED to flicker due to race.");
        return;
      } else {
        // Successfully cancelled
        flickerTimeoutId = null;
      }
    }
    var temp = this;
    flickerTimeoutId = setTimeout(
      function () {
        temp.doFlicker(element);
        flickerTimeoutId = null;
      },
      100); // Wait until idle for a bit before flickering.
  }

  function sendKeyEvent(element, keyCode, charCode) {
    var e = document.createEvent("KeyboardEvent");
    var type = "keypress";
    var bubbles = true;
    var cancellable = true;
    var view = null;
    var ctrl = false;
    var alt = false;
    var shift = false;
    var meta = false;
    // These really only work for a small range--zero-padding should be
    // adaptive, and alpha values need to be case-folded.  But this function's
    // only ever called for left-arrow, so no biggie.
    var keyLocation = '0x00';
    var keyIdentifier = 'U+00' + keyCode.toString(16).toUpperCase();

    eventToIgnore = e;
    if (e.initKeyEvent) {
      e.initKeyEvent(type, bubbles, cancellable, view, ctrl, alt, shift, meta,
          keyCode, charCode);
    } else {
      // Focus/blur pair courtesy of
      // http://stackoverflow.com/questions/2692009/move-caret-to-the-end-of-a-text-input-field-and-make-the-end-visible.
      if (!element.jv_divhack) {
        this.e.blur();
        this.e.focus();
      } //else divhackDBG("killing focus/blur!");
      e.initKeyboardEvent(type, bubbles, cancellable, view, keyIdentifier,
          keyLocation, ctrl, alt, shift, meta);
    }
    element.dispatchEvent(e);
  }

  function beepOn() {
    if (!this.getVar(VarNames.BEEPING)) {
      this.setVar(VarNames.BEEPING, 1);

      var style = this.e.style;
      var temp = style.color;
      style.color = style.backgroundColor;
      style.backgroundColor = temp;
      if (!style.color) {
        style.color = Consts.WHITE;
      }
      if (!style.backgroundColor) {
        style.backgroundColor = Consts.BLACK;
      }
    }
  }

  function beepOff() {
    if (this.getVar(VarNames.BEEPING)) {
      this.setVar(VarNames.BEEPING, 0);

      var style = this.e.style;
      var temp = style.color;
      style.color = style.backgroundColor;
      style.backgroundColor = temp;
    }
  }

  function beep() {
    if (!this.inhibitVisualBell) {
      this.beepOn();
      temp = this;
      setTimeout(
        function() {
          temp.beepOff();
        }, 75);
    }
  }

  function clearVisualVars() {
    this.clearVar(VarNames.VISUAL);
    this.clearVar(VarNames.VISUAL_START_POS);
    this.clearVar(VarNames.VISUAL_END_POS);
  }

  // This doesn't clear undo vars, but so far there's nothing that would set
  // them that could be aborted.
  function clearCmdVars(clearVisual) {
    this.clearVar(VarNames.MUL);
    this.clearVar(VarNames.REG);
    this.clearVar(VarNames.CMD);
    this.clearVar(VarNames.MOTION);
    this.clearVar(VarNames.CUR_NUM);
    this.clearVar(VarNames.COMBO_CMD_CHAR);
    this.clearVar(VarNames.SEARCH_START_POS);
    if (clearVisual) {
      this.clearVisualVars();
    }
  }

  function storeCmdVars() {
    var cmd = this.getVar(VarNames.CMD);
    var reg;
    var mul;
    var motion;
    var inputCharCode;
    var seek;
    var seekChar;
    var search;
    var searchStr;
    var delChars;
    var visualDX;
    var visualDY;
    if (cmd == Keys.DOT) {
      cmd = this.getVar(VarNames.LAST_CMD);
      reg = this.getVar(VarNames.LAST_REG);
      mul = this.getVar(VarNames.MUL, this.getVar(VarNames.LAST_MUL));
      motion = this.getVar(VarNames.LAST_MOTION);
      inputCharCode = this.getVar(VarNames.LAST_INPUT_CHAR_CODE);
      seek = this.getVar(VarNames.LAST_SEEK);
      seekChar = this.getVar(VarNames.LAST_SEEK_CHAR);
      search = this.getVar(VarNames.LAST_SEARCH);
      searchStr = this.getVar(VarNames.LAST_SEARCH_STR);
      delChars = this.getVar(VarNames.LAST_DEL_CHARS);
      visualDX = this.getVar(VarNames.LAST_VISUAL_DX);
      visualDY = this.getVar(VarNames.LAST_VISUAL_DY);
      visual = this.getVar(VarNames.LAST_VISUAL_USED);
    } else {
      reg = this.getVar(VarNames.REG);
      mul = this.getVar(VarNames.MUL);
      motion = this.getVar(VarNames.MOTION);
      inputCharCode = this.getVar(VarNames.INPUT_CHAR_CODE);
      seek = this.getVar(VarNames.SEEK);
      seekChar = this.getVar(VarNames.SEEK_CHAR);
      search = this.getVar(VarNames.SEARCH);
      searchStr = this.getVar(VarNames.SEARCH_STR);
      visualDX = this.getVar(VarNames.VISUAL_DX);
      visualDY = this.getVar(VarNames.VISUAL_DY);
      visual = this.getVar(VarNames.VISUAL_USED);
      // We don't store DEL_CHARS here, since we don't know it yet.  The user
      // has typed e.g. 'cw', but hasn't gotten to the DEL chars yet.  Therefore
      // we only ever use LAST_DEL_CHARS, and we set it directly as it's
      // discovered.  However, if the user's using DOT, we know to keep
      // LAST_DEL_CHARS around.
    }
    this.setVar(VarNames.LAST_REG, reg);
    this.setVar(VarNames.LAST_MUL, mul);
    this.setVar(VarNames.LAST_CMD, cmd);
    this.setVar(VarNames.LAST_MOTION, motion);
    this.setVar(VarNames.LAST_INPUT_CHAR_CODE, inputCharCode);
    this.setVar(VarNames.LAST_SEEK, seek);
    this.setVar(VarNames.LAST_SEEK_CHAR, seekChar);
    this.setVar(VarNames.LAST_SEARCH, search);
    this.setVar(VarNames.LAST_SEARCH_STR, searchStr);
    this.setVar(VarNames.LAST_DEL_CHARS, delChars);
    this.setVar(VarNames.LAST_VISUAL_DX, visualDX);
    this.setVar(VarNames.LAST_VISUAL_DY, visualDY);
    this.setVar(VarNames.LAST_VISUAL_USED, visual);
  }

  // This is the normal end of a command [where you end up if you're going back
  // to command mode, but not via a repeated insert or overwrite].
  function endNonTextCommand(repeatable, mode) {
    var wasUndoRedo;
    if (repeatable) {
      this.storeCmdVars();
    }
    var cmd = this.getVar(VarNames.CMD);
    if (cmd == Keys.u || cmd == Keys.CTRL_R) {
      wasUndoRedo = true;
    }
    this.clearCmdVars();
    if (mode == ModeNames.INSERT) {
      this.setReg(RegNames.INS, Consts.EMPTY);
    } else if (mode == ModeNames.OVERWRITE) {
      this.setReg(RegNames.INS, Consts.EMPTY);
      this.setVar(VarNames.OVER, Consts.EMPTY);
      this.setVar(VarNames.OVER_EXTEND_CHARS, 0);
    }
    return wasUndoRedo;
  }

  function endCommand(mode, repeatable, special) {
    var curMode = this.getMode();
    var wasUndoRedo;
    // TODO: This comment is somewhat out of date.
    // special is the flag that we're using arrow keys in insert mode, so
    // we're going to skip the multiplier, but save the multiplied command that
    // got us into insert mode as the command to remember.  The subsequent stuff
    // gets forgotten [repeatable == false when that comes through].
    if (curMode == ModeNames.INSERT || curMode == ModeNames.OVERWRITE) {
      // Vars are already cleared, but we may have more to do.
      var oldCmd = this.getVar(VarNames.LAST_CMD);
      var mul = this.getVar(VarNames.LAST_MUL, 1) - 1;
      var start = this.getCursorPos();
      var end = start;
      if (!special && mul > 0 && oldCmd && isRepeatableInsertCommand(oldCmd)) {
        var newText = this.getReg(RegNames.INS);
        if (newText.length > 0) {
          if (oldCmd == Keys.O || oldCmd == Keys.o) {
            newText = Consts.EOLN + newText;
          }
          var single = newText;
          for (var i=1; i < mul; ++i) {
            newText += single;
          }
          var endPos = start + newText.length;
          if (curMode == ModeNames.OVERWRITE) {
            end = endPos;
            var oldText = this.getRange(start, end);
            var eoln = oldText.indexOf(Consts.EOLN);
            if (eoln != -1) {
              if (curMode == ModeNames.OVERWRITE) {
                end = start + eoln;
              } else {
                // Undo the already-done deletion.
                // Looks like this is invoked in "2[Rr]<x>[<Esc>].".
                // So you're trying to do a multi-char replace/overwrite at the
                // end of a line, but there isn't space, so we abort.
                this.replaceRange(start - 1, start, this.getVar(VarNames.OVER));
                this.setCursorPos(start - 1);
                this.abortCommand();
              }
            }
          }
          this.replaceRange(start, end, newText);
          this.setCursorPos(endPos);
        }
      }
      if (!special) {
        this.setCursorPos(this.safeBackUp());
      }
      this.clearVar(VarNames.COL);
      if (special) {
        // Nuke the mul.  We should really keep it around for some rare
        // circumstances, but that can wait.
        this.clearVar(VarNames.LAST_MUL);
      }
    } else {
      wasUndoRedo = this.endNonTextCommand(repeatable, mode);
    }
    this.setMode(mode);
    if (mode == ModeNames.COMMAND && !wasUndoRedo) {
      this.pushUndoState();
    }
  }

  function abortCommand(quiet) {
    if (!quiet) {
      this.beep();
    }
    this.clearCmdVars(true);
    this.setCursorPos(this.getCursorPos()); // Clear highlight.
    this.setMode(ModeNames.COMMAND);
    throw Consts.DONE;
  }

  function handleUnrecognizedChar() {
    // Used to do something different here, but it ended up not needed.  todo:
    // figure out something better to do, or just inline this.
    this.abortCommand();
  }

  function setCursorPos(pos) {
    var end = this.getVar(VarNames.VISUAL_END_POS);
    if (end != null) {
      this.setVar(VarNames.VISUAL_END_POS, pos);
      this.highlightVisualRange();
    } else {
      this.setSelection(pos, pos);
    }
  }

  function setSelection(start, end) {
    if (null == start) {
      popup("Bad selection pos!");
    }
    if (null == end) {
      end = start;
    }
    this.e.selectionStart = start;
    this.e.selectionEnd = end;
    if (this.e.jv_divhack) this.divhackUpdateRangeFromSelection();
  }

  function getCursorPos() {
    return this.getVar(VarNames.VISUAL_END_POS, this.getSelectionEnd());
  }

  function getSelectionStart() {
    //TODO(vona) maybe ensure sync with range in div?
    //for now we try to do it actively in event listeners vs passively here
    return this.e.selectionStart;
  }

  function getSelectionEnd() {
    //TODO(vona) maybe ensure sync with range in div?
    //for now we try to do it actively in event listeners vs passively here
    return this.e.selectionEnd;
  }

  function getSelectionText() {
    return this.getText(this.getSelectionStart(), this.getSelectionEnd());
  }

  function getText(start, end) {
    return this.getElementText().slice(start, end);
  }

  function getMaxPos() {
    return this.getElementText().length;
  }

  function getCharAtPos(pos) {
    return this.getElementText().charAt(pos);
  }

  function getCharCodeAtPos(pos) {
    return this.getElementText().charCodeAt(pos);
  }

  var hack = 0;
  // There are a variety of techniques here, for timing tests.  They're all
  // about the same, it turns out.
  function replaceRangeNoUndo(start, end, newText, saveCol) {
    if (!saveCol) {
      this.clearVar(VarNames.COL);
    }
    var element = this.e;
    if (element.jv_divhack) {
      divhackUpdateValueFromDiv();
    }
    var scrollPos = getScrollPos(element);
    var oldText;
    //pushTimingEvent("Extraction " + (hack % 2));
    switch (hack % 2) { // How to extract the old text.
    case 0:
      // the original, simple method
      prevText = element.value.slice(0, start);
      if (end == start) {
        oldText = Consts.EMPTY;
      } else {
        oldText = element.value.slice(start, end);
      }
      postText = element.value.slice(end);
      break;
    case 1:
      // substring instead of slice
      prevText = element.value.substring(0, start);
      if (end == start) {
        oldText = Consts.EMPTY;
      } else {
        oldText = element.value.substring(start, end);
      }
      postText = element.value.substring(end);
      break;
    }
    //pushTimingEvent("Done extraction " + (hack % 2));
    //pushTimingEvent("Combination " + (hack % 3));
    switch (hack % 3) {
    case 0:
      // The original, simple method.
      element.value = prevText + newText + postText;
      break;
    case 1:
      // string.concat
      element.value = prevText.concat(newText, postText);
      break;
    case 2:
      // array join
      element.value = [prevText, newText, postText].join(Consts.EMPTY);
      break;
    }
    //pushTimingEvent("Done combination " + (hack % 3));
    if (element.jv_divhack) {
      divhackUpdateDivFromValue();
    }
    setScrollPos(element, scrollPos);
    ++hack;
    return oldText;
  }

  function replaceRange(start, end, newText, isSpecialDel) {
    var oldText = this.replaceRangeNoUndo(start, end, newText);
    if (isSpecialDel) {
      this.addUndoDelChars(start, oldText);
    } else {
      this.addUndoInfo(start, start + newText.length, oldText);
    }
    return oldText;
  }

  function deleteChars(start, count) {
    if (count) {
      var pos = this.getCursorPos();
      this.replaceRange(start, Math.min(start+count, this.getMaxPos()),
          Consts.EMPTY, true);
      this.setCursorPos(pos); // Seems to be required.
    }
  }

  function getRange(start, end) {
    return this.getElementText().slice(start, end);
  }

  function alertCharCode(str, charCode) {
    popup(str + "(" + charCode + "):'" + String.fromCharCode(charCode) + "'");
  }

  function dumpRegs(jsvim) {
    _debug("Regs: ");
    _debug(stringifyObj(jsvim.regs));
  }

  function dumpObj(obj) {
    _debug("Debugging:");
    for (i in obj) {
      _debug(i + ":\t" + obj[i]);
    }
  }

  // Persistent variable names
  var CharTypes = {
    ALNUM : 1,
    PUNC : 2,
    WS : 3,
  }

  function isWhiteSpace(charCode) {
    return charCode <= 32;
  }

  function isDigit(charCode) {
    return (Keys.N_0 <= charCode) && (charCode <= Keys.N_9);
  }

  function isComboCommandChar(charCode) {
    return charCode == Keys.g;
  }

  function isRepeatableInsertCommand(charCode) {
    switch (charCode) {
    case Keys.a:
    case Keys.A:
    case Keys.I:
    case Keys.i:
    case Keys.o:
    case Keys.O:
    case Keys.R:
      return true;
    default:
      return false;
    }
  }

  function isSeek(charCode) {
    switch (charCode) {
    case Keys.t:
    case Keys.T:
    case Keys.f:
    case Keys.F:
      return true;
    default:
      return false;
    }
  }

  function isSearch(charCode) {
    switch (charCode) {
    case Keys.QUEST:
    case Keys.SLASH:
      return true;
    default:
      return false;
    }
  }

  function invertSearch(charCode) {
    switch (charCode) {
    case Keys.QUEST:
      return Keys.SLASH;
    case Keys.SLASH:
      return Keys.QUEST;
    default:
      throw "Bad search char code: " + charCode;
    }
  }

  function isVisual(charCode) {
    switch (charCode) {
    case Keys.V:
    case Keys.v:
      return true;
    default:
      return false;
    }
  }

  function isCompleteCommand(charCode) {
    switch (charCode) {
    case Keys.CTRL_B:
    case Keys.CTRL_D:
    case Keys.CTRL_E:
    case Keys.CTRL_F:
    case Keys.CTRL_R:
    case Keys.CTRL_U:
    case Keys.CTRL_Y:
    case Keys.DOT:
    case Keys.a:
    case Keys.A:
    case Keys.C:
    case Keys.D:
    case Keys.I:
    case Keys.i:
    case Keys.J:
    case Keys.o:
    case Keys.O:
    case Keys.p:
    case Keys.P:
    case Keys.R:
    case Keys.s:
    case Keys.S:
    case Keys.u:
    case Keys.x:
    case Keys.X:
    case Keys.Y:
    case Keys.TILDE:
      return true;
    default:
      return false;
    }
  }

  function isVisualIrrelevantCompleteCommand(charCode) {
    switch (charCode) {
    case Keys.CTRL_B:
    case Keys.CTRL_D:
    case Keys.CTRL_E:
    case Keys.CTRL_F:
    case Keys.CTRL_U:
    case Keys.CTRL_Y:
      return true;
    default:
      return false;
    }
  }

  function isVisualCompatibleCompleteCommand(charCode) {
    switch (charCode) {
    case Keys.C:
    case Keys.D:
    case Keys.J:
    case Keys.p:
    case Keys.P:
    case Keys.R:
    case Keys.s:
    case Keys.S:
    case Keys.x:
    case Keys.X:
    case Keys.Y:
    case Keys.TILDE:
      return true;
    default:
      return false;
    }
  }

  function isPartialCommand(charCode) {
    switch (charCode) {
    case Keys.c:
    case Keys.d:
    case Keys.r:
    case Keys.y:
      return true;
    default:
      return false;
    }
  }

  // Remember to update this as you implement them!
  // This does not include seeks or searches, only complete motions.
  function isMotion(charCode) {
    switch (charCode) {
    case Keys.BS:
    case Keys.LF:
    case Keys.SPACE:
    case Keys.DOLLAR:
    case Keys.PERCENT:
    case Keys.SEMI:
    case Keys.CARET:
    case Keys.b:
    case Keys.B:
    case Keys.e:
    case Keys.E:
    case Keys.G:
    case Keys.h:
    case Keys.j:
    case Keys.k:
    case Keys.l:
    case Keys.n:
    case Keys.N:
    case Keys.N_0:
    case Keys.w:
    case Keys.W:
    case Keys.PIPE:
      return true;
    default:
      return false;
    }
  }

  function isRecognizedCtrlKey(charCode) {
    switch (charCode) {
    case Keys.CTRL_B:
    case Keys.CTRL_C:
    case Keys.CTRL_D:
    case Keys.CTRL_E:
    case Keys.CTRL_F:
    case Keys.ESC:
    case Keys.BS:
    case Keys.TAB:
    case Keys.LF:
    case Keys.CTRL_R:
    case Keys.CTRL_U:
    case Keys.CTRL_Y:
    case Keys.L_BRAC: // Not a ctrl keycode, but with ctrl.
      return true;
    default:
      return false;
    }
  }

  function isOKNotToMove(charCode) {
    switch (charCode) {
    case Keys.DOLLAR:
    case Keys.CARET:
    case Keys.G:
    case Keys.N_0:
    case Keys.PIPE:
    case Consts.SEEK:
    case Consts.SEARCH:
      return true;
    default:
      return false;
    }
  }
  // Remember to update this as you implement them!
  // Used to determine whether a paste of text cut using one of these motions
  // should be done line-wise.
  function isLinewise(cmd, motion) {
    if (cmd == motion || motion == Keys.j || motion == Keys.k ||
        motion == Keys.G) {
      return true;
    } else {
      return false;
    }
  }

  function categorizeCharCode(charCode, strict) {
    if (isWhiteSpace(charCode)) {
      return CharTypes.WS;
    }
    if (!strict) {
      return CharTypes.ALNUM; // All non-space are the same.
    }
    // <= 32 already checked
    if (/*charCode >= 33 && */ charCode <= 47) {
      return CharTypes.PUNC;
    }
    if (charCode >= 58 && charCode <= 64) {
      return CharTypes.PUNC;
    }
    if (charCode >= 91 && charCode <= 94) {
      return CharTypes.PUNC;
    }
    if (charCode == 96) {
      return CharTypes.PUNC;
    }
    if (charCode >= 123 && charCode <= 126) {
      return CharTypes.PUNC;
    }
    return CharTypes.ALNUM; // Higher codes [unicode, etc.] I just call ALNUM.
  }

  // Returns the char pos of the first char in the line, if any.
  function findStartOfLine(startPos) {
    if (startPos == null) {
      startPos = this.getCursorPos();
    }
    var pos = startPos;
    if (!pos) {
      return pos;
    }
    // Goes to 0 if not found
    pos = this.getElementText().lastIndexOf(Consts.EOLN, pos - 1) + 1;

    return Math.min(pos, startPos);
  }

  function findCol(pos) {
    if (pos == null) {
      pos = this.getCursorPos();
    }
    return pos - this.findStartOfLine(pos);
  }

  // Returns the char pos of the last char [the newline] in the line, if any.
  // If the element is empty, calling this is undefined.  If the line does not
  // end with a newline, returns the pseudo-position of the end of the input,
  // one beyond the last actual character.
  function findEndOfLine(pos) {
    var max = this.getMaxPos();
    if (pos == null) {
      pos = this.getCursorPos();
    }
    pos = this.getElementText().indexOf(Consts.EOLN, pos);
    if (pos == -1) {
      pos = max;
    }
    return pos;
  }

  function findPrevWhitespaceStart(pos) {
    if (pos == null) {
      pos = this.getCursorPos();
    }
    for (; pos > 0 && isWhiteSpace(this.getCharCodeAtPos(pos - 1)); --pos);
    return Math.max(pos, 0);
  }

  function findNonSpaceCharOrEnd(pos) {
    var max = this.getMaxPos();
    if (pos == null) {
      pos = this.getCursorPos();
    }
    for (; pos < max; ++pos) {
      // todo: Optimize
      var charCode = this.getCharCodeAtPos(pos);
      if (charCode == Keys.LF) { // eoln
        break;
      }
      if (charCode == Keys.SPACE || charCode == Keys.TAB) { // space or tab
        continue;
      }
      break;
    }
    return Math.min(pos, max);
  }

  function findNextWordEnd(origPos, strict) {
    var max = this.getMaxPos();
    var pos = origPos + 1;
    // todo: Optimize
    while ((pos < max) && isWhiteSpace(this.getCharCodeAtPos(pos))) {
      ++pos;
    }
    var origCat = categorizeCharCode(this.getCharCodeAtPos(pos), strict);
    while ((pos + 1 < max) && (origCat ==
        categorizeCharCode(this.getCharCodeAtPos(pos + 1), strict))) {
      ++pos;
    }
    return Math.min(pos, max);
  }

  function findNextWordStart(origPos, strict) {
    var max = this.getMaxPos();
    var pos = origPos;
    var origCat = categorizeCharCode(this.getCharCodeAtPos(pos), strict);
    ++pos;
    // todo: Optimize
    while ((pos < max) &&
        (categorizeCharCode(this.getCharCodeAtPos(pos), strict) == origCat)) {
      ++pos;
    }
    while ((pos < max) && isWhiteSpace(this.getCharCodeAtPos(pos))) {
      ++pos;
    }
    return Math.min(pos, max);
  }

  function findNextWordStartOrNewline(origPos, strict) {
    if (this.getCharCodeAtPos(origPos) == Keys.LF) {
      return origPos;
    }
    var max = this.getMaxPos();
    var pos = origPos;
    var origCat = categorizeCharCode(this.getCharCodeAtPos(pos), strict);
    ++pos;
    var code;
    // todo: Optimize
    for (; pos < max; ++pos) {
      var code = this.getCharCodeAtPos(pos);
      if (code == Keys.LF) {
        break;
      }
      if (categorizeCharCode(code, strict) != origCat) {
        break;
      }
    }
    for (; pos < max; ++pos) {
      var code = this.getCharCodeAtPos(pos);
      if (code == Keys.LF) {
        break;
      }
      if (!isWhiteSpace(code)) {
        break;
      }
    }
    return Math.min(pos, max);
  }

  function findPrevWordStart(origPos, strict) {
    var pos = origPos;
    // todo: Optimize
    while (pos > 0 && isWhiteSpace(this.getCharCodeAtPos(pos - 1))) {
      --pos;
    }
    if (pos <= 0) {
      return 0;
    }
    var origCat = categorizeCharCode(this.getCharCodeAtPos(pos - 1), strict);
    while ((pos > 0) &&
        (categorizeCharCode(this.getCharCodeAtPos(pos - 1), strict) ==
            origCat)) {
      --pos;
    }
    return pos;
  }

  var matchableString = "()[]{}";

  function findMatchableIndex(inputChar) {
    var index = matchableString.indexOf(inputChar);
    if (index != -1) {
      return index;
    }
    return null;
  }

  function findNextPercentMatch(pos, inc, donePos) {
    if (this.e.jv_divhack) {
      divhackUpdateValueFromDiv();
    }
    var newPos = donePos;
    if (inc > 0) {
      for (var index in matchableString) {
        var temp = this.e.value.indexOf(matchableString[index],
            pos + inc);
        if (temp != -1 && temp < newPos) {
          newPos = temp;
        }
      }
    } else {
      for (var index in matchableString) {
        var temp = this.e.value.lastIndexOf(matchableString[index],
            pos + inc);
        if (temp > newPos) {
          newPos = temp;
        }
      }
    }
    return newPos;
  }

  function doPercent() {
    pushTimingEvent("In doPercent");
    var pos = this.getCursorPos();
    var max = this.getMaxPos();
    var seekIndex, seekPairIndex;
    seekIndex = findMatchableIndex(this.getCharAtPos(pos));
    if (seekIndex == null) {
      return pos;
    }
    seekPairIndex = seekIndex ^ 1;
    var inc = seekPairIndex - seekIndex;
    var charsToCheck;
    assert(inc);
    assert(Math.abs(inc) == 1);
    if (inc > 0) {
      doneIndex = max;
      assert(doneIndex >= pos + inc);
    } else {
      doneIndex = -1;
      assert(doneIndex <= pos + inc);
    }
    var counts = [0, 0, 0];
    var halfSeekIndex = Math.floor(seekIndex / 2);
    counts[halfSeekIndex] += inc;
    for (var index = this.findNextPercentMatch(pos, inc, doneIndex);
        index != doneIndex;
        index = this.findNextPercentMatch(index, inc, doneIndex)) {
      var match = findMatchableIndex(this.getCharAtPos(index));
      if (match != null) {
        var halfMatch = Math.floor(match / 2);
        if (match & 1) {
          --counts[halfMatch];
        } else {
          ++counts[halfMatch];
        }
        if (!counts[halfMatch]) {
          // Check 'em all?
          if (halfMatch == halfSeekIndex) {
            if (!counts[0] && !counts[1] && !counts[2]) {
              // Found it!
              return index;
            } else {
              // Guaranteed bad brace matching.
              break;
            }
          }
        }
      }
    }
    pushTimingEvent("Out doPercent");
    return pos;
  }

  function doSeek(mul, seek, seekChar, gotCmd) {
    if (this.e.jv_divhack) {
      divhackUpdateValueFromDiv();
    }
    if (categorizeCharCode(seekChar, true) == CharTypes.PUNC) {
      seekChar = Consts.BACKSLASH + String.fromCharCode(seekChar);
    } else {
      seekChar = String.fromCharCode(seekChar);
    }
    var pos = this.getCursorPos();
    var newPos = -1;
    if (seek == Keys.t || seek == Keys.f) {
      var pat = new RegExp(
          "^([^\\n" + seekChar + "]*" + seekChar + "){" + mul + "}", 'g');
      var text = this.e.value.substring(pos + 1);
      if (pat.exec(text)) {
        newPos = pat.lastIndex + pos;
        if (seek == Keys.t && !gotCmd) {
          --newPos;
        } else if (seek == Keys.f && gotCmd) {
          ++newPos;
        }
      }
    } else {
      var pat = new RegExp(
          "(" + seekChar + "[^\\n" + seekChar + "]*){" + mul + "}$", 'g');
      var text = this.e.value.substring(0, pos);
      var r = pat.exec(text);
      if (r) {
        newPos = r.index;
        if (seek == Keys.T) {
          ++newPos;
        }
      }
    }
    return newPos;
  }

  // todo: I'd have thought something like
  // /(?=((<searchStr>.*?){<mul-1>}))<searchStr>/g would work, but apparently
  // that's not quite it.  It would be nice to find the appropriate non-greedy
  // regexp to do a mul-modified search all in one expression.  RECHECK: the
  // problem is likely to be the '.'.  It doesn't match newlines, so use
  // something like [\\w\\W] instead.  Also, look at that email someone sent
  // about the ?= stuff; seems like I misunderstood it.  It doesn't get consumed
  // in the match as I'd expected.
  function doSearch(pos, mul, search, searchStr) {
    var newPos = -1;
    var endPos = -1;
    if (search == Keys.SLASH) {
      var text = this.getElementText();
      var pat;
      try {
        pat = new RegExp(searchStr, 'g');
      } catch (ex) {
        //_debug(stringifyObj(ex));
        return [-1, -1];
      }
      pat.lastIndex = pos + 1;
      var r = pat.exec(text);
      if (!r) {
        pat.lastIndex = 0;
        r = pat.exec(text);
      }
      if (r) {
        for (; mul > 1; --mul) {
          r = pat.exec(text);
          if (!r) { // We know this one will work.
            pat.lastIndex = 0;
            r = pat.exec(text);
          }
        }
        newPos = r.index;
        endPos = pat.lastIndex;
      }
    } else {
      var text = this.getElementText();
//      var pat = new RegExp(
//        searchStr + "(?![^\\b]*" + searchStr + "[^\\b]*)$", 'g');
      var pat;
      try {
        pat = new RegExp(searchStr, 'g');
      } catch (ex) {
        _debug(stringifyObj(ex));
        return [-1, -1];
      }
      var r = pat.exec(text);
      var lastStart;
      var lastEnd;
      var results;
      var numHitsBeforePos = 0;
      if (r) {
        if (mul > 1) { // Don't bother if it's a single search.
          results = new Array();
          results.push([r.index, pat.lastIndex]);
        }
        if (r.index < pos) {
          ++numHitsBeforePos;
        }
      }
      while (r && (r.index < pos || numHitsBeforePos < mul)) {
        lastStart = r.index;
        lastEnd = pat.lastIndex;
        r = pat.exec(text);
        if (r && results) {
          results.push([r.index, pat.lastIndex]);
          if (r.index < pos) {
            ++numHitsBeforePos;
          }
        }
      }
      if (mul <= 1) {
        if (lastStart != null) {
          newPos = lastStart;
          endPos = lastEnd;
        }
      } else if (results) {
        // We have results.length hits, numHitsBeforePos of which are before
        // our start position.  We want to back up mul-1 hits from
        // results[numHitsBeforePos - 1], wrapping appropriately around the end.
        mul = mul % results.length; // Deal with wrapping.
        var index = (numHitsBeforePos - mul + results.length) % results.length;
        var pair = results[index];
        newPos = pair[0];
        endPos = pair[1];
      }
    }
    return [newPos, endPos];
  }

  function getCursorDX(execState, delta) {
    var pos = execState.pos;
    var origPos = pos;
    if (delta == 0) {
      popup("Zero delta in getCursorDX");
    } else if (delta > 0) {
      // todo: optimize
      while ((delta > 0) && (pos < execState.max) &&
          (this.getCharAtPos(pos) != Consts.EOLN)) {
        --delta;
        ++pos;
      }
    } else {
      // todo: optimize
      while ((delta < 0) && (pos > 0) &&
          (this.getCharAtPos(pos - 1) != Consts.EOLN)) {
        ++delta;
        --pos;
      }
    }
    if (pos != origPos) {
      this.clearVar(VarNames.COL);
    }
    return pos;
  }

  // Assumes you're in column zero and attempts to move right, by col or until
  // stopped by eoln.
  function findPosForCol(pos, col) {
    var eoln = this.getElementText().indexOf(Consts.EOLN, pos);
    if (eoln == -1) {
      eoln = this.getMaxPos();
    }
    if (eoln == pos) {
      return pos;
    }
    return Math.min(pos + col, eoln - 1);
  }

  function getCursorDY(execState, delta) {
    var origDelta = delta;
    var pos = execState.pos;
    var origPos = pos;
    var col = this.getVar(VarNames.COL);
    if (col == null) {
      col = this.findCol();
      this.setVar(VarNames.COL, col);
    }
    assert(delta);
    if (delta > 0) {
      var r;
      if (col == Infinity) {
        r = new RegExp(["(.*\n){1,", delta, "}.*"].join(""), "g");
      } else {
        r = new RegExp(["(.*\n){1,", delta, "}.{0,", col, "}"].join(""), "g");
      }
      r.lastIndex = pos;
      if (r.exec(this.getElementText())) { // Else can't move
        pos = r.lastIndex;
      }
    } else {
      // todo: Optimize
      var sol = this.findStartOfLine(pos);
      while ((delta < 0) && (sol > 0)) {
        sol = this.findStartOfLine(sol - 1);
        ++delta;
      }
      if (origDelta != delta) {
        pos = this.findPosForCol(sol, col);
      }
    }
    return pos;
  }

  function handleRegModeInput(inputCharCode) {
    var reg;
    if (inputCharCode >= Keys.a && inputCharCode <= Keys.z) {
      reg = inputCharCode;
    } else if (inputCharCode == Keys.DOT) {
      reg = RegNames.INS;
    } else if (this.inExtension && inputCharCode == Keys.PLUS) {
      reg = RegNames.CLIP;
    } else if (this.inExtension && inputCharCode == Keys.STAR) {
      reg = RegNames.SEL;
    } else if (inputCharCode == Keys.SLASH) {
      reg = RegNames.SEARCH_STR;
    }
    if (reg) {
      this.noFlickerForOneKeypress = true;
      this.setMode(ModeNames.COMMAND);
      this.setVar(VarNames.REG, reg);
    } else {
      this.handleUnrecognizedChar();
    }
    return false;
  }

  function handleSemi(inputCharCode) {
    if (inputCharCode == Keys.SEMI) {
      this.setVar(VarNames.MOTION, Consts.SEEK);
      var seek = this.getReg(RegNames.SEEK);
      var seekChar = this.getReg(RegNames.SEEK_CHAR)
      if (!seek || !seekChar) {
        this.abortCommand();
      }
      this.setVar(VarNames.SEEK, seek);
      this.setVar(VarNames.SEEK_CHAR, seekChar);
      this.setMode(ModeNames.SEEK);
      return true;
    }
    return false;
  }

  function handleSearchAgain(inputCharCode) {
    if (inputCharCode == Keys.N || inputCharCode == Keys.n) {
      this.setVar(VarNames.MOTION, Consts.SEARCH);
      var search = this.getReg(RegNames.SEARCH);
      var searchStr = this.getReg(RegNames.SEARCH_STR)
      if (!search || !searchStr) {
        this.abortCommand();
      }
      if (inputCharCode == Keys.N) {
        search = invertSearch(search);
      }
      this.setVar(VarNames.SEARCH, search);
      this.setVar(VarNames.SEARCH_STR, searchStr);
      this.setMode(ModeNames.SEARCH);
      return true;
    }
    return false;
  }

  function handleSeekChar(inputCharCode) {
    if (isSeek(inputCharCode)) {
      this.setVar(VarNames.MOTION, Consts.SEEK);
      this.setVar(VarNames.SEEK, inputCharCode);
      this.setMode(ModeNames.SEEK);
      this.noFlickerForOneKeypress = true;
      return true;
    }
    return false;
  }

  function handleSearchChar(inputCharCode) {
    if (isSearch(inputCharCode)) {
      this.setVar(VarNames.MOTION, Consts.SEARCH);
      this.setVar(VarNames.SEARCH_START_POS, this.getCursorPos());
      this.clearVar(VarNames.SEARCH_STR);
      this.setVar(VarNames.SEARCH, inputCharCode);
      this.setMode(ModeNames.SEARCH);
      this.noFlickerForOneKeypress = true;
      return true;
    }
    return false;
  }

  function handleComboCommandChar(inputCharCode) {
    var curCombo = this.getVar(VarNames.COMBO_CMD_CHAR);
    var isNewCombo = isComboCommandChar(inputCharCode);
    if (!curCombo && !isNewCombo) {
      return false;
    }
    if (curCombo) {
      var combo = String.fromCharCode(curCombo) +
          String.fromCharCode(inputCharCode);
      if (combo == Combos.gg) {
        this.setVar(VarNames.MOTION, Keys.G);
        if (this.getVar(VarNames.MUL) == null) {
          this.setVar(VarNames.MUL, 1);
        }
        this.execute();
      } else {
        this.abortCommand();
      }
    } else { // isNewCombo
      this.setVar(VarNames.COMBO_CMD_CHAR, inputCharCode);
    }
    return true;
  }

  function highlightVisualRange() {
    var max = this.getMaxPos();
    var start = this.getVar(VarNames.VISUAL_START_POS);
    var end = this.getVar(VarNames.VISUAL_END_POS);
    var mode = this.getVar(VarNames.VISUAL);
    if (start > end) {
      var temp = start;
      start = end;
      end = temp;
    } else if (mode != Keys.V) {
      ++end;
    }
    if (mode == Keys.V) {
      start = this.findStartOfLine(start);
      end = this.findEndOfLine(end);
      if (end < max) {
        ++end; // Include the newline.
      }
    }
    this.setSelection(start, end);
  }

  // This does NOT set the mode to VISUAL, since it's a meta-mode that has to
  // work with many other modes [SEARCH, SEEK, IN_NUM, IN_REG].  If
  // VISUAL or VISUAL_START_POS or VISUAL_END_POS is set [they should always
  // come as a set], we're in the VISUAL meta-mode.
  function handleVisualChar(inputCharCode) {
    if (isVisual(inputCharCode)) {
      var visualMode = this.getVar(VarNames.VISUAL);
      if (visualMode) {
        if (visualMode == inputCharCode) {
          var pos = this.getVar(VarNames.VISUAL_END_POS);
          this.clearVisualVars();
          this.setCursorPos(pos);
        } else {
          this.setVar(VarNames.VISUAL, inputCharCode);
          this.highlightVisualRange();
        }
      } else {
        var startPos = this.getCursorPos();
        // Highlight goes from start_pos to end_pos, unless they're the same, in
        // which case it goes from start_pos to start_pos+1 [see
        // highlightVisualRange for details; it's not quite that, but it's
        // close].
        this.setVar(VarNames.VISUAL_START_POS, startPos);
        this.setVar(VarNames.VISUAL_END_POS, startPos);
        this.setVar(VarNames.VISUAL, inputCharCode);
        this.clearVar(VarNames.REG); // I don't know why, but that's canon.
        this.clearVar(VarNames.MUL); // Not compatible, but it'll work.
        this.highlightVisualRange();
      }
      this.updateStatusBar();
      return true;
    }
    return false;
  }

  function handleSeekModeInput(inputCharCode) {
    this.setVar(VarNames.SEEK_CHAR, inputCharCode);
    this.setReg(RegNames.SEEK, this.getVar(VarNames.SEEK));
    this.setReg(RegNames.SEEK_CHAR, inputCharCode);
    this.execute();
  }

  function handleSearchModeInput(inputCharCode) {
    var searchStr = this.getVar(VarNames.SEARCH_STR, Consts.EMPTY);
    if (inputCharCode == Keys.LF) {
      if (searchStr == Consts.EMPTY) {
        searchStr = this.getReg(RegNames.SEARCH_STR, Consts.EMPTY);
        this.setVar(VarNames.SEARCH_STR, searchStr);
      }
      if (searchStr == Consts.EMPTY) {
        this.abortCommand();
      }
      this.setReg(RegNames.SEARCH, this.getVar(VarNames.SEARCH));
      this.setReg(RegNames.SEARCH_STR, searchStr);
      this.setCursorPos(this.getVar(VarNames.SEARCH_START_POS));
      this.execute();
    } else {
      if (inputCharCode == Keys.BS) {
        if (searchStr == Consts.EMPTY) {
          this.abortCommand(true); // Does not return.
        }
        searchStr = searchStr.slice(0, searchStr.length - 1);
      } else {
        searchStr = searchStr + String.fromCharCode(inputCharCode);
      }
      this.setVar(VarNames.SEARCH_STR, searchStr);
      this.updateStatusBar();
      var search = this.getVar(VarNames.SEARCH);
      var mul = this.getVar(VarNames.MUL, 1);
      var startPos = this.getVar(VarNames.SEARCH_START_POS);
      var range = this.doSearch(startPos, mul, search, searchStr);
      var start = range[0];
      var end = range[1];
      if (start != -1) {
        if (this.getVar(VarNames.VISUAL)) {
          this.setCursorPos(range[0]);
        } else {
          this.setSelection(range[0], range[1]);
        }
      } else {
        this.setCursorPos(startPos);
      }
    }
  }

  function safeBackUp(pos) {
    if (pos == null) {
      pos = this.getCursorPos();
    }
    if (pos > 0 && this.getCharAtPos(pos - 1) != Consts.EOLN) {
      --pos;
    }
    return cleanPos(pos, this.getMaxPos());
  }

  function handleLeadingDigit(inputCharCode) {
    if (inputCharCode == Keys.N_0) { // 0 is a motion command.
      this.setVar(VarNames.MOTION, inputCharCode);
      this.execute();
    } else {
      this.setVar(VarNames.CUR_NUM, inputCharCode - Keys.N_0);
      this.setMode(ModeNames.IN_NUM);
      this.noFlickerForOneKeypress = true;
    }
  }

  function handleNumModeInput(inputCharCode, treatAsNonDigit) {
    if (!treatAsNonDigit && isDigit(inputCharCode)) {
      var curNum = this.getVar(VarNames.CUR_NUM);
      this.setVar(VarNames.CUR_NUM, curNum * 10 + (inputCharCode - Keys.N_0));
      this.noFlickerForOneKeypress = true;
    } else { // Which number did we just complete?
      var shouldExecute;
      var shouldAbort;
      var newMode;
      var newVar;
      var reg = this.getVar(VarNames.REG);
      var cmd = this.getVar(VarNames.CMD);
      var mul = this.getVar(VarNames.MUL);

      if (inputCharCode == Keys.QUOTES) { // double-quote
        if ((reg == null) && (cmd == null) && (mul == null)) {
          // OK, legal N0
          newMode = ModeNames.IN_REG;
        } else {
          shouldAbort = true;
        }
      } else if (isPartialCommand(inputCharCode)) {
        if (cmd == null) {
          // OK, legal N1
          newVar = VarNames.CMD;
          var visual = this.getVar(VarNames.VISUAL);
          if (visual && inputCharCode != Keys.r) {
            if (visual == Keys.V) {
              this.convertVisualToDoubledCommand(visual, inputCharCode);
            } else {
              this.setVar(VarNames.MOTION, Consts.VISUAL);
            }
            shouldExecute = true;
          } else {
            newMode = ModeNames.COMMAND;
          }
        } else if ((cmd != null) && (cmd == inputCharCode)) {
          // d5d and the like
          newVar = VarNames.MOTION;
          shouldExecute = true;
        } else {
          shouldAbort = true;
        }
      } else if (isCompleteCommand(inputCharCode)) {
        if (cmd == null) {
          // OK, legal N1
          if (!this.decodeCommand(inputCharCode)) {
            // Otherwise it is already done.
            newVar = VarNames.CMD;
          } else {
            mul = this.getVar(VarNames.MUL); // May be set by decodeCommand.
          }
          if (this.getVar(VarNames.VISUAL)) {
            if (isVisualIrrelevantCompleteCommand(inputCharCode)) {
              shouldExecute = true;
            } else if (isVisualCompatibleCompleteCommand(inputCharCode)) {
              this.setVar(VarNames.MOTION, Consts.VISUAL);
              shouldExecute = true;
            } else {
              shouldAbort = true;
            }
          } else {
            shouldExecute = true;
          }
        } else {
          shouldAbort = true;
        }
      } else if (isMotion(inputCharCode)) {
        if (!this.handleSemi(inputCharCode) &&
            !this.handleSearchAgain(inputCharCode)) {
          newVar = VarNames.MOTION;
        }
        shouldExecute = true;
      } else if (this.handleSeekChar(inputCharCode) ||
          this.handleSearchChar(inputCharCode) ||
          this.handleComboCommandChar(inputCharCode)) {
      } else {
        this.handleUnrecognizedChar(); // Does not return.
      }

      if (shouldAbort) {
        this.abortCommand();
      } else {
        if (newVar) {
          this.setVar(newVar, inputCharCode);
        }
        if (mul == null) {
          mul = 1;
        }
        this.setVar(VarNames.MUL, mul * this.getVar(VarNames.CUR_NUM));
        this.clearVar(VarNames.CUR_NUM);
        if (shouldExecute) {
          this.execute();
        } else {
          this.noFlickerForOneKeypress = true;
          if (newMode) {
            this.setMode(newMode);
          }
        }
      }
    }
  }

  function loopMotion(multiplier, funcName, arg, origPos) {
    if (origPos == null) {
      origPos = this.getCursorPos();
    }
    var pos = origPos;
    for (var i=0; i < multiplier; ++i) {
      var pos = this[funcName](origPos, arg);
      if (pos == origPos) {
        break;
      }
      origPos = pos;
    }
    return pos;
  }

  function cleanPos(pos, max) {
    pos = Math.min(pos, max);
    pos = Math.max(pos, 0);
    return pos;
  }

  function fixupEndOfLineMotion(pos) {
    var max = this.getMaxPos();
    if (pos == max ||
        (this.getCharAtPos(pos) == Consts.EOLN && pos > 0 &&
         this.getCharAtPos(pos - 1) != Consts.EOLN)) {
      --pos; // Vim stops one short when moving.  Caller adjusts for cl, etc.
    }
    return cleanPos(pos, max);
  }

  // Leave line null or zero to indicate the last line.
  function gotoLine(line) {
    var pos = 0;
    var text = this.getElementText();
    if (!line) {
      // todo: If the buffer ends in visible text followed by a newline, this
      // will appear to go to the end of the visible text.  Fix this?
      pos = text.lastIndexOf(Consts.EOLN);
      if (pos < 0) {
        pos = this.getCursorPos();
      } else {
        ++pos;
      }
    } else {
      for (var i=1; i < line && pos < text.length; ++i) {
        var newPos = text.indexOf(Consts.EOLN, pos);
        if (newPos == -1) {
          break;
        }
        pos = newPos + 1;
      }
    }
    return Math.min(pos, text.length);
  }

  /* Returns motion [expressed as new position], if this keypress describes one,
   * or -1 if not.  Motion that cannot be executed counts as motion, and gets
   * returned as the current position.
   * DOES NOT MODIFY execState.
   */
  function computePosition(execState) {
    var mul = execState.mul;
    if (!mul && execState.motion != Keys.G) {
      mul = 1;
    }
    var pos = -1;
    switch (execState.motion) {
      case Keys.BS:
        // See notes under SPACE for this wackiness, except no
        // skip-to-first-non-space-char.
        if (execState.cmd) {
          pos = this.getCursorPos() - mul;
        } else {
          for (var i = 0, pos = this.getCursorPos(); i < mul; ++i) {
            pos = this.fixupEndOfLineMotion(pos - 1);
          }
        }
        break;
      case Keys.LF:
        if (execState.cmd) {
          // Just like j
          pos = this.getCursorDY(execState, mul);
        } else {
          pos = this.getCursorPos();
          var max = this.getMaxPos();
          for (; mul > 0 && pos < max; --mul) {
            pos = this.findEndOfLine(pos) + 1;
          }
          pos = this.findNonSpaceCharOrEnd(pos);
        }
        break;
      case Keys.SPACE:
        // If deleting, just move by pos, no matter what char type.  If the
        // deletion [d NOT c] ends by consuming a newline, move forward to the
        // first non-space char of the line after the newline.  If not, stay
        // where you are.  Vim's not *exactly* like that at a newline in the
        // case of command instead of motion, but it looks like a bug to me.

        // Much craziness here.  IF the line for which you've just deleted the
        // trailing newline contained no non-space chars, the whole thing gets
        // deleted, and you go to the findNonSpaceCharOrEnd of the next line.
        // If the line you were on had non-space chars in it, nothing special
        // happens; the newline goes away, the lines join, and you stay where
        // you are.  I'm just not going to do that; it's crazy, and I'll wait
        // until somebody actually asks for that bit of compatibility.
        if (execState.cmd) {
          pos = this.getCursorPos() + mul;
        } else {
          for (var i = 0, pos = this.getCursorPos(); i < mul; ++i) {
            pos = this.safeBackUp(pos + 2);
          }
        }
        break;
      case Keys.CARET:
        pos = this.findStartOfLine();
        pos = this.findNonSpaceCharOrEnd(pos);
        pos = this.fixupEndOfLineMotion(pos);
        break;
      case Keys.b:
        pos = this.loopMotion(mul, "findPrevWordStart", true);
        break;
      case Keys.B:
        pos = this.loopMotion(mul, "findPrevWordStart", false);
        break;
      case Keys.e:
        pos = this.loopMotion(mul, "findNextWordEnd", true);
        break;
      case Keys.E:
        pos = this.loopMotion(mul, "findNextWordEnd", false);
        break;
      case Keys.G:
        pos = this.gotoLine(mul);
        break;
      case Keys.h:
        pos = this.getCursorDX(execState, -mul);
        break;
      case Keys.j:
        pos = this.getCursorDY(execState, mul);
        break;
      case Keys.k:
        pos = this.getCursorDY(execState, -mul);
        pos = this.fixupEndOfLineMotion(pos);
        break;
      case Keys.l:
        pos = this.getCursorDX(execState, mul); 
        pos = this.fixupEndOfLineMotion(pos);
        break;
      case Keys.w:
        // If execState.cmd, don't go past EOLN unless mul > 1 and
        // necessary to reach /past/ a /skipped/ word.  E.g. cw that changes the
        // last two words on a line doesn't need to delete the EOLN.
        // Translation: if the last word you pass jumps you past a newline, back
        // up to before the newline.
        if (execState.cmd) {
          pos = this.loopMotion(mul - 1, "findNextWordStart", true);
          pos = this.loopMotion(1, "findNextWordStartOrNewline", true, pos);
        } else {
          pos = this.loopMotion(mul, "findNextWordStart", true);
        }
        break;
      case Keys.W:
        // If execState.cmd, don't go past EOLN unless mul > 1 and
        // necessary to reach /past/ a /skipped/ word.  E.g. cw that changes the
        // last two words on a line doesn't need to delete the EOLN.
        // Translation: if the last word you pass jumps you past a newline, back
        // up to before the newline.
        if (execState.cmd) {
          pos = this.loopMotion(mul - 1, "findNextWordStart", false);
          pos = this.loopMotion(1, "findNextWordStartOrNewline", false, pos);
        } else {
          pos = this.loopMotion(mul, "findNextWordStart", false);
        }
        break;
      case Keys.N_0:
        pos = this.findStartOfLine();
        break;
      case Keys.DOLLAR:
        pos = this.findEndOfLine();
        var max = this.getMaxPos();
        for (; mul > 1 && pos < max; --mul) {
          ++pos;
          pos = this.findEndOfLine(pos);
        }
        pos = this.fixupEndOfLineMotion(pos);
        break;
      case Keys.PERCENT:
        pos = this.doPercent();
        break;
      case Keys.PIPE:
        pos = this.findStartOfLine();
        if (mul > 1) {
          var eoln = this.findEndOfLine(pos);
          if (eoln < 0 || ((eoln - pos) > mul)) {
            pos = pos + mul;
          } else {
            pos = eoln;
          }
          pos = this.fixupEndOfLineMotion(pos);
        }
        break;
      case Consts.SEEK:
        pos = this.doSeek(mul, execState.seek, execState.seekChar,
            execState.cmd);
        break;
      case Consts.SEARCH:
        pos = this.doSearch(this.getCursorPos(), mul,
            execState.search, execState.searchStr)[0];
      default:
        break;
    }
    return pos;
  }

// VISUAL + capital => doubled lowercase.
// VISUAL_LINE + cap or lowercase => doubled lowercase, but we'll catch the
// lowercase elsewhere.
  function convertVisualToDoubledCommand(visual, inputCharCode) {
    this.setVar(VarNames.MOTION, inputCharCode);
    var text = this.getSelectionText();
    var lines = text.split(Consts.EOLN).length;
    if (visual == Keys.V && text.charCodeAt(text.length - 1) == Keys.LF) {
      --lines; // V highlights the trailing newline, if any.
    }
    this.setVar(VarNames.MUL, lines);
    this.setVar(VarNames.CUR_NUM, 1);
    var pos = Math.min(
        this.getVar(VarNames.VISUAL_START_POS),
        this.getVar(VarNames.VISUAL_END_POS));
    this.clearVisualVars();
    this.setCursorPos(pos);
  }

  function decodeCommand(inputCharCode) {
    var visual = this.getVar(VarNames.VISUAL);
    switch (inputCharCode) {
      case Keys.C:
      case Keys.D:
      case Keys.Y:
        inputCharCode += 32;
        this.setVar(VarNames.CMD, inputCharCode); // toLowerCase
        if (visual) {
          this.convertVisualToDoubledCommand(visual, inputCharCode);
        } else {
          this.setVar(VarNames.MOTION, Keys.DOLLAR);
        }
        return true;
      case Keys.x:
        this.setVar(VarNames.CMD, Keys.d);
        if (visual == Keys.V) {
          this.convertVisualToDoubledCommand(visual, Keys.d);
        } else {
          this.setVar(VarNames.MOTION, Keys.l);
        }
        return true;
      case Keys.X:
        this.setVar(VarNames.CMD, Keys.d);
        if (visual) {
          this.convertVisualToDoubledCommand(visual, Keys.d);
        } else {
          this.setVar(VarNames.MOTION, Keys.h);
        }
        return true;
      case Keys.R:
        if (visual) {
          this.setVar(VarNames.CMD, Keys.c);
          this.convertVisualToDoubledCommand(visual, Keys.c);
          return true;
        }
        return false;
      case Keys.s:
        this.setVar(VarNames.CMD, Keys.c);
        this.setVar(VarNames.MOTION, Keys.l);
        return true;
      case Keys.S:
        this.setVar(VarNames.CMD, Keys.c);
        if (visual) {
          this.convertVisualToDoubledCommand(visual, Keys.c);
        } else {
          this.setVar(VarNames.MOTION, Keys.c);
        }
        return true;
      default:
        return false;
    }
  }

  function handleCommandModeInput(inputCharCode, inReplace, inhibitRepeatable) {
    // false after g,z,] cmds in!
    assert(!cmd || inReplace|| !this.getVar(VarNames.VISUAL));
    assert(!inhibitRepeatable || !this.getVar(VarNames.VISUAL));
    var cmd = this.getVar(VarNames.CMD);
    if (inReplace) {
      this.setVar(VarNames.INPUT_CHAR_CODE, inputCharCode);
      if (this.getVar(VarNames.VISUAL)) {
        this.setVar(VarNames.MOTION, Consts.VISUAL);
      }
      this.execute();
    } else if (this.handleComboCommandChar(inputCharCode)) {
      // Currently only 'g'
    } else if (isMotion(inputCharCode)) {
      if (!this.handleSemi(inputCharCode) &&
          !this.handleSearchAgain(inputCharCode)) {
        this.setVar(VarNames.MOTION, inputCharCode);
      }
      this.execute(inhibitRepeatable);
    } else if (this.handleSeekChar(inputCharCode) ||
        this.handleSearchChar(inputCharCode) ||
        this.handleVisualChar(inputCharCode)) {
    } else if (isDigit(inputCharCode)) {
      this.handleLeadingDigit(inputCharCode);
    } else if (cmd) { // Everything after here requires not having a cmd yet.
      if (inputCharCode == this.getVar(VarNames.CMD)) {
        this.setVar(VarNames.MOTION, inputCharCode);
        this.execute();
      } else {
        this.handleUnrecognizedChar();
      }
    } else if (inputCharCode == Keys.QUOTES) {
      this.setMode(ModeNames.IN_REG);
      this.noFlickerForOneKeypress = true;
    } else if (isPartialCommand(inputCharCode)) {
      this.setVar(VarNames.CMD, inputCharCode);
      var visual = this.getVar(VarNames.VISUAL);
      if (visual && inputCharCode != Keys.r) {
        if (visual == Keys.V) {
          this.convertVisualToDoubledCommand(visual, inputCharCode);
        } else {
          this.setVar(VarNames.MOTION, Consts.VISUAL);
        }
        this.execute(); // Cannot be inhibitRepeatable.
      } else {
        this.noFlickerForOneKeypress = true;
      }
    } else if (isCompleteCommand(inputCharCode)) {
      if (!this.decodeCommand(inputCharCode)) {
        // Otherwise it is already done.
        this.setVar(VarNames.CMD, inputCharCode);
      }
      if (this.getVar(VarNames.VISUAL)) {
        if (isVisualIrrelevantCompleteCommand(inputCharCode)) {
        } else if (isVisualCompatibleCompleteCommand(inputCharCode)) {
          this.setVar(VarNames.MOTION, Consts.VISUAL);
        } else {
          this.handleUnrecognizedChar();
        }
      }
      this.execute(inhibitRepeatable);
    } else {
      this.handleUnrecognizedChar();
    }
  }

  function intFromPx(s) {
    if (!s || !s.length) {
      return 0;
    }
    return parseInt(s.replace("px",""));
  }

  function getLineHeight(style) {
    var lineHeight = style.lineHeight;
    if (lineHeight.search("px") != -1) {
      return intFromPx(lineHeight);
    }
    var fontSize = intFromPx(style.fontSize);
    if (!lineHeight || lineHeight == "" ||
        lineHeight.toLowerCase() == "normal") {
      lineHeight = 1.2;
    } else  {
      lineHeight = parseInt(lineHeight.replace("%", "")) / 100;
    }
    return oneLine = Math.ceil(fontSize * lineHeight);
  }

  function getElementHeightInLines(element, lineHeight) {
    return Math.floor(element.clientHeight / lineHeight); //TODO(vona)
  }

  function getScrollPos(element) {
    return element.scrollTop;
  }

  //TODO(vona) GMail contenteditable divs seem to do their own scrolling, but
  //aren't scrollable in this way.  element.scrollTop always seems to be zero no
  //matter what it is set to.
  function setScrollPos(element, pos) {
    element.scrollTop = pos;
  }

  function scrollBy(element, pixels) {
    setScrollPos(element, getScrollPos(element) + pixels);
  }

  function scrollToTop(element) {
    element.scrollTop = 0;
  }

  function scrollToBottom(element) {
    element.scrollTop = element.scrollHeight - element.clientHeight;
  }

  function handleScroll(multiplier, cmd) {
    var element = this.e;
    var style = window.getComputedStyle(element, "");
    var lineHeight = getLineHeight(style);
    this.setVar(VarNames.LINE_HEIGHT, lineHeight);
    var distance;
    var winHalfHeight;
    switch (cmd) {
      case Keys.CTRL_B:
        distance = multiplier * -getElementHeightInLines(element, lineHeight) *
            lineHeight;
        break;
      case Keys.CTRL_D:
        distance = multiplier *
            Math.floor(getElementHeightInLines(element, lineHeight) / 2) *
                lineHeight;
        break;
      case Keys.CTRL_E:
        distance = multiplier * lineHeight;
        break;
      case Keys.CTRL_F:
        distance = multiplier * getElementHeightInLines(element, lineHeight) *
            lineHeight;
        break;
      case Keys.CTRL_U:
        distance = multiplier *
            -Math.floor(getElementHeightInLines(element, lineHeight) / 2) *
                lineHeight;
        break;
      case Keys.CTRL_Y:
        distance = multiplier * -lineHeight;
        break;
      default:
        alertCharCode("handleScroll cmd was ", cmd);
        return;
    }
    this.noFlickerForOneKeypress = true;
    scrollBy(element, distance);

//        Could this be the way to move the cursor to the right place?
//        It's probably either a click, lots of math and a fixed-width font, or
//        actually creating a new div, copying data into it, and measuring
//        [repeatedly as necessary].
//    var event = document.createEvent("MouseEvents");
//    event.initMouseEvent("click", true, true, window,
//        1, 0, 0, 0, 0, false, false, false, false, 0, null);
//    var canceled = !element.dispatchEvent(event);
  }

  function UndoUnit(start, end, text, wasO) {
    this.start = start;
    this.end = end;
    this.text = text;
    this.wasO = wasO;
    return this;
  }

  function UndoRecord(unit) {
    this.units = new Array();
    this.count = function () {
      return this.units.length;
    }
    this.push = function (unit) {
      this.units.push(unit);
    }
    this.pop = function () {
      return this.units.pop();
    }

    if (unit) {
      this.push(unit);
    }
  }

  function handleUndoRecord(count, fromStack, toStack) {
    if (count <= 0) {
      popup("Can't undo/redo with count " + count);
    }
    if (!fromStack.length) {
      this.abortCommand();
      return;
    }
    var max;
    var oldText;
    var u;
    for (; count > 0 && fromStack.length; --count) {
      var fromRecord = fromStack.pop();
      var toRecord = new UndoRecord();
      if (!fromRecord.count()) {
        popup("undo record was empty!");
      }
      while (fromRecord.count()) {
        u = fromRecord.pop();
        max = this.getMaxPos();
        oldText = this.replaceRangeNoUndo(u.start, u.end, u.text);
        toRecord.push(
            new UndoUnit(u.start, u.start + u.text.length, oldText, u.wasO));
      }
      toStack.push(toRecord);
    }
    if (count > 0) {
      this.beep();
    }
    var start = u.start;
    if (!u.text.length && u.end == max && start > 0 &&
        oldText.indexOf(Consts.EOLN) != -1) {
      // We've deleted the last line [plus possible others] and don't want to
      // leave the cursor just after the trailing char of the buffer.  Instead,
      // we back up to the first non-space char of the previous line, if any.
      start = this.findNonSpaceCharOrEnd(this.findStartOfLine(start));
    } else if (!oldText.length && start == max && u.text.length > 1 &&
        u.text.charAt(0) == Consts.EOLN) {
      // We've just put back the last line, which is at least 2 chars starting
      // with a newline, and don't want to get stuck sitting on [before] the
      // newline.  Instead, we go to the first non-space char of the line we
      // put back.
      start = this.findNonSpaceCharOrEnd(start + 1);
    } else if (u.wasO != null) {
      start = u.wasO;
    }
    this.setCursorPos(this.fixupEndOfLineMotion(start));
    this.endCommand(ModeNames.COMMAND, false, false);
  }

  function undo(count) {
    this.handleUndoRecord(count, this.getUndoStack(), this.getRedoStack());
  }

  function redo(count) {
    this.handleUndoRecord(count, this.getRedoStack(), this.getUndoStack());
  }

  function doTilde(execState, start, text) {
    var output = Consts.EMPTY;
    var i;
    for (i = 0; i < text.length; ++i) {
      var c = text.charAt(i);
      var temp = c.toLocaleLowerCase();
      if (temp == c) {
        temp = c.toLocaleUpperCase();
      }
      output += temp;
    }
    execState.newText = output;
    execState.start = start;
    execState.end = execState.start + execState.newText.length;
    return output;
  }

  function ExecState(jv, mul, reg, cmd, motion, seek, seekChar, search,
      searchStr, visual, delChars, repeating, inhibitRepeatable) {
    this.pos = jv.getCursorPos();
    this.max = jv.getMaxPos();
    this.mul = mul;
    this.reg = reg;
    this.cmd = cmd;
    this.motion = motion;
    this.seek = seek;
    this.seekChar = seekChar;
    this.search = search;
    this.searchStr = searchStr;
    this.delChars = delChars;
    this.repeating = repeating;
    this.inhibitRepeatable = inhibitRepeatable;
    this.nextMode = ModeNames.COMMAND;
    this.newText = Consts.EMPTY;
    this.truePos = null;  // Used only by visual commands who need to know it.
    this.visual = visual; // Used only by visual commands who need to know it.
    this.inputCharCode = null;// Used only by r.
    return this;
  }

  function computeMotionForDoubleLetter (execState) {
    execState.start = this.findStartOfLine(execState.pos);
    var temp = execState.end = execState.pos;
    for (var i=0; i < execState.mul; ++i) {
      execState.end = this.findEndOfLine(temp);
      if (execState.end == execState.max) {
        break;
      }
      if (i < execState.mul - 1) { // We have at least one more to go.
        ++execState.end; // Jump over newline.
      }
      temp = execState.end;
    }
    if (execState.cmd == Keys.c) {
      execState.start = this.findNonSpaceCharOrEnd(execState.start);
    } else if (execState.cmd == Keys.d) {
      ++execState.end;
      // The extra +1 is to trim the newline.  If there is no trailing one,
      // use the leading one instead, if any.
      if (execState.end > execState.max) {
        execState.end = execState.max;
        // execState.start = Math.max(execState.start - 1, 0);
        --execState.start;
        if (execState.start < 0) {
          execState.addNewline = true;
          execState.start = 0;
          execState.newPos = execState.start;
        } else {
          execState.rotateNewline = true;
          execState.newPos = this.findNonSpaceCharOrEnd(
              this.findStartOfLine(execState.start));
        }
      } else if (execState.end == execState.max) {
        execState.newPos =
            this.findNonSpaceCharOrEnd(
                this.findStartOfLine(execState.start - 1));
        if (execState.newPos > execState.start) {
          execState.newPos = execState.start;
          popup("execState.newPos was greater than execState.start!");
        }
      } else {
        execState.newPos = this.findNonSpaceCharOrEnd(execState.end) -
            execState.end + execState.start;
      }
    } else { // y
      ++execState.end;
      execState.newPos = execState.pos;
      // The extra +1 is to grab the newline.
      if (execState.end > execState.max) {
        execState.end = execState.max;
        execState.addNewline = true;
      }
    }
  }

  function computeMotionWithCommand(execState) {
    switch (execState.motion) {
      case Keys.DOLLAR:
        if (execState.pos != execState.newPos &&
            execState.newPos == execState.max) {
          execState.start = execState.pos;
          execState.end = execState.newPos;
        } else if (this.getCharAtPos(execState.newPos) != Consts.EOLN &&
            execState.newPos < execState.max) {
          execState.start = execState.pos;
          execState.end = execState.newPos + 1;
        }
        if (execState.cmd == Keys.y) {
          execState.newPos = execState.pos;
        } else if (execState.newPos != execState.pos) {
          execState.newPos = execState.start;
        }
        break;
      case Keys.PERCENT:
        if (execState.newPos != execState.pos) {
          execState.start = Math.min(execState.pos, execState.newPos);
          execState.end = Math.max(execState.pos, execState.newPos) + 1;
          execState.newPos = execState.start;
        }
        break;
      case Keys.e:
      case Keys.E:
        execState.start = execState.pos;
        execState.end = Math.min(execState.newPos + 1, execState.max);
        execState.newPos = execState.start;
        break;
      case Keys.G:
      case Keys.j:
      case Keys.k:
      case Keys.LF:
        if (execState.newPos != execState.pos ||
            execState.motion == Keys.G) {
          execState.start = Math.min(execState.pos, execState.newPos);
          execState.end = Math.max(execState.pos, execState.newPos);
          execState.start = this.findStartOfLine(execState.start);
          execState.end = this.findEndOfLine(execState.end);
          if (execState.cmd == Keys.d) {
            ++execState.end;
            // The extra +1 is to trim the newline.  If there is no
            // trailing one, use the leading one instead, if any.
            if (execState.end > execState.max) {
              execState.end = execState.max;
              --execState.start;
              if (execState.start < 0) {
                execState.addNewline = true;
                execState.start = 0;
              } else {
                execState.rotateNewline = true;
              }
            }
          } else if (execState.cmd == Keys.y) {
            if (execState.motion == Keys.G) {
              execState.newPos = execState.pos;
            } else {
              execState.newPos = Math.min(execState.pos, execState.newPos);
            }
          } else {
            if (execState.end == execState.max &&
                execState.motion == Keys.G && execState.cmd == Keys.d) {
              execState.newPos =
                  this.findStartOfLine(execState.newPos - 1);
            } else {
              execState.newPos = execState.start;
            }
            execState.newPos += this.findNonSpaceCharOrEnd(execState.end) -
                execState.end;
          }
        }
        break;
      case Keys.l:
        if (execState.newPos - execState.pos < execState.mul) {
          // At EOLN, one char short
          if (execState.newPos == execState.max - 1) {
            ++execState.newPos;
          } else if (this.getCharAtPos(execState.newPos) != Consts.EOLN) {
            ++execState.newPos;
          }
        }
        if (execState.newPos != execState.pos) {
          execState.start = Math.min(execState.pos, execState.newPos);
          execState.end = Math.max(execState.pos, execState.newPos);
          if (execState.cmd == Keys.y) {
            execState.newPos = execState.pos;
          } else {
            execState.newPos = execState.start;
          }
        }
        break;
      case Keys.w:
      case Keys.W:
        if (execState.newPos != execState.pos) {
          execState.start = execState.pos;
          execState.end = execState.newPos;
          execState.newPos = execState.start;
          if (execState.cmd == Keys.c) { // Leave the trailing whitespace
            execState.end = this.findPrevWhitespaceStart(execState.end);
          }
        }
        break;
      default:
        if (execState.newPos != execState.pos) {
          execState.start = Math.min(execState.pos, execState.newPos);
          execState.end = Math.max(execState.pos, execState.newPos);
          execState.newPos = execState.start;
        }
        break;
    }
  }

  function computeMotionFromVisualMode(execState) {
    if (execState.visualDX || execState.visualDY) {
      // DOT command.
      execState.start = execState.pos;
      var pos = execState.start;
      if (execState.visualDY) {
        var delta = execState.visualDY;
        assert(delta > 0);
        while ((delta > 0) && (pos < execState.max)) {
          var eol = this.findEndOfLine(pos);
          if (eol < execState.max) { // If there is life after eol
            pos = eol + 1; // First char of next line
            --delta;
          } else {
            pos = execState.max;
            break;
          }
        }
      }
      if (execState.visualDX && pos < execState.max) {
        var eoln = this.findEndOfLine(pos);
        if ((eoln - pos) > execState.visualDX) {
          pos = pos + execState.visualDX;
        } else {
          pos = eoln;
        }
      }
      execState.end = pos;
      execState.truePos = pos;
      if (execState.visual == Keys.V) {
        execState.start = this.findStartOfLine(execState.start);
        if (execState.visualDX) { // Move on to EOLN.
          execState.end = this.findEndOfLine(execState.end);
          if (execState.end < execState.max) {
            ++execState.end;
          }
        }
      }

      // They were pulled from the LAST values; this keeps them.
      this.setVar(VarNames.VISUAL_DX, execState.visualDX);
      this.setVar(VarNames.VISUAL_DY, execState.visualDY);
    } else {
      execState.start = this.getSelectionStart();
      execState.end = this.getSelectionEnd();
      var split = this.getSelectionText().split(Consts.EOLN);
      this.setVar(VarNames.VISUAL_DX, split[split.length - 1].length);
      this.setVar(VarNames.VISUAL_DY, split.length - 1);
    }
    execState.truePos = this.getCursorPos();
    this.setVar(VarNames.VISUAL_USED, execState.visual);
    if (execState.visual == Keys.V) {
      execState.isLinewise = true;
    }
    this.clearVisualVars();
    execState.newPos = execState.start;
  }

  // Check to see if we're in one of the non-decodable complete commands, which
  // needs to get processed now that we've computed the active region.
  function processVisualRegionIfNeeded(execState) {
    var text = this.getText(execState.start, execState.end);
    switch(execState.cmd) {
      case Keys.J:
        this.doJoin(execState, execState.start, execState.end, text);
        break;
      case Keys.r:
        {
          var inputChar = String.fromCharCode(execState.inputCharCode);
          execState.newText = text.replace(/[^\n]/g, inputChar);
          if (execState.inputCharCode == Keys.LF) {
            ++execState.newPos;
          }
        }
        break;
      case Keys.p:
      case Keys.P:
        execState.newText = this.getReg(execState.reg);
        var wasLinewise = this.regIsLinewise(execState.reg);
        if (wasLinewise && execState.visual == Keys.v) {
          // Add a leading newline
          execState.newText = Consts.EOLN + execState.newText;
        } else if (!wasLinewise && execState.visual == Keys.V) {
          --execState.end; // Leave the trailing newline
        }
        break;
      case Keys.TILDE:
        this.doTilde(execState, execState.start, text);
        if (execState.visual == Keys.V) {
          // Ignore the trailing newline.
          var lastEoln = text.lastIndexOf(Consts.EOLN, text.length - 2);
          if (lastEoln < execState.truePos - execState.start) {
            execState.newPos = execState.start;
          } else {
            execState.newPos = execState.truePos;
          }
        } else {
          execState.newPos = execState.start;
        }
        break;
      default:
        break;
    }
  }

  function computeMotionForExec(execState) { // c, d, y, or just moving
    if (execState.cmd == execState.motion) { // cc or dd or yy
      this.computeMotionForDoubleLetter(execState);
    } else if (execState.motion == Consts.VISUAL) {
      this.computeMotionFromVisualMode(execState);
      this.processVisualRegionIfNeeded(execState);
    } else {
      execState.newPos = this.computePosition(execState);
      if (execState.newPos == -1) {
        // Could not move.  That's OK in VISUAL.
        if (this.getVar(VarNames.VISUAL)) {
          execState.newPos = execState.pos;
        } else {
          this.abortCommand();
        }
      }
      if (execState.cmd != null) { // Else we just use execState.newPos.
        this.computeMotionWithCommand(execState);
      }
    }
  }

  function doJoin(execState, start, end, text) {
    var regex = /[ \t]*(\n[ \t]*)+/g;
    execState.start = start;
    execState.end = end;
    execState.newText = text.replace(regex, Consts.SPACE);
    execState.newPos = execState.start + execState.newText.length - 1;
  }

  function computeNonMotionForExec(execState) {
  // handles ^b^d^e^f^yaAiIJoOpPrR~;
    switch (execState.cmd) {
      case Keys.CTRL_B:
      case Keys.CTRL_D:
      case Keys.CTRL_E:
      case Keys.CTRL_F:
      case Keys.CTRL_U:
      case Keys.CTRL_Y:
        this.handleScroll(execState.mul, execState.cmd);
        execState.scrolling = true;
        execState.newPos = execState.pos;
        break;
      case Keys.a:
        if (execState.motion == Consts.VISUAL) {
          this.abortCommand();
        }
        if (this.getCharAtPos(execState.pos) != Consts.EOLN) {
          execState.newPos = execState.pos + 1;
        } else {
          execState.newPos = execState.pos;
        }
        execState.nextMode = ModeNames.INSERT;
        break;
      case Keys.A:
        if (execState.motion == Consts.VISUAL) {
          this.abortCommand();
        }
        execState.newPos = this.findEndOfLine();
        execState.nextMode = ModeNames.INSERT;
        break;
      case Keys.I:
        if (execState.motion == Consts.VISUAL) {
          this.abortCommand();
        }
        execState.newPos = this.findStartOfLine();
        execState.newPos = this.findNonSpaceCharOrEnd(execState.newPos);
        execState.nextMode = ModeNames.INSERT;
        break;
      case Keys.i:
        if (execState.motion == Consts.VISUAL) {
          this.abortCommand();
        }
        execState.newPos = execState.pos;
        execState.nextMode = ModeNames.INSERT;
        break;
      case Keys.J:
        {
          var regex =
              new RegExp("(([ \t]*\\n[ \t]*)[^\\n]*){" + (execState.mul - 1) +
                  "}[ \t]*\\n[ \t]*", "g");
          var pos = execState.pos;
          var text = this.getText(pos, execState.max);
          var match = regex.exec(text);
          if (!match) {
            this.abortCommand();
          }
          var start = pos + match.index;
          var end = regex.lastIndex + pos;
          text = text.substring(match.index, regex.lastIndex);
          this.doJoin(execState, start, end, text);
        }
        break;
      case Keys.o:
        if (execState.motion == Consts.VISUAL) {
          this.abortCommand();
        }
        this.setVar(VarNames.UNDO_O, execState.pos);
        execState.wasLinewise = true; // For execState.repeating.
        execState.start = this.findEndOfLine();
        execState.end = execState.start;
        execState.newPos = execState.start + 1;
        execState.newText = Consts.EOLN;
        execState.nextMode = ModeNames.INSERT;
        break;
      case Keys.O:
        if (execState.motion == Consts.VISUAL) {
          this.abortCommand();
        }
        this.setVar(VarNames.UNDO_O, execState.pos);
        execState.wasLinewise = true; // For execState.repeating.
        execState.start = this.findStartOfLine();
        execState.end = execState.start;
        execState.newText = Consts.EOLN;
        execState.nextMode = ModeNames.INSERT;
        break;
      case Keys.p:
        execState.newText = this.getReg(execState.reg);
        execState.wasLinewise = this.regIsLinewise(execState.reg);
        if (execState.wasLinewise) {
          execState.pastePos = this.findEndOfLine();
          if (execState.pastePos < execState.max) {
            ++execState.pastePos;
          }
        } else {
          execState.pastePos = Math.min(execState.pos + 1, execState.max);
        }
        break;
      case Keys.P:
        execState.newText = this.getReg(execState.reg);
        execState.wasLinewise = this.regIsLinewise(execState.reg);
        if (execState.wasLinewise) {
          execState.pastePos = this.findStartOfLine();
        } else {
          execState.pastePos = execState.pos;
        }
        break;
      case Keys.r:
        {
          if (execState.inputCharCode == KeyCodes.BS) {
            this.abortCommand();
          }
          var inputChar = String.fromCharCode(execState.inputCharCode)
          var offset = 1;
          execState.newText = inputChar;
          if (execState.inputCharCode != Keys.LF) { // Never add more than 1 LF
            for (var i=1; i < execState.mul; ++i) {
              // Faster to push on an array then use join?
              execState.newText += inputChar;
            }
          } else {
            offset = 0;
          }
          var eoln = this.getText(execState.pos,
              execState.pos + execState.mul).indexOf(Consts.EOLN);
          if (eoln != -1) {
            this.abortCommand();
          }
          execState.start = execState.pos;
          execState.end = execState.pos + execState.mul;
          execState.newPos = execState.start + execState.newText.length
              - offset;
          this.setReg(RegNames.INS, inputChar);
        }
        break;
      case Keys.R:
        execState.newPos = execState.pos;
        execState.nextMode = ModeNames.OVERWRITE;
        break;
      case Keys.TILDE:
        var start = execState.pos;
        var end = start + execState.mul;
        var text = this.getElementText().slice(start, end);
        var eoln = text.indexOf(Consts.EOLN);
        if (!eoln) { // Could not move.
          return null;
        }
        if (eoln != -1) {
          text = text.slice(0, eoln);
        }
        this.doTilde(execState, start, text);
        execState.newPos = execState.end;
        break;
      default:
        alertCharCode("execState.cmd was ", execState.cmd);
        break;
    }
  }

  function applyBasicEdit(execState) {
    // Action including deleting/inserting/yanking text, not just e.g. getting
    // into insert mode.
    var selection;
    if (execState.cmd == Keys.y) {
      selection = this.getRange(execState.start, execState.end);
    } else {
      // Unless execState.repeating, execState.delChars is zero.
      this.deleteChars(execState.end, execState.mul * execState.delChars);
      selection = this.replaceRange(execState.start, execState.end,
          execState.newText);
    }
    if (execState.rotateNewline) {
      selection = selection.slice(1) + Consts.EOLN;
    } else if (execState.addNewline) {
      selection += Consts.EOLN;
    }
    if (execState.start != execState.end) {
      // Only set execState.reg if deleting something
      var linewise = execState.isLinewise ||
          isLinewise(execState.cmd, execState.motion);
      if (execState.cmd != Keys.TILDE) {
        this.setReg(RegNames.DEF, selection, linewise);
        if (execState.reg != null &&
            execState.cmd != Keys.p && execState.cmd != Keys.P) {
          this.setReg(execState.reg, selection, linewise);
        }
      }
    }
    if (execState.newPos == null) {
      execState.newPos = execState.start;
    }
    if (execState.cmd == Keys.c) {
      execState.nextMode = ModeNames.INSERT;
    }
    if (execState.nextMode != ModeNames.INSERT) {
      execState.newPos = this.fixupEndOfLineMotion(execState.newPos);
    }
    this.setCursorPos(execState.newPos);
    this.clearVar(VarNames.COL);
    execState.repeatable = true;
  }

  // VISUAL doesn't use this code.
  function applyPaste(execState) {
    if (execState.newText.length > 0) {
      var single = execState.newText;
      for (var i=1; i < execState.mul; ++i) {
        execState.newText += single;
      }
      if (execState.wasLinewise && execState.pastePos == execState.max
          && execState.pastePos > 0 &&
          this.getCharAtPos(execState.pastePos - 1) != Consts.EOLN) {
        this.replaceRange(execState.pastePos, execState.pastePos,
            Consts.EOLN);
        ++execState.pastePos;
      } else if (!execState.wasLinewise && execState.cmd == Keys.p &&
          this.getCharAtPos(execState.pos) == Consts.EOLN &&
          execState.pastePos) {
        // 'p' on an empty line goes before the EOLN.
        --execState.pastePos;
      }
      this.replaceRange(execState.pastePos, execState.pastePos,
          execState.newText);
      if (execState.wasLinewise) {
        this.setCursorPos(
            this.fixupEndOfLineMotion(
                this.findNonSpaceCharOrEnd(execState.pastePos)));
      } else {
        this.setCursorPos(execState.pastePos + execState.newText.length - 1);
      }
    }
    this.clearVar(VarNames.COL);
    execState.repeatable = true;
  }

  function applyMotion(execState) {
    if (execState.cmd) {
      this.deleteChars(execState.newPos, execState.mul * execState.delChars);
    }
    if (execState.nextMode == ModeNames.INSERT) {
      this.setCursorPos(execState.newPos);
      execState.repeatable = true;
    } else {
      this.setCursorPos(this.fixupEndOfLineMotion(execState.newPos));
      if (execState.motion != Keys.j && execState.motion != Keys.k) {
        // this motion just set COL
        if (execState.motion == Keys.DOLLAR) {
          this.setVar(VarNames.COL, Infinity);
        } else if (execState.motion == Keys.PIPE) {
          this.setVar(VarNames.COL, execState.mul);
        } else {
          this.clearVar(VarNames.COL);
        }
      }
    }
  }

  function applyNonMotion(execState) {
    // Unless repeating a command such as [aIA], execState.delChars
    // will be zero here.
    this.deleteChars(execState.pos, execState.mul * execState.delChars);
    // We did not move, since we were already at 0 or $.
    if (execState.motion == Keys.DOLLAR) {
      this.setVar(VarNames.COL, Infinity);
    } else if (execState.motion != Keys.PIPE) {
      this.clearVar(VarNames.COL);
    }
  }

  function applyRepeatedInsertion(execState) {
    // Go ahead and do the insert/overwrite; the above code has only done the
    // deletion described by the motion, if any, setting up register DEF.  We
    // don't set execState.repeatable here since we're doing our own repeating
    // of the inserted text, as appropriate, and the above code has repeated
    // any motions necessary to the deletion and positioning.
    execState.newText = this.getReg(RegNames.INS);
    execState.start = this.getCursorPos();
    execState.end = execState.start;
    if (execState.newText.length > 0) {
      if (isRepeatableInsertCommand(execState.cmd)) {
        var single = execState.newText;
        if (execState.wasLinewise) {
          single = Consts.EOLN + single;
        }
        for (var i=1; i < execState.mul; ++i) {
          execState.newText += single;
        }
        if (execState.nextMode == ModeNames.OVERWRITE) {
          execState.end = execState.start + execState.newText.length;
          var oldText = this.getRange(execState.start, execState.end);
          var eoln = oldText.indexOf(Consts.EOLN);
          if (eoln != -1) {
            execState.end = execState.start + eoln;
          }
        }
      }
      this.replaceRange(execState.start, execState.end, execState.newText);
      this.setCursorPos(execState.start + execState.newText.length - 1);
    }
    this.clearVar(VarNames.COL);
    execState.nextMode = ModeNames.COMMAND;
  }

  function applyChanges(execState) {
    if (execState.start != null) {
      this.applyBasicEdit(execState);
    } else if (execState.pastePos != null) {
      this.applyPaste(execState);
    } else if (execState.newPos != execState.pos) { // Motion
      this.applyMotion(execState);
    } else if (isOKNotToMove(execState.motion)) {
      this.applyNonMotion(execState);
    } else if (execState.nextMode == ModeNames.INSERT ||
        execState.nextMode == ModeNames.OVERWRITE) {
      // Some commands only do this.
      this.deleteChars(execState.newPos, execState.mul * execState.delChars);
      // Only hit if execState.repeating.
      execState.repeatable = true;
    } else if (execState.scrolling) {
      // Just set up for endCommand.
      execState.nextMode = this.getMode();
    } else if (this.getVar(VarNames.VISUAL)) {
      // Failed to move, but we stay in visual mode without complaining.
    } else {
      this.abortCommand(); // Could not move.  Does not return.
    }
    if (execState.repeating &&
        (execState.nextMode == ModeNames.INSERT ||
         execState.nextMode == ModeNames.OVERWRITE)) {
      this.applyRepeatedInsertion(execState);
    }
  }

  function executeArgs(execState) {
    if (execState.motion != null) { // c, d, y, anything visual, or just moving
      this.computeMotionForExec(execState);
    } else {
      this.computeNonMotionForExec(execState);
    }
    // OK, having done the computations, let's carry out the request.
    this.applyChanges(execState);

    // This is where the initial handling of most commands normally ends, and
    // also where '.' completes.
    this.endCommand(execState.nextMode,
        execState.repeatable && !execState.inhibitRepeatable, false);
    if (execState.motion == Keys.G && execState.cmd != Keys.y) {
      if (!execState.mul) {
        scrollToBottom(this.e);
      } else if (execState.mul == 1) {
        scrollToTop(this.e);
      }
    }
  }

  // inhibitRepeatable means that we're using the command infrastructure to
  // implement part of a more-complex command, so we don't want to store it for
  // use by DOT.
  function execute(inhibitRepeatable) {
    var cmd = this.getVar(VarNames.CMD);
    var motion = this.getVar(VarNames.MOTION);
    var inputCharCode = this.getVar(VarNames.INPUT_CHAR_CODE);
    var seek;
    var seekChar;
    var search;
    var searchStr;
    var visualDX;
    var visualDY;
    if (motion == Consts.SEEK) {
      seek = this.getVar(VarNames.SEEK);
      seekChar = this.getVar(VarNames.SEEK_CHAR);
    } else if (motion == Consts.SEARCH) {
      search = this.getVar(VarNames.SEARCH);
      searchStr = this.getVar(VarNames.SEARCH_STR);
    }
    var defaultMul = 1; // TODO: Why set to 1 here *and* in computePosition?
    if (motion == Keys.G) {
      defaultMul = null;
    }
    var mul = this.getVar(VarNames.MUL, defaultMul);
    var reg = this.getVar(VarNames.REG);
    var delChars = 0;
    var visual = this.getVar(VarNames.VISUAL);
    var repeating;
    if (cmd == Keys.DOT) {
      motion = this.getVar(VarNames.LAST_MOTION);
      defaultMul = 1;
      if (motion == Keys.G) {
        defaultMul = null;
      } else if (motion == Consts.SEEK) {
        seek = this.getVar(VarNames.LAST_SEEK);
        seekChar = this.getVar(VarNames.LAST_SEEK_CHAR);
      } else if (motion == Consts.SEARCH) {
        search = this.getVar(VarNames.LAST_SEARCH);
        searchStr = this.getVar(VarNames.LAST_SEARCH_STR);
      } else if (motion == Consts.VISUAL) {
        visualDX = this.getVar(VarNames.LAST_VISUAL_DX);
        visualDY = this.getVar(VarNames.LAST_VISUAL_DY);
        visual = this.getVar(VarNames.LAST_VISUAL_USED);
      }
      cmd = this.getVar(VarNames.LAST_CMD);
      if (!cmd) {
        this.abortCommand();
      }
      if (cmd == Keys.r) {
        inputCharCode = this.getVar(VarNames.LAST_INPUT_CHAR_CODE);
      }
      mul = this.getVar(VarNames.MUL,
        this.getVar(VarNames.LAST_MUL, defaultMul));
      reg = this.getVar(VarNames.LAST_REG);
      delChars = this.getVar(VarNames.LAST_DEL_CHARS);
      repeating = true;
    }
    if (cmd == Keys.u) { // Undo is special
      if (inhibitRepeatable) {
        popup("inhibitRepeatable during undo!");
      }
      if (this.undoModeVi) {
        var text = this.e;
        if (text.jsvimUndoing) {
          text.jsvimUndoing = false;
          this.redo(mul);
        } else {
          text.jsvimUndoing = true;
          this.undo(mul);
        }
      } else {
        this.undo(mul);
      }
    } else if (cmd == Keys.CTRL_R) { // Redo is special
      if (inhibitRepeatable) {
        popup("inhibitRepeatable during redo!");
      }
      if (this.undoModeVi) {
        if (this.e.jsvimUndoing) {
          this.undo(mul);
        } else {
          this.redo(mul);
        }
      } else {
        this.redo(mul);
      }
    } else {
      var execState = new ExecState(this, mul, reg, cmd, motion, seek, seekChar,
        search, searchStr, visual, delChars, repeating, inhibitRepeatable);
      if (visualDX != null) {
        execState.visualDX = visualDX;
        execState.visualDY = visualDY;
      }
      if (inputCharCode != null) {
        execState.inputCharCode = inputCharCode;
      }
      this.executeArgs(execState);
    }
  }

  // Keycodes are the same as charcodes here.
  function convertControlKey(code) {
    if (code >= Keys.a && code <= Keys.z) {
      code = code - Keys.a + 1; // Convert to control key, with ^a being 1.
      // We don't ctrl-convert capital letters, so as not to lose the shift.
    } else if (isChrome() && code >= Keys.A && code <= Keys.Z) {
      // On Chrome all ctrl keys come through as caps; tell the difference with
      // event.shiftKey.
      code = code - Keys.A + 1; // Convert to control key, with ^a being 1.
    }
    // TODO: Fold CR to LF?
    return code;
  }

  // This should only be called if you know that ctrl is down.
  function getFoldedKeyCode(event) {
    var code;
    if (event.keyCode) {
      code = this.convertControlKey(event.keyCode);
    }
    return code;
  }

  function getCharCode(event) {
    var code = 0;
    if (event.which && (event.charCode == event.which)) {
      code = event.which;
      if (event.ctrlKey) {
        code = this.convertControlKey(code);
      }
    }
    if (code == Keys.CR) {
      code = Keys.LF;
    }
    return code;
  }

  function handleBackspace(mode, count) {
    var text = this.getReg(RegNames.INS);
    var beep = true;
    if (text.length) {
      if (count <= text.length) {
        beep = false;
      } else {
        count = text.length;
      }
      text = text.slice(0, text.length - count);
      this.setReg(RegNames.INS, text);
      var putBack = Consts.EMPTY;
      var overage;
      var putBackLen = 0;
      if (mode == ModeNames.OVERWRITE) {
        overage = this.getVar(VarNames.OVER_EXTEND_CHARS);
        if (overage >= count) {
          overage -= count;
        } else {
          putBackLen = count - overage;
          overage = 0;
          text = this.getVar(VarNames.OVER);
          putBack = text.substring(text.length - putBackLen);
          text = text.slice(0, text.length - putBackLen);
          this.setVar(VarNames.OVER, text);
        }
        this.setVar(VarNames.OVER_EXTEND_CHARS, overage);
      }
      var pos = this.getCursorPos() - count;
      this.replaceRangeNoUndo(pos, pos + count, putBack);
      this.trimUndoRecord(mode == ModeNames.OVERWRITE, count, putBackLen);
      this.setCursorPos(pos);
    }
    if (beep) {
      this.beep();
    }
  }

  function handleCtrlU(mode) {
    var text = this.getReg(RegNames.INS);
    if (text.length) {
      // Delete back to the last inserted newline, or all the way, if none.
      var pos = text.lastIndexOf(Consts.EOLN, text.length - 2);
      var count;
      if (pos == -1) {
        count = text.length;
      } else {
        // Leave the newline if there's anything after it.
        count = Math.max(text.length - pos - 1, 1);
      }
      this.handleBackspace(mode, count);
    } else {
      this.beep();
    }
  }

  // The flag inhibitRepeatable says that we're using arrow keys or other
  // special motion keys in insert or overwrite mode.  We do this by setting the
  // mode to COMMAND temporarily, turning them into normal motion keys
  // [right-arrow into l, etc.], handling them while inhibiting repeat, handling
  // the appropriate key to get back into the right mode.
  function handleCharCode(ctrl, inputCharCode, inhibitRepeatable) {
    var mode = this.getMode();
    var inReplace = mode == ModeNames.COMMAND &&
          this.getVar(VarNames.CMD) == Keys.r;
    if (inputCharCode == Keys.ESC || inputCharCode == Keys.CTRL_C ||
        (ctrl && inputCharCode == KeyCodes.L_BRAC)) {
      this.handleEsc();
    } else if (mode == ModeNames.INSERT || mode == ModeNames.OVERWRITE) {
      if (inputCharCode >= Keys.SPACE || inputCharCode == Keys.TAB ||
          inputCharCode == Keys.LF) {
        // Printable, mostly.
        // Peek ahead to see if we have a backlog of characters to handle.  As
        // long as they're just simple insertions of displayable chars, it's
        // trivial to handle them in a single operation.
        var inputArray = [String.fromCharCode(inputCharCode)];
        var queue = this.getQueue();
        while (!queue.isEmpty()) {
          var elt = queue.peek();
          if (elt.handler == Consts.CHARCODE && !elt.ctrl) {
            var c = elt.inputCode;
            if (c >= Keys.SPACE || c == Keys.TAB || c == Keys.LF) {
              inputArray.push(String.fromCharCode(c));
              queue.pop();
              continue;
            } else if (c == Keys.BS) {
              if (inputArray.length) {
                inputArray.pop();
                queue.pop();
                continue;
              }
            }
          }
          break;
        }
        if (inputArray.length) { // Else backspace ate all the keys.
          var inputString = inputArray.join(Consts.EMPTY);

          this.setReg(RegNames.INS, this.getReg(RegNames.INS) + inputString);
          var pos = this.getCursorPos();
          var end = pos;
          if (mode == ModeNames.OVERWRITE) {
            var extendChars = this.getVar(VarNames.OVER_EXTEND_CHARS, 0);
            var hitNewline = false;
            for (var i=0; !hitNewline && i < inputString.length; ++i) {
              if (pos + i < this.getMaxPos() &&
                  this.getCharCodeAtPos(pos + i) != Keys.LF) {
                ++end; // todo: Optimize?  Not worth it?
              } else {
                // We're extending the line by adding a char, despite being in
                // overwrite mode.  Count these extra chars, so that on a
                // backspace we know not to put back anything from Var OVER.
                hitNewline = true;
                extendChars += inputString.length - i;
                break;
              }
            }
            if (extendChars) {
              this.setVar(VarNames.OVER_EXTEND_CHARS, extendChars);
            }
          }
          var removed = this.replaceRange(pos, end, inputString);
          this.setCursorPos(pos + inputString.length);
          if (mode == ModeNames.OVERWRITE) {
            this.setVar(VarNames.OVER, this.getVar(VarNames.OVER) + removed);
          }
        }
      } else if (inputCharCode == Keys.BS) {
        var count = 1;
        var queue = this.getQueue();
        while (!queue.isEmpty()) {
          var entry = queue.peek();
          if (entry.handler == Consts.CHARCODE &&
              entry.inputCode == Keys.BS) {
            queue.pop();
            ++count;
          } else {
            break;
          }
        }
        this.handleBackspace(mode, count);
      } else if (inputCharCode == Keys.CTRL_U) {
        this.handleCtrlU(mode);
      }
    } else {
      if (inputCharCode == Keys.TAB && !inReplace) {
        // I appear to have hit this assert some number of revisions ago, but
        // I'm not sure how.
        assert(false); // Now handled above.
      } else {
        switch (mode) {
          case ModeNames.COMMAND:
            if (inputCharCode == Keys.z && !inReplace) { // info-dumping key
              dumpTimingEvents();
              return;
            }
            this.handleCommandModeInput(inputCharCode, inReplace,
                inhibitRepeatable);
            break;
          case ModeNames.IN_REG:
            this.handleRegModeInput(inputCharCode);
            break;
          case ModeNames.IN_NUM:
            this.handleNumModeInput(inputCharCode, false);
            break;
          case ModeNames.SEEK:
            this.handleSeekModeInput(inputCharCode);
            break;
          case ModeNames.SEARCH:
            this.handleSearchModeInput(inputCharCode);
            break;
          default:
            popup("Didn't recognize MODE " + this.getMode());
        }
      }
    }
  }

  function motionFromKeyCode(keyCode) {
    switch (keyCode) {
      case KeyCodes.ARROW_L:
        return Keys.h;
      case KeyCodes.ARROW_U:
        return Keys.k;
      case KeyCodes.ARROW_R:
        return Keys.l;
      case KeyCodes.ARROW_D:
        return Keys.j;
      case KeyCodes.END:
        return Keys.DOLLAR;
      case KeyCodes.HOME:
        return Keys.N_0;
      default:
        break;
    }
    return 0;
  }

  function isIgnoredKeyCode(ctrl, shift, keyCode) {
    switch (keyCode) {
      case KeyCodes.SHIFT:
        return true;
      case KeyCodes.CTRL:
        return true;
      case Keys.CTRL_R:
        return shift;
      case Keys.CTRL_V:
        return true;
      case KeyCodes.CAPS_LK:
        return true;
      case KeyCodes.PAUSE:
        return true;
      case KeyCodes.NUM_LK:
        return true;
      default:
    }
    return false;
  }

  function isHandledAsCharCode(keyCode) {
    return keyCode <= 27 || keyCode == KeyCodes.L_BRAC;
  }

  function handleKeyCodeAsMotion(motion) {
    switch (this.getMode()) {
      case ModeNames.IN_NUM:
        // Beware of KeyCodes.HOME, which translates to 0 as a motion, but not
        // as a number.
        if (motion == Keys.N_0) {
          this.handleNumModeInput(motion, true);
          break;
        }
        // Else fall through.
      case ModeNames.COMMAND:
        // Not right if ctrl, but close enough for now.
        // todo: Make ctrl-home/end go to start/end of buffer when G is
        // implemented, ctrl-page-up/down do nothing.
        this.handleCharCode(false, motion, false);
        break;
      case ModeNames.INSERT:
        // todo: This call should inhibit the multiplier, but not the saving of
        // it, unless subsequent text is typed.  That is, '7ifoo<left>bar' will
        // throw away the 7 entirely; however '7ifoo<left>' will not repeat foo
        // yet, but will upon a subsequent '.'.
        // Currently we inhibit the 7 entirely.
        this.endCommand(ModeNames.COMMAND, true, true);
        this.handleCharCode(false, motion, true);
        this.handleCharCode(false, Keys.i, true);
        break;
      case ModeNames.OVERWRITE:
        // todo: This call should inhibit the multiplier, but not the saving of
        // it, unless subsequent text is typed.  That is, '7ifoo<left>bar' will
        // throw away the 7 entirely; however '7ifoo<left>' will not repeat foo
        // yet, but will upon a subsequent '.'.
        // Currently we inhibit the 7 for the foo, but use it on the bar.  Oops.
        this.endCommand(ModeNames.COMMAND, true, true);
        this.handleCharCode(false, motion, true);
        this.handleCharCode(false, Keys.R, true);
        break;
      default:
        popup("Didn't recognize MODE " + this.getMode());
        // Fall through.
      case ModeNames.IN_REG:
        this.abortCommand();
        break;
    }
  }

  function handleKeyCodeDel() {
    switch (this.getMode()) {
      case ModeNames.COMMAND:
        if (this.getVar(VarNames.CMD) == Keys.r) {
          this.abortCommand();
        }
        // ...else fall through.
      case ModeNames.IN_NUM:
        this.handleCharCode(false, Keys.x, false);
        break;
      case ModeNames.INSERT:
      case ModeNames.OVERWRITE:
        var pos = this.getCursorPos();
        var end = this.getMaxPos();
        if (pos < end) {
          this.deleteChars(pos, 1);
          this.setVar(VarNames.LAST_DEL_CHARS,
            this.getVar(VarNames.LAST_DEL_CHARS, 0) + 1);
        } else {
          this.beep();
        }
        break;
      default:
        popup("Didn't recognize MODE " + this.getMode());
        // Fall through.
      case ModeNames.IN_REG:
        this.abortCommand();
      case ModeNames.SEARCH:
        this.handleCharCode(false, Keys.BS, false);
        break;
      case ModeNames.SEEK:
        this.abortCommand();
    }
  }

  function handleEsc() {
    if (jsvim.divhackJustEatEsc || (jsvim.e && jsvim.e.jv_just_eat_esc)) {
      return;
    }
    // This is where Escape et al are normally handled, including the end of
    // insert+overwrite mode.

    // Special-case this search stuff because it's really hard to tell in
    // endCommand whether it's a completed search or a cancelled one.
    var pos = this.getVar(VarNames.SEARCH_START_POS);
    var mode = this.getMode();
    var inReplace = mode == ModeNames.COMMAND &&
          this.getVar(VarNames.CMD) == Keys.r;
    if (pos != null) {
      // Allow cancelling search without cancelling VISUAL.
      this.setCursorPos(pos);
    } else if (inReplace) {
      // Just let the replace be cancelled.
    } else {
      pos = this.getVar(VarNames.VISUAL_END_POS);
      if (pos != null) {
        this.clearVisualVars();
        this.setCursorPos(pos);
      }
    }
    this.endCommand(ModeNames.COMMAND, false, false);
  }

  function handleKeyCode(ctrl, inputKeyCode) {
    if (isHandledAsCharCode(inputKeyCode)) {
      this.handleCharCode(ctrl, inputKeyCode, false);
    } else {
      var charCode;
      if (charCode = motionFromKeyCode(inputKeyCode)) {
        this.handleKeyCodeAsMotion(charCode);
      } else if (inputKeyCode == KeyCodes.DEL) {
        this.handleKeyCodeDel();
      } else {
        this.handleUnrecognizedChar();
      }
    }
  }

  var flickerToRangeTimeoutId;
  var flickerToRangeStart;
  var flickerToRangeEnd;

  function doFlickerToRange(jsvim) {
    jsvim.setSelection(flickerToRangeStart, flickerToRangeEnd);
    flickerToRangeTimeoutId = null;
  }

  function flickerToRange(jsvim, start, end) {
    flickerToRangeStart = start;
    flickerToRangeEnd = end;
    flickerToRangeTimeoutId = setTimeout(
      function () {
        doFlickerToRange(jsvim);
      },
      0);
  }

  var eventToIgnore;
  var eventHandledAlready; // ESC gets grabbed globally, so GMail can't steal it

  // TODO: This all needs a rewrite, given that it's failing in current GMail
  // and getting messed with for Chrome.
  function handledElsewise(event, handleAnyway) {
    if (!handleAnyway) {
      // Don't set the text area if it's an event we grabbed early, since the
      // target's wrong.
      if (!isChrome()) {
        this.setTextArea(event.originalTarget);
      }
      if (!this.shouldHandleKeypress(event)) {
        return true;
      }
    }
    if (event === eventHandledAlready) {
      return true;
    }
    if (handleAnyway) {
      eventHandledAlready = event;
    }
    if (eventToIgnore) {
      if (event === eventToIgnore) {
        eventToIgnore = null;
        var start = this.getVar(VarNames.FLICKER_START_SEL);
        if (start != null) { // Check needed for race?
          var end = this.getVar(VarNames.FLICKER_END_SEL);
          this.clearVar(VarNames.FLICKER_START_SEL);
          this.clearVar(VarNames.FLICKER_END_SEL);
          flickerToRange(this, start, end);
        }
        return true;
      } else {
        // Undo the first half of the flicker, and cancel the second half by
        // cancelling the timer.
        // Then just handle the event as usual.
        popup("eventToIgnore MISMATCH!");
        if (!flickerTimeoutId) {
          popup("null flickerTimeoutId!");
        } else {
          clearTimeout(flickerTimeoutId);
          flickerTimeoutId = null;
        }
        eventToIgnore = null;
        if (this.getVar(VarNames.VISUAL)) {
          this.highlightVisualRange();
        } else {
          this.setCursorPos(this.getCursorPos() - flickerOffset);
        }
      }
    }

    return false;
  }

  function handleOneQueueItem(handler, ctrl, inputCode) {
    if (handler == Consts.CHARCODE) {
      this.handleCharCode(ctrl, inputCode, false);
    } else {
      assert(handler == Consts.KEYCODE);
      this.handleKeyCode(ctrl, inputCode);
    }
  }

  function processQueue() {
    if (flickerToRangeTimeoutId) {
      // Got a keystroke in before the timer went off.
      clearTimeout(flickerToRangeTimeoutId);
      // Just take care of it ourselves, then handle the event as usual.
      doFlickerToRange(this);
    }

    var queue = this.getQueue();
    var inhibitFlicker = true;
    try {
      while (!queue.isEmpty()) {
        var entry = queue.pop();
        // This may pop additional entries.
        this.handleOneQueueItem(entry.handler, entry.ctrl, entry.inputCode);

        // Only flicker if all processed keystrokes agree on it.
        inhibitFlicker &= this.noFlickerForOneKeypress;
        this.noFlickerForOneKeypress = false;
      }

      if (this.getCursorPos() == this.getMaxPos()) {
        // triggers a Firefox bug if we flicker while at max; skip it.
        // This is annoying if we've just G to a blank last line, or A to
        // the end of a long line wrapped off the screen, so hard-code a
        // scrollToBottom here.
        inhibitFlicker = true;
        scrollToBottom(this.e);
      }
      if (this.inExtension) {
        if (inhibitFlicker && flickerTimeoutId) {
          clearTimeout(flickerTimeoutId);
          flickerTimeoutId = null;
          eventToIgnore = null;
        }
        if (!inhibitFlicker) {
          this.flicker(this.e);
        }
      }
    } catch (ex) {
      if (ex == Consts.DONE) {
        // Aborted; nothing more to do.
      } else if (ex == "Assertion failed!") {
        // Already displayed.
      } else if (ex.name == "NS_ERROR_FAILURE") {
        // Most likely our textarea just went away due to the action of the page
        // we're editing.  There's nothing we can do, so just give up.
      } else {
        logStack(ex);
        popup("Error in processQueue:\n" + stringifyObj(ex));
      }
      queue.clear();
    }
  }

  var queueTimeoutId;

  function enqueueOrHandle(handler, ctrl, inputCode) {
    var queue = this.getQueue();
    queue.push({
      handler:handler, ctrl:ctrl, inputCode:inputCode
    });
    if (queueTimeoutId) {
      // Clear [and optionally reset] it every time, for robustness.
      clearTimeout(queueTimeoutId);
      queueTimeoutId = null;
    }
    if (queue.isFull()) {
      _debug("jV: somehow filled the queue!");
      this.processQueue();
      this.noFlickerForOneKeypress = false; // 'Cause I said so.
    } else {
      if (this.requestClipboard && handler == Consts.CHARCODE &&
          (inputCode == Keys.p || inputCode == Keys.P) &&
          !this.getVar(VarNames.CMD) &&
          this.getVar(VarNames.REG) == RegNames.CLIP) {
        this.requestClipboard();
        // If the execState is such that we've got REG set to CLIP, and this is
        // a p or P, and we don't yet have a CMD [so it's not something like
        // "+fp, which is silly but possible], then we need to fetch the
        // clipboard and defer processing.  So don't set the timer, just set a
        // var saying that we're waiting for the clipboard and post the message
        // to the background page.  Ah, perhaps that flag can just be the
        // absence of queueTimeoutId?  Hmm...perhaps we don't need a flag at
        // all.  It looks like the worst that'll happen is that we'll call
        // processQueue with an empty queue and maybe do an extra flicker.
        
        // We also need to figure out how to deal with entering this function
        // while we're waiting for clipboard input.  Update: let's just ignore
        // the problem.  It's going to be rare, and the consequence is that we
        // use the last known clipboard value instead of the current value.
        
        // Tricky bit: what if we've got queued up chars that include "+,
        // so we don't have REG set yet, and we process the queue?  We need to
        // be able to stop processing partway through and send the request then.
        // Nah--ignore the problem.  It's rare that there's anything in the
        // queue, and it'll just lead to a stale clipboard paste.

        // We could also preemptively fetch the clipboard on any focus event; I
        // think we only invoke them manually for firefox, so there shouldn't be
        // too many.  With that and the fact that people don't type all that
        // fast, and super-speedy "+p<TAB> is rare, we should really be pretty
        // good just checking for REG=CLIP && key in [Pp].

      } else {
        // Set the timer.
        var temp = this;
        queueTimeoutId = setTimeout(
          function () {
            temp.processQueue();
            queueTimeoutId = null;
          },
          0);
      }
    }
  }

  // TODO: OK, we're going to have to move ALL control keys over to here.  They
  // used to come in as char codes, and now they come in as key codes.  Is there
  // an easy way to do that, or is it all piece-by-piece?  [Note; I believe that
  // this is already done for Chrome; will need to revisit it for FF.]
  function handleKeydown(event, handleAnyway) {
    if (jsvim.divhackJustEatEsc || !jsvim.e || jsvim.e.jv_just_eat_esc) {
      return true;
    }
    if (jsvim.e.jv_divhack) {
      switch (event.keyCode) {
      case KeyCodes.ARROW_L: case KeyCodes.ARROW_U:
      case KeyCodes.ARROW_R: case KeyCodes.ARROW_D:
      case KeyCodes.PAGE_U: case KeyCodes.PAGE_D:
      case KeyCodes.END: case KeyCodes.HOME:
        setTimeout(function() {
          //the key is just going down, so the selection is not changed yet...
          divhackUpdateSelectionFromRange("motion key down");
        }, 100);
      }
    }
    if (event.altKey) {
      return true;
    }
    if (event.keyCode == KeyCodes.CTRL) {
      return true;
    }
    // TODO: This is really ugly; we don't know for sure that ctrl is down yet.
    // In fact, if ctrl is the key pressed, this will be indistinguishable from
    // CTRL_Q, as we're mixing keycodes and charcodes.
    var code = this.getFoldedKeyCode(event);
    // Chrome seems not to produce a keypress on BS, sadly.
    // TODO: Does this break Firefox?
    if (code == KeyCodes.ESC || code == KeyCodes.DEL ||
        (code == KeyCodes.BS && code == event.which) ||
        (!event.ctrlKey && event.keyCode == KeyCodes.TAB) || // Unfolded TAB!
        (event.ctrlKey &&
            !isIgnoredKeyCode(event.ctrlKey, event.shiftKey, code))) {
      return this.handleKeyCore(event, handleAnyway);
    }
  }

  function handleKeypress(event, handleAnyway) {
    // Is this ignoring the right amount?
    if (!event.ctrlKey) {
      this.handleKeyCore(event, handleAnyway);
    }
  }

  // TODO: does keydown have different fields than keypress, or do we already
  // take care of that?
  function handleKeyCore(event, handleAnyway) {
    if (jsvim.divhackJustEatEsc || !this.e || this.e.jv_just_eat_esc) {
      return true;
    }
    if (this.handledElsewise(event, handleAnyway)) {
      return true;
    }
    jsvim = this; // Hack for the non-extension case.
    var allowDefaultAction = true; // Assume we won't handle it.
    var inputCode = this.getCharCode(event);
    try {
      var handler;
      if (inputCode) {
        if (event.ctrlKey && !isRecognizedCtrlKey(inputCode)) {
          return true;
        }
        handler = Consts.CHARCODE;
      } else {
        inputCode = this.getFoldedKeyCode(event);
        if (inputCode) {
          if (isIgnoredKeyCode(event.ctrlKey, event.shiftKey, inputCode)) {
            return true;
          }
          if (inputCode == Keys.TAB) {
            var skip;
            if (this.neverHandleTab) {
              skip = true;
            } else {
              // Problem: we don't want to check the current state, we want the
              // state as of when this key would get processed.  There's no way
              // to get that without flushing.
              this.processQueue();
              if (this.getMode() == ModeNames.COMMAND &&
                  this.getVar(VarNames.CMD) != Keys.r) {
                skip = true;
              }
            }
            if (skip) {
              //this.e = null; // TODO: WTF is up with this?
              return true;
            }
          }
          handler = Consts.KEYCODE;
        } else {
          return true;
        }
      }
      this.enqueueOrHandle(handler, event.ctrlKey, inputCode);
      allowDefaultAction = false;
    } catch (ex) {
      if (ex == Consts.DONE) {
        popup("This should never happen any more.");
      } else if (ex.name == "NS_ERROR_FAILURE") {
        popup("Nor should this.");
        // Most likely our textarea just went away due to the action of the page
        // we're editing.  There's nothing we can do, so just give up.
      } else {
        popup("Error in main handler:\n" + stringifyObj(ex));
      }
    }
    if (!allowDefaultAction && !handleAnyway) {
      // Don't want to inhibit normal ESC stuff if we've grabbed it early; it's
      // not quite right this way, but it lets menus work. todo: What's wrong
      // with it?  Is this comment still true?

      if (event.preventDefault) {
        event.preventDefault();
      }
//      if (event.preventBubble) {
//        event.preventBubble();
//      }
//      if (event.preventCapture) {
//        event.preventCapture();
//      }
      if (event.stopPropagation) {
        event.stopPropagation();
      }
    }
    return allowDefaultAction;
  }

  function handleClick(event) {
    if (!this.shouldHandleClick(event)) {
      return;
    }
    if (shouldInhibitClick) {
      shouldInhibitClick = null;
      return;
    }
    this.setTextArea(event.target);  // Maybe move to handleFocus?
    this.clearVar(VarNames.COL);
    var mode = this.getMode();
    if (mode != ModeNames.INSERT && mode != ModeNames.OVERWRITE) {
      if (this.getVar(VarNames.VISUAL)) {
        this.clearVisualVars();
      }
      this.setCursorPos(this.fixupEndOfLineMotion(this.getCursorPos()));
    }
    this.updateStatusBar();
    //this.flicker(event.target); // No longer needed?
    if (this.divhackDebug) {
      divhackDump("on click");
    }
  }

  var shouldInhibitClick;
  var inhibitClickTimeoutId;
  function inhibitClick() {
    if (inhibitClickTimeoutId) {
      clearTimeout(inhibitClickTimeoutId);
      // Successfully cancelled
      inhibitClickTimeoutId = null;
    }
    inhibitClickTimeoutId = setTimeout(
      function () {
        shouldInhibitClick = null;
      },
      1); // Wait just long enough that the click from this select happens.
    shouldInhibitClick = true;
  }

  // Firefox "feature": If there's no newline in the selected region, we're also
  // going to get a click event, which will then screw up the highlighting.  We
  // therefore set the shouldInhibitClick flag to skip the next click under
  // those circumstances.  Oh joy.  Oh, and it also happens if selecting a
  // region starting with a blank line and going on into the next line [FF seems
  // not to notice those newlines sometimes].
  // Other special cases: starting and ending on a newline, starting or ending
  // at a newline and releasing the mouse outside the textarea.  That latter one
  // I'm inclined just to let go, since it's somewhat consistent with other
  // javascript stuff [that mouse events outside the window don't count], and at
  // least we clean up nicely.  One I don't even know how to approach: starting
  // on a newline and ending on a forced line break.  I can't even detect the
  // breaks.  However, if I just set shouldInhibitClick indiscriminately, I can
  // miss clicks after which I need to call fixupEndOfLineMotion.  Solution:
  // Always set shouldInhibitClick, but set a timer that clears it after 1ms.
  // We'll still get the click event [barring extremely odd races, I suppose],
  // but we'll clean up fast enough that nobody will ever know.
  // Problem: In Chrome we get down, up, click, select, instead of down, up,
  // select, click.  So our onclick handler clears the selection, and the
  // onselect never happens at all.  We have to detect the selection from the
  // mouseup, rather than the select, and inhibit the click from there.
  function handleSelect(event) {
    if (!this.shouldHandleClick(event)) {
      return;
    }
    selectDownX = mouseDownX;
    selectDownY = mouseDownY;
    mouseDownX = null;
    mouseDownY = null;
    this.setTextArea(event.target);  // Maybe move to handleFocus?
    divhackUpdateSelectionFromRange(event.type);
    this.clearVar(VarNames.COL);
    var mode = this.getMode();
    if (mode != ModeNames.INSERT && mode != ModeNames.OVERWRITE) {
      if (this.getVar(VarNames.VISUAL)) {
        this.clearVisualVars();
      }
      var start = this.getSelectionStart();
      var end = this.getSelectionEnd();
      this.setVar(VarNames.VISUAL, Keys.v);
      if (dragWasUpward) {
        this.setVar(VarNames.VISUAL_START_POS, end);
        this.setVar(VarNames.VISUAL_END_POS, start);
        this.setCursorPos(start);
      } else {
        this.setVar(VarNames.VISUAL_START_POS, start);
        this.setVar(VarNames.VISUAL_END_POS, end);
        this.setCursorPos(end - 1);
      }
      inhibitClick();
    }
    this.updateStatusBar();
    //this.flicker(event.target); // No longer needed?
  }

  var mouseDownX, mouseDownY;
  var dragWasUpward;

  // TODO: layerX+layerY are going away in webkit.  Find a replacement.
  function handleMouseDown(event) {
    if (jsvim.divhackJustEatEsc || !jsvim.e || jsvim.e.jv_just_eat_esc) {
      return true;
    }
    mouseDownX = event.layerX;
    mouseDownY = event.layerY;
  }

  // This won't be perfect--you can go down a line without moving a whole line's
  // height--but it will work for most drags.  todo: Experiment with checking
  // the start+end Y coords against a line-quantization of the window.
  function handleMouseUp(event) {
    if (jsvim.divhackJustEatEsc || !jsvim.e || jsvim.e.jv_just_eat_esc) {
      return true;
    }
    var mouseUpX = event.layerX;
    var mouseUpY = event.layerY;
    var lineHeight;
    this.setTextArea(event.target);
    divhackUpdateSelectionFromRange(event.type);
    try {
      var style = window.getComputedStyle(this.e, null);
      lineHeight = getLineHeight(style);
      this.setVar(VarNames.LINE_HEIGHT, lineHeight);
    } catch (ex) {
      // This happens some time with no obvious pattern.
      // If we haven't already succeeded once, try 15 as a fallback.
      lineHeight = this.getVar(VarNames.LINE_HEIGHT, 15);
    }
    if (Math.abs(mouseUpY - mouseDownY) > lineHeight) {
      // We've moved at least a line vertically.
      dragWasUpward = mouseUpY < mouseDownY;
    } else {
      dragWasUpward = mouseUpX < mouseDownX;
    }
    if (this.getSelectionEnd() != this.getSelectionStart()) {
      inhibitClick();
    }
  }

  function handleFocus(event) {
    this.setTextArea(event.target);
    // TODO: Does this really need to be done so often?
    // It's Firefox-only, currently.
    if (this.updateEditorPrefs) {
      this.updateEditorPrefs(); // Only done for the extension.
    }
    var statusBar = this.getVar(VarNames.STATUS_BAR);
    if (statusBar) {
      statusBar.style.visibility = 'visible';
    }
  }

  function handleBlur(event) {
    this.setTextArea(event.target);
    var statusBar = this.getVar(VarNames.STATUS_BAR);
    if (statusBar) {
      statusBar.style.visibility = 'hidden';
    }
  }

  // Extension only; change to member function living in overlay.js?
  function handleFocusForExtension(event) {
    e = event.originalTarget;
    this.disallowed = this.isDisallowed(e);
    if (e && e.tagName && e.tagName.toLowerCase() == "textarea" &&
        !e[VarNames.JV_REMOVAL_FUNCTION] &&
        (!this.disallowed || this.disallowedJustEatEsc)) {
      setUpElement(this, e, this.disallowed);
    }
  }

  function isDisallowed(e) {
    if (!this.inExtension) {
      return false;
    }
    var scheme, host;
    if (isChrome()) {
      var spec = location.href
      var schemeLength = spec.indexOf('://')
      scheme = spec.substring(0, schemeLength);
      var schemeLess = spec.substring(schemeLength + 3)
      var hostTerminator = schemeLess.indexOf('/');
      if (hostTerminator > -1) {
        // This will include any port number.
        host = schemeLess.substring(0, hostTerminator);
      } else {
        host = schemeLess;
      }
    } else {
      var uri = getBrowser().currentURI;
      scheme = uri.scheme;
      var hostAndPath = uri.spec.substring(uri.scheme.length + "://".length);
      host = hostAndPath.substring(0,
        hostAndPath.length - uri.path.length);
    }
    if (scheme == 'http' || scheme == 'https') {
      if (host == 'mail.google.com') {
        // GMail body only.
        // Yes, this is fragile.
        if (divhackCheckElement(e)) {
          return false;
        }
        var spellCheck = e.getAttribute('spellcheck');
        if (!spellCheck || spellCheck.toLowerCase() == "false") {
          return true;
        }
        var name = e.getAttribute('name');
        if (name == "to" || name == "cc" || name == "bcc") {
          return true;
        }
        return false;
      } else if ((startsWith(host, 'docs') || startsWith(host, 'spreadsheets'))
                 && endsWith(host, '.google.com')) {
        // You really don't want this on in Google Spreadsheets, and there's
        // little point in Google Docs, so I'm nuking both rather
        // indiscriminately.
        return true;
      } else {
        var patterns = this.disallowedHostPatterns.split(/\s+/);
        for (var i = 0; i < patterns.length; i++) {
          var pat = patterns[i].replace(/\./g, '\\.').replace(/\*/g, '.*');
          if (new RegExp(pat).test(host))
            return true;
        }
      }
    }
    return false;
  }

  function shouldHandleClick(event) {
    var e = event.target;
    if (!e || !e.tagName || event.altKey || event.metaKey ||
        (e.tagName.toLowerCase() != "textarea" &&
         e.tagName.toLowerCase() != "div")) {
      return false;
    }
    if (jsvim.divhackJustEatEsc || e.jv_just_eat_esc) {
      return false;
    }
    return !this.isDisallowed(e);
  }

  // This is large and a bit inefficient.  todo: Change the setup such that
  // onLoad we customize a whitelist/blacklist for this domain [including
  // domains inside iframes, as needed] to streamline this process.  If there's
  // nothing to handle, we can just turn ourselves off until the next load or
  // DOMNodeInsertedIntoDocument event.
  function shouldHandleKeypress(event) {
    var e = event.target || event.currentTarget; // originalTarget?
    if (!e || !e.tagName ||
        ((e.tagName.toLowerCase().indexOf("textarea") == -1) &&
         (e.tagName.toLowerCase().indexOf("div") == -1))) {
      return false;
    }
    if (jsvim.divhackJustEatEsc || e.jv_just_eat_esc) {
      return false;
    }
    if (event.originalTarget && (e != event.originalTarget)) {
      // These hit in GMail navigation sometimes.  In one case, I'd
      // clicked-to-highlight in a textarea that wasn't one of mine.
      _debug("target mismatch");
      _debug(event.originalTarget);
      _debug(e);
      return false;
    }
    if (event.altKey || event.metaKey) {
      this.e = null;
      return false;
    }
    if (this.isDisallowed(e)) {
      return false;
    }
    if (!this.lenabled || (this.isEnabled && !this.isEnabled())) {
      if (e[VarNames.JV_REMOVAL_FUNCTION]) {
        e[VarNames.JV_REMOVAL_FUNCTION]();
      }
      return false;
    }
    return true;
  }

  function setTextArea(element) {
    if (!jsvim) {
      popup("no jsvim!");
    }
    if (!this) {
      popup("no this!");
    }
    if (this != jsvim) {
      jsvim = this;
    }
    jsvim.e = element;
  }

  function divhackSetUp(e) {

    if (!e || e.jv_divhack || !divhackCheckElement(e)) {
      return;
    }

    e.jv_divhack = true;

    e.jv_just_eat_esc = jsvim.divhackJustEatEsc;

    e.value = ""; 
    e.selectionStart = 0;
    e.selectionEnd = 0;

    e.jv_divhack_numchildren = 0;
    e.jv_divhack_lastlinelen = 0;

    e.jv_divhack_ignore_modifications = false;

    //this will mark sentinel if things look ok
    if (!jsvim.divhackJustEatEsc) {
      divhackUpdateValueFromDiv();
    } else {
      divhackDBG("jv divhack just eating esc on " + e);
    }

    //TODO(vona) this doesn't get the initial text sometimes in a GMail reply
    //with existing draft because it seems to take ~1s for GMail to actually
    //populate that text after the div is up.  It might be ok though because
    //divhackUpdateDivFromValue() and divhackUpdateValueFromDiv() are pretty
    //defensive.
  }
  
  function divhackDBG(msg) {
    if (jsvim.divhackDebug && (!jsvim.e || jsvim.e.jv_divhack)) {
      console.log(msg);
    }
  }

  function getElementText() {

    //This adds a layer of indirection to most of the code that would normally
    //just read from e.value.  It could get called frequently, so try to keep it
    //fast in the common case.  divhackUpdateDivFromValue() will early out in
    //constant time if it seems safe to do so.

    //It is debatable if we even need to do both this kind of passive "polling"
    //as well as actively updating the value from the div in response to the
    //various modification events, which we are also doing currently.  It seems
    //like it should be safer to do both if the performance is ok, so leaving
    //both codepaths in for now.

    if (this.e.jv_divhack) {
      divhackUpdateValueFromDiv();
    }
    return this.e.value;
  }

  function divhackUpdateValueFromDiv(force) {
    
    //divhackDBG("divhackUpdateValueFromDiv("+force+")");

    //three main things that change the contents of the div behind our back:
    //(1) cut
    //(2) paste
    //(3) the GMail "Show trimmed content" thingy

    //for some readon we don't get DOMCharacterDataModified messages after (1),
    //but we do get cut messages
   
    //we get DOMCharacterDataModified messages after (2) 
    
    //we get DOMNodeInsertedIntoDocument messages after (3)

    //However, the current implementation is both proactive and defensive - we
    //get called to update the value from the div both after those events *and*
    //whenever other parts of the code call getElementText(). So try to early
    //out because I think getElementText() could be called pretty frequently.

    if (!jsvim || !jsvim.e || !jsvim.e.jv_divhack) {
      return false;
    }
    var e = jsvim.e;

    //if this needs to be further optimized two possibilities might be (a) check
    //nodeType == 1 before doing the string check on nodeName and (b) cache a
    //javascript reference to what we think the sentinel node should be as
    //e.jv_divhack_sentinel, then just check if its parent is e and that it has
    //class="jv_divhack_sentinel" here
    var children = e.childNodes, c;
    for (c = children.length-1; c >= 0; c--) { //search backwards
      if ((children[c].nodeName.toLowerCase() == "br") &&
          (children[c].getAttribute("class") == "jv_divhack_sentinel")) {
        break;
      }
    }

    if ((c >= 0) && !force)  { //early out
      //divhackDBG("early out, found sentinel and not force");
      return false; 
    }

    //note: when GMail munges the div after (3) it removes our sentinel mark

    divhackDBG("updating value from div, force or sentinel not found"+
               " nc="+e.jv_divhack_numchildren+
               " nl="+(e.jv_divhack_numchildren/2));
    
    //put content in expected text-br pairs up to first foreign child
    //and make sure sentinel is at the end
    divhackSanitize();
   
    //divhackDBG("after sanitize"+
    //            " nc="+e.jv_divhack_numchildren+
    //            " nl="+(e.jv_divhack_numchildren/2));

    //divhackDBG("updated lines from div: ");
    var lines = [];
    for (var c = 0, l = 0; c < e.jv_divhack_numchildren; l++, c+=2) {
      if (children[c].nodeType == 3) {
        var line = children[c].nodeValue;
        if (line == " ") {
          line = "";
        } else { //TODO(vona) needed? else line = divhackDecodeEntities(line);
          line = line.replace(/\u00a0|&nbsp;|\u0009|&#09;/g, " ");
        }
        lines.push(line);
        //divhackDBG("line "+l+": \""+lines[l]+"\"");
      } else {
        divhackDBG("child "+c+" should be text!");
      }
    }

    e.value = lines.join(Consts.EOLN) + Consts.EOLN;

    return true;
  }

  function divhackUpdateDivFromValue() {

    //divhackDBG("divhackUpdateDivFromValue()");

    //The document structure for each text line always consists of text node
    //followed by <br>.  We assume that we "own" the first
    //jv_divhack_numchildren of the div, with the last being our sentinel <br
    //class="jv_divhack_sentinel">.  We don't care if there are children after
    //that, and we don't touch them.  If we have to insert or remove lines we do
    //those modifications in "our part" of the child list.

    divhackSanitize();

    if (!jsvim.e || !jsvim.e.jv_divhack) {
      return;
    }
    var e = jsvim.e;

    e.jv_divhack_ignore_modifications = true;

    var children = e.childNodes;
    var last_nc = e.jv_divhack_numchildren;

    //convert substrings of n=2 or more spaces into one space followed by n-1
    //nbsp.  Note \u00a0 is the nonbreaking space character corresponding to the
    //&nbsp; entity reference.
    function cvtSpaces(match) { return " "+Array(match.length).join("\u00a0"); }
    var lines = e.value.replace(/ {2,}/g, cvtSpaces).split(Consts.EOLN);
    var nl = lines.length;

    //split() will make an empty last when value ends in newline
    if ((nl > 0) && (lines[nl-1] == "")) {
      lines.pop(); nl--;
    }

    //ensure at least one line
    if (nl == 0) {
      lines = [" "]; nl = 1;
    }
    
    //Setting nodeValue = "" seems to create issues.  I thought it was creating
    //orphan children, but it looks like that may be just a bug with the Chrome
    //DOM inspector (closing the inspector and reopening it magically gets rid
    //of them).  But there are other issues.
    for (var l = 0; l < nl; l++) {
      if (lines[l].length == 0) {
        lines[l] = " ";
      }
    }

    //update existing lines
    var l = 0, c = 0;
    for (; l < nl && c < (children.length-1) && c < (last_nc-1); l++, c+=2) {
      if ((children[c].nodeType == 3) &&
          (children[c+1].nodeName.toLowerCase() == "br")) {
        children[c].nodeValue = lines[l];
      } else {
        break; //unexpected child
      }
      //divhackDBG("replaced line "+l);
    }
     
    //append new lines
    for (; l < nl; l++, c+=2) {
      var line = document.createTextNode(lines[l]);
      if (c < children.length) {
        if (children[c].nodeName.toLowerCase() != "br") { //steal existing child
          e.insertBefore(document.createElement("br"), children[c]);
        }
        e.insertBefore(line, children[c]);
        //divhackDBG("inserted line "+l);
      } else {
        e.appendChild(line);
        e.appendChild(document.createElement("br"));
        //divhackDBG("appended line "+l);
      }
    }

    //remove any remaining children that we had previously created
    var nc = c;
    for (; nc < children.length && c < last_nc; c++) {
      e.removeChild(children[nc]);
      //divhackDBG("removed child");
    }

    for (c = 1; c < (nc-1); c+=2) {
      if ((children[c].nodeName.toLowerCase() == "br") &&
          (children[c].getAttribute("class") == "jv_divhack_sentinel")) {
        children[c].removeAttribute("class");
      }
    }
    
    if (children[c].nodeName.toLowerCase() == "br") {
      if (children[c].getAttribute("class") != "jv_divhack_sentinel") {
        children[c].setAttribute("class", "jv_divhack_sentinel");
        //divhackDBG("marked sentinel as child "+(c-1));
      } //else divhackDBG("sentinel mark already at child "+c);
    } else {
      divhackDBG("expected <br> as child "+c+"!");
    }

    e.jv_divhack_numchildren = nc;
    if (nl > 0) {
      e.jv_divhack_lastlinelen = lines[nl-1].length;
    } else {
      e.jv_divhack_lastlinelen = 0;
    }

    e.jv_divhack_ignore_modifications = false;
  }

  function divhackSanitize() {

    //divhackDBG("divhackSanitize()");
    
    if (!jsvim.e || !jsvim.e.jv_divhack) {
      return;
    }
    var e = jsvim.e;
   
    e.jv_divhack_ignore_modifications = true;

    var children = e.childNodes;
    var last_nc = e.jv_divhack_numchildren;

    //divhackDBG("nc="+children.length+", last_nc="+last_nc);

    if (children.length == 0) {
      e.appendChild(document.createTextNode(" "));
      e.appendChild(document.createElement("br"));
      divhackDBG("initialized empty div");
    }

    var c = 0, len = 0, lastlinelen = 0;
    for (; c < children.length; c++) {

      var istext = (children[c].nodeType == 3);
      var isbr = (children[c].nodeName.toLowerCase() == "br");

      if (!istext && !isbr) { //unexpected node

        //divhackDBG("child "+c+" unexpected,"+
        //           " nodeType="+children[c].nodeType+
        //           " nodeName="+children[c].nodeName);

        var x = children[c], xc = x.childNodes, nxc = xc.length;

        //deal with empty spans that GMail sometimes inserts
        //TODO(vona) I hope it doesn't need them...
        if ((x.nodeName.toLowerCase() == "span") &&
            ((xc.length == 0) ||
             (xc[0].nodeValue == "") || (xc[0].nodeValue == " "))) {
          e.removeChild(x);
          c--;
          divhackDBG("pruned empty span");
          continue;
        }

        //sometimes when content is pasted from the clipboard, even "paste as
        //plain text", paragraphs are wrapped in <divs>
        if (x.nodeName.toLowerCase() == "div") {
          var d;
          for (d = 0; d < nxc; d++) {
            if ((xc[d].nodeType != 3) &&
                (xc[d].nodeName.toLowerCase() != "br")) {
              break;
            }
          }
          if (d == nxc) { //all children of the div are text or <br>
            for (d = nxc-1; d >= 0; d--) {
              e.insertBefore(xc[d], x); //reparent
            }
            e.removeChild(x);
            c--;
            divhackDBG("flattened div");
            continue;
          } else {
            break; //not all children of the div are text or <br>
          }
        } else {
          break; //unexpected node!
        }
      }

      if (c%2 == 0) { //even child

        if (!istext) { //so it must be br

          divhackDBG("child "+c+" should be text!");

          e.insertBefore(document.createTextNode(" "), children[c]);
          divhackDBG("inserted missing text node before bare <br>");

        } else { //expected text, got text

          lastlinelen = children[c].nodeValue.length;
          len += lastlinelen+1; //plus newline
          //TODO(vona) might be off by one if there is no eol on the last line

          //check that the next node is a newline
          if ((c >= (children.length-1)) || 
              (children[c+1].nodeName.toLowerCase() != "br")) {
            
            divhackDBG("child "+(c+1)+" should be <br>!");
            
            var br = document.createElement("br");
            if (children[c].nextSibling) {
              e.insertBefore(br,children[c].nextSibling);
            } else {
              e.appendChild(br);
            }
            divhackDBG("inserted missing <br> after bare text node");
          }
        }

      } else { //odd child

        if (!isbr) { //should not get here...
          divhackDBG("child "+c+" should be <br>!");
          break;

        } else  { //expected br, got br

          //we'll make sure the sentinel is set on the last <br> below
          if (children[c].getAttribute("class") == "jv_divhack_sentinel") {
            children[c].removeAttribute("class");
          }
        }
      }
    }

    var sentinel_index = -1;

    if ((c > 0) &&
        ((c == children.length) || jsvim.divhackAllowEditingAboveHTML) &&
        (children[c-1].nodeName.toLowerCase() == "br")) {
      sentinel_index = c-1;
    }
    
    if (sentinel_index >= 0) {
      
      //if (sentinel_index != (children.length-1))
      //  divhackDBG("edting a above foreign HTML starting at child "+
      //             (sentinel_index+1));

      children[sentinel_index].setAttribute("class", "jv_divhack_sentinel");
      //divhackDBG("marked sentinel as last child "+sentinel_index);

      e.jv_divhack_numchildren = sentinel_index+1;
      e.jv_divhack_lastlinelen = lastlinelen;
      if (e.selectionStart > len) {
        e.selectionStart = len;
      }
      if (e.selectionEnd > len) {
        e.selectionEnd = len;
      }
      
      //divhackDBG("sanitize ok, "+sentinel_index+" divhack children");

    } else { //hit something that wasn't a text or br
      
      divhackDBG("sanitize error, child "+c+" unexpected!");

      if (!e.jv_just_eat_esc) {
        popup("unxpected HTML in contenteditable div, jv going esc-eat-only!");
      }

      e.jv_just_eat_esc = true;
    }

    e.jv_divhack_ignore_modifications = false;
  }

  var divhackModifyTimerID = null;

  function divhackHandleModify(event) {

    //divhackDBG("divhackHandleModify("+event.type+")");
    
    var e = event.target || event.currentTarget; // originalTarget?
    
    //can get DOM events we care about for children of our div
    if (e && e.parentNode.jv_divhack) {
      e = e.parentNode;
    }
    
    if (!e || !e.jv_divhack || e.jv_just_eat_esc) {
      return true;
    }
    
    //we set this when we are doing the modificaitions ourselves
    if (e.jv_divhack_ignore_modifications) {
      return true;
    }
    
    if (divhackModifyTimerID != null) {
      //divhackDBG("would update value from div for event "+event.type+
      //           " but handler already scheduled");
      return true; 
    }
    
    divhackDBG("force update value from div for event "+event.type+
               " (scheduling coalescing handler)");
    divhackModifyTimerID = setTimeout(
      function() {
        divhackModifyTimerID = null;
        divhackUpdateValueFromDiv(true); //don't early out
      },
      500);
    
    return true;
  }

  function divhackCheckElement(e) {
    //divhackDBG("divhackCheckElement("+e+")");
//    console.log("divhackCheckElement("+e+
//                (e.getAttribute ?
//                 (" id="+e.getAttribute("id")+
//                  " contenteditable="+e.getAttribute("contenteditable")) : "")+
//                ")");
    if (jsvim.divhackDisabled) {
//      console.log("divhackCheckElement returning false (divhackDisabled)");
      return false;
    }
    if (!e || !e.tagName || (e.tagName.toLowerCase() != "div")) {
//      console.log("divhackCheckElement returning false (tagName != div)");
      return false;
    }
    if (!e.getAttribute) {
//      console.log("divhackCheckElement returning false (no getAttribute)");
      return false;
    }
    if (e.getAttribute("contenteditable")) {
//      console.log("divhackCheckElement returning true (contenteditable)");
      return true;
    }
    //for some reason when we get here in GMail contenteditable is not yet true
    if (e.getAttribute("aria-label") == "Message Body") {
      return true; //GMail
    }
    return false;
  }
            
  function divhackDump(msg) {

    if (!jsvim.e || !jsvim.e.jv_divhack) {
      return;
    }
    var e = jsvim.e;
    
    var children = e.childNodes;
    var last_nc = e.jv_divhack_numchildren;
    var lines = e.value.split(Consts.EOLN);

    console.log("divhack dump "+((msg) ? msg : ""));

    console.log("divhackJustEatEsc="+jsvim.divhackJustEatEsc+
                " divhackAllowEditingAboveHTML="+
                jsvim.divhackAllowEditingAboveHTML);

    console.log("nc="+children.length+" last_nc="+last_nc+" nl="+lines.length);

    for (var c = 0, l = 0; c < children.length && c < last_nc; c++) {
      if (!(c%2)) { //even child 
        if (children[c].nodeType == 3) {
          var l = c/2;
          console.log("line "+l+" (child "+c+"): \""+
                      children[c].nodeValue+"\"");
          if (l < lines.length) {
            var line = lines[l];
            if (line.length == 0) {
              line = " ";
            }
            console.log("line "+l+" should be: \""+line+"\"");
          }
        } else {
          console.log("child "+c+" should be text!");
        }
      } else if (children[c].nodeName.toLowerCase() != "br") { //odd child
        console.log("child "+c+" should be <br>!");
      }
    }

    if ((children.length == 0) || (c < 1) ||
        (children[c-1].nodeType != 1) ||
        (children[c-1].nodeName.toLowerCase() != "br") ||
        (children[c-1].getAttribute("class") != "jv_divhack_sentinel")) {
      console.log("sentinel expected as child "+(c-1)+" not found!");
    }
  }

  function divhackUpdateRangeFromSelection() {

    //divhackDBG("divhackUpdateRangeFromSelection()");

    var e = this.e; 
    if (!e || !e.jv_divhack) {
      return;
    }

    var text = e.value, len = text.length;
    var start = e.selectionStart, end = e.selectionEnd;

    //divhackDBG("start="+start+" end="+end+" len="+len);

    var sc = 0, so = 0, ec = 0, eo = 0;
    if ((start == len) && (end == len) && (len > 0)) { //common case
      sc = ec = e.jv_divhack_numchildren-2;
      so = eo = e.jv_divhack_lastlinelen;
    } else if ((start > 0) && (end > 0)) {
      var child = 0, offset = 0;
      for (var i = 0; i < len; i++) {
        if (start == i) {
          sc = child; so = offset;
        }
        if (end == i) {
          ec = child; eo = offset;
        }
        if (text[i] == Consts.EOLN) {
          child += 2; offset = 0;
        } else {
          offset++;
        }
      }
    }
    //divhackDBG("sc="+sc+" so="+so+" ec="+ec+" eo="+eo);
    
    try {
      var children = e.childNodes, nc = children.length;
      if ((sc < nc) && (children[sc].nodeType == 3) &&
          (ec < nc) && (children[ec].nodeType == 3)) {
        //modifying existing range or directly setting sel fields fails
        var range = document.createRange();
        range.setStart(children[sc], so);
        if ((sc == ec) && (so == eo)) {
          range.collapse(true);
        } else {
          range.setEnd(children[ec], eo);
        }
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } catch (ex) {
      var code = 'unknown';
      if (ex.code) {
        code = ex.code;
      }
      divhackDBG("error (code="+code+") updating div selection! "+
                 "sc="+sc+" so="+so+" ec="+ec+" eo="+eo);
    }
  }

  function divhackUpdateSelectionFromRange(why) {

    divhackDBG("divhackUpdateSelectionFromRange("+why+")");
    
    var e = jsvim.e; 
    if (!e || !e.jv_divhack) {
      return;
    }

    var nc = e.jv_divhack_numchildren;
    if (nc < 2) {
      return;
    }

    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) {
      return;
    }

    if (sel.rangeCount > 1) {
      divhackDBG("using first of "+sel.rangeCount+" ranges");
    }

    var range = sel.getRangeAt(0);
    var scc = range.startContainer, ecc = range.endContainer;
    var so = range.startOffset, eo = range.endOffset;

    if (!scc || (scc.parentNode != e) || (scc.nodeType != 3)) {
      divhackDBG("unexpected range start container"+scc);
      return;
    }

    if (!ecc || (ecc.parentNode != e) || (ecc.nodeType != 3)) {
      divhackDBG("unexpected range end container"+scc);
      return;
    }

    var children = e.childNodes;
    var sc = -1, ec = -1;
    for (var c = 0; c < nc; c++) {
      if (children[c] == scc) {
        sc = c; 
      }
      if (children[c] == ecc) {
        ec = c;
      }
      if ((sc >= 0) && (ec >= 0)) {
        break;
      }
    }

    //if start or end container not found it may be in html below text content
    if (sc < 0) {
      sc = nc-2; so = e.jv_divhack_lastlinelen;
    }
    if (ec < 0) {
      ec = nc-2; eo = e.jv_divhack_lastlinelen;
    }

    //divhackDBG("sc="+sc+" so="+so+" ec="+ec+" eo="+eo);

    if ((sc%2 != 0) || (ec%2 != 0)) {
      divhackDBG("unexpected range start/end container");
      return;
    }

    var sl = sc/2, el = ec/2;

    //TODO(vona) this can probably be done without split, just scan for EOLs
    var lines = e.value.split(Consts.EOLN), len=e.value.length;
    var start = -1, end = -1, sum = 0;
    for (var l = 0; l < lines.length; l++) {
      if (l == sl) {
        start = sum + so;
      }
      if (l == el) {
        end = sum + eo;
      }
      if ((start >= 0) && (end >= 0)) {
        break;
      }
      sum += lines[l].length+1; //plus eol
    }

    //divhackDBG("sl="+sl+" so="+so+" start="+start+
    //            "el="+el+" eo="+eo+" end="+end+
    //            "text length="+len);

    if ((start < 0) || (start > len) || (end < 0) || (end > len)) {
      divhackDBG("invalid start or end");
      return;
    }

    e.selectionStart = start;
    e.selectionEnd = end;
  }

  // Used only by the extension path.
  function jvHandleEvent(event) {
    try {
      if (event.type == 'keypress') {
        throw Error("This shouldn't ever happen any more.");
      } else if (event.type == 'click') {
        this.handleClick(event);
      } else if (event.type == 'focus') {
        this.handleFocusForExtension(event);
      } else {
        popup("Unhandled event type " + event.type);
      }
    } catch (ex) {
      popup("Extension path error:\n" + stringifyObj(ex));
    }
  }

  // There's one undo stack per textarea, although currently they all share
  // regs.  todo: Should I change that?  Mismatching undo state with where
  // the changes were made wouldn't make any sense, but we could go either way
  // on the regs.  Alternately, we could have one big stack, but store pointers
  // from entries to textareas so that we could undo across the whole page.
  function getUndoStack() {
    if (!this.e.jsvimUndoStack) {
      this.e.jsvimUndoStack = new Array();
    }
    return this.e.jsvimUndoStack;
  }

  function getRedoStack() {
    if (!this.e.jsvimRedoStack) {
      this.e.jsvimRedoStack = new Array();
    }
    return this.e.jsvimRedoStack;
  }

  function dumpUndoStack() {
    _debug("Undo: " + this.getUndoStack());
  }

  function dumpRedoStack() {
    _debug("Redo: " + this.getRedoStack());
  }

  // Start and end describe the interval in the current state that should be
  // overwritten with the text to go back to the previous state.
  function addUndoInfo(start, end, text, recursing) {
    var curStart = this.getVar(VarNames.UNDO_START);
    var curEnd = this.getVar(VarNames.UNDO_END);
    var curText = this.getVar(VarNames.UNDO_TEXT);
    if (curStart == null) {
      if (curEnd || curText) {
        popup("Partly-invalid undo record!");
      }
      curStart = start;
      curEnd = end;
      curText = text;
    } else {
      if (end <= start) {
        popup("Subsequent records should have length!");
        return;
      }
      if (start != curEnd) {
        if (start + 1 == curEnd) {
          // Chasing a newline inserted by Keys.O.
          ++end;
        } else {
          // Incompatible undo records; most likely due to using the mouse in
          // insert mode, or another script altering the textarea's contents.
          if (recursing) { // The param exists solely for this assert.
            throw "Incompatible undo record after recursing!";
          }
          this.pushUndoState();
          this.addUndoInfo(start, end, text, true);
          return;
        }
      } else if (text) {
        // Overwrite mode.
        curText += text;
      } else {
      }
      curEnd = end;
    }

    this.setVar(VarNames.UNDO_START, curStart);
    this.setVar(VarNames.UNDO_END, curEnd);
    this.setVar(VarNames.UNDO_TEXT, curText);
  }

  function addUndoDelChars(pos, delChars) {
    var curDelChars = this.getVar(VarNames.UNDO_DEL_CHARS, Consts.EMPTY);
    curDelChars += delChars;
    this.setVar(VarNames.UNDO_DEL_CHARS, curDelChars);
    var curStart = this.getVar(VarNames.UNDO_START);
    var curEnd = this.getVar(VarNames.UNDO_END);
    if (curStart == null) {
      if (curEnd != null) {
        popup("Partly-invalid undo record at delete!");
      }
      this.setVar(VarNames.UNDO_START, pos);
      this.setVar(VarNames.UNDO_END, pos);
    }
  }

  // isOverwrite means we're in overwrite mode.
  // count is how many chars we just backspaced or CTRL_Ued over.
  // putBackLen is how many overwritten chars we just put back in
  //   handleBackspace [so we can pull them off the end of curText].
  function trimUndoRecord(isOverwrite, count, putBackLen) {
    var curStart = this.getVar(VarNames.UNDO_START);
    var curEnd = this.getVar(VarNames.UNDO_END);
    var curText = this.getVar(VarNames.UNDO_TEXT);
    if (curStart == null) {
      popup("Undo record null at trimUndoRecord!");
      return;
    } else if (curEnd <= curStart) {
      if (this.getSelectionEnd() == 0) {
        // We probably just ran out of text because another script, such as
        // GMail's chat mole stuff, cleared the textarea.  Don't make a fuss,
        // just pretend we succeeded.
        curEnd = curStart;
      } else {
        popup("Undo record empty at trimUndoRecord!");
        return;
      }
    } else {
      curEnd -= count;
    }
    if (isOverwrite && putBackLen) {
      // Trim off text that we've already put back.
      if (curText.length < putBackLen) {
        popup("Undo text empty at overwrite trimUndoRecord!");
        return;
      }
      curText = curText.slice(0, curText.length - putBackLen);
    }
    this.setVar(VarNames.UNDO_END, curEnd);
    this.setVar(VarNames.UNDO_TEXT, curText);
  }

  function trimUndoRecordForCtrlU(isOverwrite) {
    var curStart = this.getVar(VarNames.UNDO_START);
    var curEnd = this.getVar(VarNames.UNDO_END);
    var curText = this.getVar(VarNames.UNDO_TEXT);
    if (curStart == null) {
      popup("Undo record null at trimUndoRecord!");
      return;
    } else if (curEnd <= curStart) {
      popup("Undo record empty at trimUndoRecord!");
      return;
    }
    curEnd = curStart;
    if (isOverwrite && !overage) {
      // Trim off a char that we've already put back.
      if (!curText.length) {
        popup("Undo text empty at overwrite trimUndoRecord!");
        return;
      }
      curText = curText.slice(0, curText.length - 1);
    }
    this.setVar(VarNames.UNDO_END, curEnd);
    this.setVar(VarNames.UNDO_TEXT, curText);
  }

  function pushUndoUnit() {
    var record = this.getVar(VarNames.UNDO_RECORD);
    var start = this.getVar(VarNames.UNDO_START);
    var delChars = this.getVar(VarNames.UNDO_DEL_CHARS);
    var wasO = this.getVar(VarNames.UNDO_O);
    if (start != null || delChars != null) {
      this.e.jsvimUndoing = false;
      var end = this.getVar(VarNames.UNDO_END);
      var text = this.getVar(VarNames.UNDO_TEXT, Consts.EMPTY);
      if (!delChars) {
        delChars = Consts.EMPTY;
      }
      if (!record) {
        record = new UndoRecord();
      }
      record.push(new UndoUnit(start, end, text + delChars, wasO));
      this.setVar(VarNames.UNDO_RECORD, record);
      this.clearVar(VarNames.UNDO_START);
      this.clearVar(VarNames.UNDO_END);
      this.clearVar(VarNames.UNDO_TEXT);
      this.clearVar(VarNames.UNDO_DEL_CHARS);
      this.clearVar(VarNames.UNDO_O);
      this.getRedoStack().length = 0;
    }
    return record;
  }

  function pushUndoState() {
    var record = this.pushUndoUnit();
    if (record) {
      this.getUndoStack().push(record);
      this.clearVar(VarNames.UNDO_RECORD);
    }
  }

  var p = JsVim.prototype;

  p.KeyCodes = KeyCodes;

  p.abortCommand = abortCommand;
  p.addUndoDelChars = addUndoDelChars;
  p.addUndoInfo = addUndoInfo;
  p.applyBasicEdit = applyBasicEdit;
  p.applyChanges = applyChanges;
  p.applyMotion = applyMotion;
  p.applyNonMotion = applyNonMotion;
  p.applyPaste = applyPaste;
  p.applyRepeatedInsertion = applyRepeatedInsertion;
  p.beep = beep;
  p.beepOff = beepOff;
  p.beepOn = beepOn;
  p.clearCmdVars = clearCmdVars;
  p.clearVar = clearVar;
  p.clearVisualVars = clearVisualVars;
  p.computeMotionForDoubleLetter = computeMotionForDoubleLetter;
  p.computeMotionForExec = computeMotionForExec;
  p.computeMotionFromVisualMode = computeMotionFromVisualMode;
  p.computeMotionWithCommand = computeMotionWithCommand;
  p.computeNonMotionForExec = computeNonMotionForExec;
  p.computePosition = computePosition;
  p.convertControlKey = convertControlKey;
  p.convertVisualToDoubledCommand = convertVisualToDoubledCommand;
  p.decodeCommand = decodeCommand;
  p.deleteChars = deleteChars;
  p.doFlicker = doFlicker;
  p.doJoin = doJoin;
  p.doPercent = doPercent;
  p.doSearch = doSearch;
  p.doSeek = doSeek;
  p.doTilde = doTilde;
  p.endCommand = endCommand;
  p.endNonTextCommand = endNonTextCommand;
  p.enqueueOrHandle = enqueueOrHandle;
  p.executeArgs = executeArgs;
  p.execute = execute;
  p.findCol = findCol;
  p.findEndOfLine = findEndOfLine;
  p.findNextPercentMatch = findNextPercentMatch;
  p.findNextWordEnd = findNextWordEnd;
  p.findNextWordStart = findNextWordStart;
  p.findNextWordStartOrNewline = findNextWordStartOrNewline;
  p.findNonSpaceCharOrEnd = findNonSpaceCharOrEnd;
  p.findPosForCol = findPosForCol;
  p.findPrevWhitespaceStart = findPrevWhitespaceStart;
  p.findPrevWordStart = findPrevWordStart;
  p.findStartOfLine = findStartOfLine;
  p.fixupEndOfLineMotion = fixupEndOfLineMotion;
  p.flicker = flicker;
  p.getCharAtPos = getCharAtPos;
  p.getCharCodeAtPos = getCharCodeAtPos;
  p.getCharCode = getCharCode;
  p.getCursorDX = getCursorDX;
  p.getCursorDY = getCursorDY;
  p.getCursorPos = getCursorPos;
  p.getFoldedKeyCode = getFoldedKeyCode;
  p.getMaxPos = getMaxPos;
  p.getMode = getMode;
  p.getQueue = getQueue;
  p.getRange = getRange;
  p.getRedoStack = getRedoStack;
  p.getReg = getReg;
  p.getSelectionEnd = getSelectionEnd;
  p.getSelectionStart = getSelectionStart;
  p.getSelectionText = getSelectionText;
  p.getText = getText;
  p.getUndoStack = getUndoStack;
  p.getVar = getVar;
  p.gotoLine = gotoLine;
  p.handleBackspace = handleBackspace;
  p.handleBlur = handleBlur;
  p.handleCharCode = handleCharCode;
  p.handleClick = handleClick;
  p.handleComboCommandChar = handleComboCommandChar;
  p.handleCommandModeInput = handleCommandModeInput;
  p.handleCtrlU = handleCtrlU;
  p.handledElsewise = handledElsewise;
  p.handleEsc = handleEsc;
  p.handleFocusForExtension = handleFocusForExtension;
  p.handleFocus = handleFocus;
  p.handleKeyCodeAsMotion = handleKeyCodeAsMotion;
  p.handleKeyCodeDel = handleKeyCodeDel;
  p.handleKeyCode = handleKeyCode;
  p.handleKeyCore = handleKeyCore;
  p.handleKeydown = handleKeydown;
  p.handleKeypress = handleKeypress;
  p.handleLeadingDigit = handleLeadingDigit;
  p.handleMouseDown = handleMouseDown;
  p.handleMouseUp = handleMouseUp;
  p.handleNumModeInput = handleNumModeInput;
  p.handleOneQueueItem = handleOneQueueItem;
  p.handleRegModeInput = handleRegModeInput;
  p.handleScroll = handleScroll;
  p.handleSearchAgain = handleSearchAgain;
  p.handleSearchChar = handleSearchChar;
  p.handleSearchModeInput = handleSearchModeInput;
  p.handleSeekChar = handleSeekChar;
  p.handleSeekModeInput = handleSeekModeInput;
  p.handleSelect = handleSelect;
  p.handleSemi = handleSemi;
  p.handleUndoRecord = handleUndoRecord;
  p.handleUnrecognizedChar = handleUnrecognizedChar;
  p.handleVisualChar = handleVisualChar;
  p.highlightVisualRange = highlightVisualRange;
  p.isDisallowed = isDisallowed;
  p.jvHandleEvent = jvHandleEvent;
  p.loopMotion = loopMotion;
  p.onFoundTextArea = nop;
  p.processQueue = processQueue;
  p.processVisualRegionIfNeeded = processVisualRegionIfNeeded;
  p.pushUndoState = pushUndoState;
  p.pushUndoUnit = pushUndoUnit;
  p.redo = redo;
  p.regIsLinewise = regIsLinewise;
  p.removeStatusBar = removeStatusBar;
  p.replaceRangeNoUndo = replaceRangeNoUndo;
  p.replaceRange = replaceRange;
  p.safeBackUp = safeBackUp;
  p.sendKeyEvent = sendKeyEvent;
  p.setCursorPos = setCursorPos;
  p.setMode = setMode;
  p.setReg = setReg;
  p.setSelection = setSelection;
  p.setStatusBarText = setStatusBarText;
  p.setTextArea = setTextArea;
  p.setUpDocument = setUpDocument;
  p.setUpElement = setUpElement;
  p.setUpElementIfNeeded = setUpElementIfNeeded;
  p.setUpElementIfNeededForEvent = setUpElementIfNeededForEvent;
  p.setUpStatusBar = setUpStatusBar;
  p.setVar = setVar;
  p.shouldHandleClick = shouldHandleClick;
  p.shouldHandleKeypress = shouldHandleKeypress;
  p.storeCmdVars = storeCmdVars;
  p.trimUndoRecord = trimUndoRecord;
  p.undo = undo;
  p.updateStatusBar = updateStatusBar;

  // divhack stuff for GMail
  p.divhackSetUp = divhackSetUp;
  p.divhackDBG = divhackDBG;
  p.divhackUpdateRangeFromSelection = divhackUpdateRangeFromSelection;
  p.divhackUpdateSelectionFromRange = divhackUpdateSelectionFromRange;
  p.divhackUpdateValueFromDiv = divhackUpdateValueFromDiv;
  p.divhackUpdateDivFromValue = divhackUpdateDivFromValue;
  p.divhackSanitize = divhackSanitize;
  p.divhackHandleModify = divhackHandleModify;
  p.divhackDump = divhackDump;
  p.divhackCheckElement = divhackCheckElement;
  p.getElementText = getElementText;
  //p.divhackDecodeEntities = divhackDecodeEntities;

  //If the disallowedJustEatEsc pref is on then we partially activate even when
  //disallowed just to catch ESC keyboard hits.  This flag lets the code in
  //chrome_specific.js figure out if we're in this state and adjust the jV icon
  //accordingly.
  p.disallowed = false;

  // Needed only for non-extension operation:
  p.setUp = setUp;

  // Needed for access in extension code:
  p.VarNames = VarNames;

  function setStatusBarText(text) {
    var statusBar = this.getVar(VarNames.STATUS_BAR);
    if (statusBar) {
      statusBar.textContent = text;
    }
  }

  function updateStatusBar(mode) {
    if (!this.getVar(VarNames.STATUS_BAR)) {
      return;
    }
    if (mode == null) {
      mode = this.getMode();
    }
    if (mode == ModeNames.SEARCH) {
      this.setStatusBarText(String.fromCharCode(this.getVar(VarNames.SEARCH)) +
        this.getVar(VarNames.SEARCH_STR, Consts.EMPTY));
    } else {
      var visual = this.getVar(VarNames.VISUAL);
      if (visual != null) {
        switch (visual) {
          case Keys.v:
            this.setStatusBarText("-- VISUAL --");
            break;
          case Keys.V:
            this.setStatusBarText("-- VISUAL LINE --");
            break;
          default:
            assert(false);
            break;
        }
      } else {
        switch (mode) {
        case ModeNames.INSERT:
          this.setStatusBarText("-- INSERT --");
          break;
        case ModeNames.OVERWRITE:
          this.setStatusBarText("-- REPLACE --");
          break;
        default:
          this.setStatusBarText(Consts.EMPTY);
        }
      }
    }
    if (false && isChrome()) { // TODO: We may want this in Firefox, too.
      // This is great on test.html, but fails in GMail.  In GMail. it's best if
      // we just don't set it at all.  In test.html, this is needed to get the
      // statusbar to track the second textarea as it jumps between flowed down
      // and flowed right as the window size changes.
      var statusBar = this.getVar(VarNames.STATUS_BAR);
      var sum = (this.e.offsetTop + this.e.offsetHeight +
          0.5 * statusBar.offsetHeight) + "px";
      statusBar.style.top = sum;
      statusBar.style.left = this.e.offsetLeft;
    }
  }

  function removeStatusBar() {
    if (this.e) {
      var statusBar = this.getVar(VarNames.STATUS_BAR);
      if (statusBar && statusBar.parentNode) {
        statusBar.parentNode.removeChild(statusBar);
        this.clearVar(VarNames.STATUS_BAR);
      }
    }
  }

  function setUpStatusBar() {
    var statusBar = this.getVar(VarNames.STATUS_BAR);
    if (statusBar && statusBar.parentNode) {
      return statusBar;
    }
    assert(this.e);
    statusBar = document.createElement("div");
    var elementStyle = window.getComputedStyle(this.e, "");
    var lineHeight = getLineHeight(elementStyle);
    var style = statusBar.style;

    style.borderTopStyle = elementStyle.borderTopStyle;
    style.borderLeftStyle = elementStyle.borderLeftStyle;
    style.borderRightStyle = elementStyle.borderLeftStyle;
    style.borderBottomStyle = elementStyle.borderTopStyle;
    style.borderTopColor = elementStyle.borderTopColor;
    style.borderLeftColor = elementStyle.borderLeftColor;
    style.borderRightColor = elementStyle.borderLeftColor;
    style.borderBottomColor = elementStyle.borderTopColor;
    style.borderTopWidth = elementStyle.borderTopWidth;
    style.borderLeftWidth = elementStyle.borderLeftWidth;
    style.borderRightWidth = elementStyle.borderLeftWidth;
    style.borderBottomWidth = elementStyle.borderTopWidth;
    style.font = elementStyle.font;
    style.fontFamily = "monospace"; //elementStyle.fontFamily;
    style.fontSize = elementStyle.fontSize;
    style.fontSizeAdjust = elementStyle.fontSizeAdjust;
    style.fontStretch = elementStyle.fontStretch;
    style.fontVariant = elementStyle.fontVariant;
    style.fontWeight = elementStyle.fontWeight;
    style.backgroundColor = elementStyle.backgroundColor;
    style.color = elementStyle.color;
    style.setProperty('position', 'absolute', 'important');
    style.display = 'block';
    style.visibility = 'hidden';

    style.width = (this.e.clientWidth -
        intFromPx(elementStyle.borderLeftWidth) -
        intFromPx(elementStyle.borderRightWidth) -
        intFromPx(elementStyle.marginLeft) -
        intFromPx(elementStyle.marginRight)) + "px";

    //style.width = elementStyle.width;
    style.height = lineHeight + "px";
    style.minHeight = lineHeight + "px";
    style.minWidth = lineHeight * 25 * 0.55 + "px"; // At least ~25 characters.

    style.zIndex = elementStyle.zIndex + 1;

    if (this.e.nextSibling) {
      this.e.parentNode.insertBefore(statusBar, this.e.nextSibling);
    } else {
      this.e.parentNode.appendChild(statusBar);
    }

    this.setVar(VarNames.STATUS_BAR, statusBar);
    this.updateStatusBar();

    return statusBar;
  }

  function setUpElement(jsvim, element, justEatESC) {

    jsvim.setTextArea(element);

    var onKeydown =
      function (event) {
        return jsvim.handleKeydown(event);
      }
    var onKeypress =
      function (event) {
        return jsvim.handleKeypress(event);
      }
    var onClick =
      function (event) {
        return jsvim.handleClick(event);
      }
    var onSelect =
      function (event) {
        return jsvim.handleSelect(event);
      }
    var onMouseDown =
      function (event) {
        return jsvim.handleMouseDown(event);
      }
    var onMouseUp =
      function (event) {
        return jsvim.handleMouseUp(event);
      }
    var onFocus =
      function (event) {
        return jsvim.handleFocus(event);
      }
    var onBlur =
      function (event) {
        return jsvim.handleBlur(event);
      }

    var onModified =
      function (event) {
        return jsvim.divhackHandleModify(event);
      }

    var onModifiedDelayed =
      function (event) {
        setTimeout(function() { jsvim.divhackHandleModify(event); },
                   500);
        return true;
      }

    divhackSetUp(element);

    if (justEatESC)
      element.jv_just_eat_esc = true;

    var statusBar;
   
    if ((!element.jv_divhack || !jsvim.divhackDisableStatusBar) &&
        (jsvim.showStatusBar == null || jsvim.showStatusBar) && !justEatESC) {
      statusBar = jsvim.setUpStatusBar();
    }

    if (!justEatESC && element.style &&
        ((!element.jv_divhack && jsvim.changeTextareaAppearance) || 
         (element.jv_divhack && jsvim.changeDivhackAppearance))) {
      element.jv_orig_backgroundColor = element.style.backgroundColor;
      if (!element.jv_orig_backgroundColor) {
        element.jv_orig_backgroundColor = Consts.WHITE;
      }
      element.style.backgroundColor = Consts.BGCOLOR;
    }

    var gmailIsAnEscThief =
      function (event) {
        if ((event.keyCode == Keys.ESC) &&
            (justEatESC || (event.target == element))) {

          //always eat it
          if (event.preventDefault) {
            event.preventDefault();
          }
          if (event.stopPropagation) {
            event.stopPropagation();
          }

          if (event.target == element) {
            jsvim.setTextArea(element);
            jsvim.handleEsc(); //and we might not do anything but eat it there
          }
          
          return false;
        } else {
          return true;
        }
      }

    if (element.jv_divhack || justEatESC) {
      document.addEventListener("keydown", gmailIsAnEscThief, true); //capture
      var iframes = document.getElementsByTagName("iframe");
      for (var i = iframes.length - 1; i >= 0; --i)
        try {
          iframes[i].contentDocument.
            addEventListener("keydown", gmailIsAnEscThief, true); //capture
        } catch (ex) { }
    }

    if (element.jv_divhack) {
      element.addEventListener("DOMCharacterDataModified", onModified, true);
      element.addEventListener("cut", onModifiedDelayed, true);
      element.addEventListener("DOMNodeInsertedIntoDocument", onModified, true);
    }

    element.addEventListener("keydown", onKeydown, false);
    element.addEventListener("keypress", onKeypress, false);
    element.addEventListener("click", onClick, true);
    element.addEventListener("select", onSelect, true);
    element.addEventListener("mousedown", onMouseDown, true);
    element.addEventListener("mouseup", onMouseUp, true);
    element.addEventListener("focus", onFocus, true);
    element.addEventListener("blur", onBlur, true);
    element[VarNames.JV_REMOVAL_FUNCTION] =
      function () {
        _debug("Removing our handlers!");
        try {
          element.removeEventListener("keydown", onKeydown, false);
          element.removeEventListener("keypress", onKeypress, false);
          element.removeEventListener("click", onClick, true);
          element.removeEventListener("select", onSelect, true);
          element.removeEventListener("mousedown", onMouseDown, true);
          element.removeEventListener("mouseup", onMouseUp, true);
          element.removeEventListener("focus", onFocus, true);
          element.removeEventListener("blur", onBlur, true);
          if (element.jv_divhack || justEatESC) {
            document.removeEventListener("keydown", gmailIsAnEscThief, true);
            var iframes = document.getElementsByTagName("iframe");
            for (var i = iframes.length - 1; i >= 0; --i)
              try {
                iframes[i].contentDocument.
                  removeEventListener("keydown", gmailIsAnEscThief, true);
              } catch (ex) { }
          }
          if (element.jv_divhack) {
            element.removeEventListener("DOMCharacterDataModified",
                                        onModified, true);
            element.removeEventListener("cut", onModifiedDelayed, true);
            element.removeEventListener("DOMNodeInsertedIntoDocument",
                                        onModified, true);
            element.jv_divhack = null;
            element.value = null;
            element.selectionStart = null;
            element.selectionEnd = null;
            element.jv_divhack_numchildren = null;
            element.jv_divhack_lastlinelen = null;
            element.jv_divhack_ignore_modifications = null;
            element.jv_just_eat_esc = null;
          }
          if (element.jv_orig_backgroundColor) {
            element.style.backgroundColor = element.jv_orig_backgroundColor;
            element.jv_orig_backgroundColor = null;
          }
          element[VarNames.JV_REMOVAL_FUNCTION] = null;
          if (statusBar && statusBar.parentNode) {
            statusBar.parentNode.removeChild(statusBar);
          }
        } catch (ex) {
          popup("Error in removing handlers:\n" + stringifyObj(ex));
        }
      };
  }

  function setUpElementIfNeeded(jsvim, element, upNotDown) {
    var fn = element[VarNames.JV_REMOVAL_FUNCTION];
    if (upNotDown && !fn) {
      jsvim.disallowed = jsvim.isDisallowed(element);
      if (!jsvim.disallowed || jsvim.disallowedJustEatEsc) {
        jsvim.onFoundTextArea();
        setUpElement(jsvim, element, jsvim.disallowed);
        return true;
      }
    } else if (!upNotDown && fn) {
      fn();
      return true;
    }
    return false;
  }

  // Non-extension or chrome extension.
  function setUpElementIfNeededForEvent(event) {
    var element = event.originalTarget || event.target;
    if (element.tagName && element.tagName.toLowerCase() == "textarea") {
      setUpElementIfNeeded(jsvim, element, true);
    } else if (divhackCheckElement(element)) {
      setUpElementIfNeeded(jsvim, element, true);
    }
  }

  // Non-extension or chrome extension
  function setUpIframe(iframe, upNotDown) {
    setUpDocument(iframe.contentDocument, upNotDown);
    if (upNotDown) {
      iframe.addEventListener("DOMNodeInsertedIntoDocument",
          setUpElementIfNeededForEvent, true);
    } else {
      iframe.removeEventListener("DOMNodeInsertedIntoDocument",
          setUpElementIfNeededForEvent, true);
    }
  }

  // Non-extension or chrome extension.
  // Is there any reason we shouldn't also have a setDown* for when we get
  // turned off?  Currently we do a lazy turn-off in Firefox [we make sure to
  // hide the status bar immediately], but chrome does it non-lazily.
  function setUpDocument(doc, upNotDown) {
    var textareas = doc.getElementsByTagName("textarea");
    
    // Reverse order here is just because of how my devel page is set up.
    for (var i = textareas.length - 1; i >= 0; --i) {
      setUpElementIfNeeded(jsvim, textareas[i], upNotDown);
    }

    //TODO(vona) - should I be concerned about the overhead of doing this?
    var divs = doc.getElementsByTagName("div");
    for (var i = 0; i < divs.length; i++)
      if (divhackCheckElement(divs[i]))
        setUpElementIfNeeded(jsvim, divs[i], upNotDown);

    if (!isChrome()) {
      var iframes = doc.getElementsByTagName("iframe");
      for (var i = iframes.length - 1; i >= 0; --i) {
        setUpIframe(iframes[i], upNotDown);
      }
    }
  }

  // Non-extension only.
  function setUp() {
    // If I get rid of these do-nothing handlers, things break!
    content.document.addEventListener("DOMNodeInsertedIntoDocument",
        function(e) {
        }, true);
    content.addEventListener("DOMNodeInsertedIntoDocument",
        function(e) {
        }, true);
    setUpDocument(content.document, true);
    return true;
  }

  // TODO: Share this code with notifyAll.
  if (document.getElementById("content")) { // Firefox extension path
    if (!isChrome()) {
      window.addEventListener("load", jsvim, true);
      window.addEventListener("keypress", jsvim, true);
      window.addEventListener("focus", jsvim, true);
      window.addEventListener("click", jsvim, true);
    }
  } else if (!isChrome()) {
    window.addEventListener("load", function() {setUp();}, false);
    window.addEventListener("DOMNodeInsertedIntoDocument",
        setUpElementIfNeededForEvent, true);
  }
})();
