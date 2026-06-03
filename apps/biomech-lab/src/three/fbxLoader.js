import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

export class IronSyncFbxLoader {
  constructor() {
    this.loader = new FBXLoader();
  }

  async loadFromFile(file) {
    const url = URL.createObjectURL(file);
    try {
      return await this.loadFromUrl(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  loadFromUrl(url) {
    return new Promise((resolve, reject) => {
      this.loader.load(url, resolve, undefined, reject);
    });
  }
}
