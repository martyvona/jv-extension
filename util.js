function isChrome() {
  return window.chrome && window.chrome.extension;
}

function debug(s) {
  if (typeof(dump) == 'function') {
    dump(s + '\n');
  } else if (console && (typeof(console.log) == 'function')) {
    console.log(s);
  }
}

function logStack(ex) {
  if (!ex) {
    ex = new Error('dummy');
  }
  var stack =
    ex.stack.replace(/^[^\(]+?[\n$]/gm, '')
    .replace(/^\s+at\s+/gm, '')
    .replace(/^Object.<anonymous>\s*\(/gm, '{anonymous}()@');
  //.split('\n');
  console.log(stack);
}

var _debug = debug;

function nop() {}

function stringifyObj(obj) {
  if (!obj) {
    return "null object";
  }
  var str = "";
  for (var i in obj) {
    str += i + ":\t";
    try {
      str += obj[i] + '\n';
    } catch (ex) {
      str += typeof obj;
    }
  }
  return str;
}

function popup(s) {
  var str = s + "\n" + stringifyObj(new Error());
  _debug(str);
  if (!window.jsvim || jsvim.popupOnAssert) {
    alert(str);
  }
}

function stringifyObjNames(obj) {
  if (!obj) {
    return "null object";
  }
  var tag;
  if (obj.name) {
    tag = "(Name) " + obj.name;
  } else if (obj.title) {
    tag = "(Title) " + obj.title;
  } else if (obj.id) {
    tag = "(ID) " + obj.id;
  } else {
    tag = "(OBJECT)";
  }
  var str = tag + ": ";

  for (i in obj) {
    str += i + ", ";
  }
  return str;
}

function assert(t) {
  if (!t) {
    popup(stringifyObj(new Error("Assertion failed!")));
    throw "Assertion failed!";
  }
}

function dumpLocalStorage() {
  for (var i in localStorage) {
    _debug("localStorage[" + i + "]: " + localStorage[i]);
  }
}

var timingEvents;

function initTiming() {
 timingEvents = new Array();
}

function pushTimingEvent(text) {
  if (timingEvents) {
    timingEvents.push([text, new Date().getTime()]);
  }
}

function dumpTimingEvents() {
  if (timingEvents) {
    var lastTime = 0;
    timingEvents.reverse();
    _debug("");
    while (timingEvents.length) {
      var record = timingEvents.pop();
      var text = record[0];
      var time = record[1];
      _debug(text + ",\t" + time + ",\t" + (time - lastTime));
      lastTime = time;
    }
    _debug("");
  } else {
    initTiming();
  }
}

function startsWith(str, substr) {
  return str.slice(0, substr.length) == substr;
}

function endsWith(str, substr) {
  return str.slice(-substr.length) == substr;
}
