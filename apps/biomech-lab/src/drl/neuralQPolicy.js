export class NeuralQPolicy {
  constructor({ inputSize, actions, hiddenSize = 48, learningRate = 0.012, gamma = 0.92, weights } = {}) {
    this.inputSize = inputSize;
    this.actions = actions;
    this.hiddenSize = hiddenSize;
    this.learningRate = learningRate;
    this.gamma = gamma;
    this.weights = weights ?? createWeights(inputSize, hiddenSize, actions.length);
  }

  predict(state) {
    const hiddenRaw = multiplyAdd(state, this.weights.w1, this.weights.b1, this.hiddenSize);
    const hidden = hiddenRaw.map((value) => Math.tanh(value));
    const output = multiplyAdd(hidden, this.weights.w2, this.weights.b2, this.actions.length);
    return { hidden, output };
  }

  chooseAction(state, epsilon = 0) {
    if (Math.random() < epsilon) return Math.floor(Math.random() * this.actions.length);
    const { output } = this.predict(state);
    return argMax(output);
  }

  train(batch) {
    if (!batch.length) return 0;
    let loss = 0;
    for (const item of batch) {
      const current = this.predict(item.state);
      const next = this.predict(item.nextState);
      const target = item.reward + (item.done ? 0 : this.gamma * Math.max(...next.output));
      const prediction = current.output[item.actionIndex];
      const error = clamp(target - prediction, -4, 4);
      loss += error * error;
      this.#backprop(item.state, current.hidden, item.actionIndex, error);
    }
    return loss / batch.length;
  }

  inherit({ mutation = 0.015 } = {}) {
    return new NeuralQPolicy({
      inputSize: this.inputSize,
      actions: this.actions,
      hiddenSize: this.hiddenSize,
      learningRate: this.learningRate,
      gamma: this.gamma,
      weights: mutateWeights(this.weights, mutation),
    });
  }

  snapshot() {
    return {
      schema: 'ironsync.dqn-policy.v1',
      inputSize: this.inputSize,
      hiddenSize: this.hiddenSize,
      actions: this.actions,
      learningRate: this.learningRate,
      gamma: this.gamma,
      weights: this.weights,
    };
  }

  static fromSnapshot(snapshot, overrides = {}) {
    return new NeuralQPolicy({
      inputSize: snapshot.inputSize,
      hiddenSize: snapshot.hiddenSize,
      actions: snapshot.actions,
      learningRate: overrides.learningRate ?? snapshot.learningRate,
      gamma: overrides.gamma ?? snapshot.gamma,
      weights: snapshot.weights,
    });
  }

  #backprop(state, hidden, actionIndex, error) {
    const lr = this.learningRate;
    for (let h = 0; h < this.hiddenSize; h += 1) {
      const w2Index = h * this.actions.length + actionIndex;
      const oldW2 = this.weights.w2[w2Index];
      this.weights.w2[w2Index] += lr * error * hidden[h];
      const hiddenGradient = error * oldW2 * (1 - hidden[h] * hidden[h]);
      this.weights.b1[h] += lr * hiddenGradient;
      for (let i = 0; i < this.inputSize; i += 1) {
        this.weights.w1[i * this.hiddenSize + h] += lr * hiddenGradient * state[i];
      }
    }
    this.weights.b2[actionIndex] += lr * error;
  }
}

function createWeights(inputSize, hiddenSize, outputSize) {
  return {
    w1: Array.from({ length: inputSize * hiddenSize }, () => randomWeight(inputSize)),
    b1: Array.from({ length: hiddenSize }, () => 0),
    w2: Array.from({ length: hiddenSize * outputSize }, () => randomWeight(hiddenSize)),
    b2: Array.from({ length: outputSize }, () => 0),
  };
}

function mutateWeights(weights, amount) {
  return {
    w1: weights.w1.map((value) => value + randomBetween(-amount, amount)),
    b1: weights.b1.map((value) => value + randomBetween(-amount, amount)),
    w2: weights.w2.map((value) => value + randomBetween(-amount, amount)),
    b2: weights.b2.map((value) => value + randomBetween(-amount, amount)),
  };
}

function multiplyAdd(input, weights, bias, outputSize) {
  const output = [];
  for (let o = 0; o < outputSize; o += 1) {
    let value = bias[o] ?? 0;
    for (let i = 0; i < input.length; i += 1) value += input[i] * weights[i * outputSize + o];
    output.push(value);
  }
  return output;
}

function argMax(values) {
  let index = 0;
  for (let i = 1; i < values.length; i += 1) if (values[i] > values[index]) index = i;
  return index;
}

function randomWeight(fanIn) {
  return randomBetween(-1, 1) / Math.sqrt(Math.max(1, fanIn));
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
