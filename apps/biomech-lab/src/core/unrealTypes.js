export class IronSyncRotator {
  constructor(pitch = 0, yaw = 0, roll = 0) {
    this.pitch = pitch;
    this.yaw = yaw;
    this.roll = roll;
  }

  static fromEuler(euler) {
    return new IronSyncRotator(
      radiansToDegrees(euler.x),
      radiansToDegrees(euler.y),
      radiansToDegrees(euler.z),
    );
  }

  clone(overrides = {}) {
    return new IronSyncRotator(
      overrides.pitch ?? this.pitch,
      overrides.yaw ?? this.yaw,
      overrides.roll ?? this.roll,
    );
  }

  toRadians() {
    return {
      x: degreesToRadians(this.pitch),
      y: degreesToRadians(this.yaw),
      z: degreesToRadians(this.roll),
    };
  }

  toJSON() {
    return {
      rx: round(this.pitch),
      ry: round(this.yaw),
      rz: round(this.roll),
    };
  }
}

export class IronSyncVector {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  toJSON() {
    return { x: round(this.x), y: round(this.y), z: round(this.z) };
  }
}

export class FRotator extends IronSyncRotator {
  constructor(pitch = 0, yaw = 0, roll = 0) {
    super(pitch, yaw, roll);
  }

  static fromIronSync(rotator) {
    return new FRotator(rotator.pitch, rotator.yaw, rotator.roll);
  }

  toUnrealJSON() {
    return {
      Pitch: round(this.pitch),
      Yaw: round(this.yaw),
      Roll: round(this.roll),
    };
  }
}

export class FVector extends IronSyncVector {
  constructor(x = 0, y = 0, z = 0) {
    super(x, y, z);
  }

  static fromThreeVector(vector) {
    return new FVector(vector.x, vector.y, vector.z);
  }

  toUnrealJSON() {
    return {
      X: round(this.x),
      Y: round(this.y),
      Z: round(this.z),
    };
  }
}

export function degreesToRadians(value) {
  return (value * Math.PI) / 180;
}

export function radiansToDegrees(value) {
  return (value * 180) / Math.PI;
}

function round(value) {
  return Number(value.toFixed(3));
}
