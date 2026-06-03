export class ReplayBuffer {
  constructor(capacity = 5000) {
    this.capacity = capacity;
    this.items = [];
    this.cursor = 0;
  }

  push(transition) {
    if (this.items.length < this.capacity) {
      this.items.push(transition);
    } else {
      this.items[this.cursor] = transition;
      this.cursor = (this.cursor + 1) % this.capacity;
    }
  }

  sample(size) {
    const count = Math.min(size, this.items.length);
    const batch = [];
    for (let i = 0; i < count; i += 1) {
      batch.push(this.items[Math.floor(Math.random() * this.items.length)]);
    }
    return batch;
  }

  clear() {
    this.items = [];
    this.cursor = 0;
  }

  get length() {
    return this.items.length;
  }

  snapshot(limit = 200) {
    return this.items.slice(-limit);
  }
}
