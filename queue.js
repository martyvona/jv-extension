function Queue(capacity) {
  this.q = new Array(capacity);
  this.next = 0;
  this.size = 0;

  this.isFull = function() {
    return this.size >= this.q.length;
  }

  this.isEmpty = function() {
    return this.size <= 0;
  }

  this.push = function(elt) {
    if (this.isFull()) {
      throw new Error("Can't push on a full queue!");
    }
    this.q[(this.next + this.size++) % this.q.length] = elt;
  }

  this.pop = function() {
    if (this.isEmpty()) {
      throw new Error("Can't pop from an empty queue!");
    }
    var ret = this.q[this.next];
    this.next = (this.next + 1) % this.q.length;
    --this.size;
    return ret;
  }

  this.peek = function() {
    if (this.isEmpty()) {
      throw new Error("Can't peek at an empty queue!");
    }
    return this.q[this.next];
  }

  this.clear = function() {
    this.next = this.size = 0;
  }
  return this;
}

