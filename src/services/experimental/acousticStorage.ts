// WAYLINE Experimental Acoustic Lab Storage Service
// Completely isolated from production database (uses wayline_acoustic_lab_db)

export interface AcousticTestLog {
  id: string;
  timestamp: number;
  direction: 'TX' | 'RX';
  frameType: 'DATA' | 'ACK' | 'BEACON' | 'RELAY';
  packetId: string;
  senderId: string;
  payload: string;
  status: 'SUCCESS' | 'CORRUPTED' | 'TIMEOUT';
  snrDb?: number;
  durationMs?: number;
}

export interface AcousticEndpoint {
  nodeId: string;
  lastSeen: number;
  rssiEstimate?: number;
  lastSequence: number;
}

const DB_NAME = 'wayline_acoustic_lab_db';
const DB_VERSION = 1;

class AcousticLabStorage {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private getDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('test_logs')) {
          const logStore = db.createObjectStore('test_logs', { keyPath: 'id' });
          logStore.createIndex('timestamp', 'timestamp', { unique: false });
          logStore.createIndex('packetId', 'packetId', { unique: false });
        }
        if (!db.objectStoreNames.contains('discovered_endpoints')) {
          db.createObjectStore('discovered_endpoints', { keyPath: 'nodeId' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return this.dbPromise;
  }

  async saveLog(log: AcousticTestLog): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('test_logs', 'readwrite');
      tx.objectStore('test_logs').put(log);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getRecentLogs(limit = 50): Promise<AcousticTestLog[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('test_logs', 'readonly');
      const store = tx.objectStore('test_logs');
      const req = store.getAll();
      req.onsuccess = () => {
        const sorted = (req.result as AcousticTestLog[]).sort((a, b) => b.timestamp - a.timestamp);
        resolve(sorted.slice(0, limit));
      };
      req.onerror = () => reject(req.error);
    });
  }

  async saveEndpoint(endpoint: AcousticEndpoint): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('discovered_endpoints', 'readwrite');
      tx.objectStore('discovered_endpoints').put(endpoint);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getAllEndpoints(): Promise<AcousticEndpoint[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('discovered_endpoints', 'readonly');
      const req = tx.objectStore('discovered_endpoints').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async clearLabData(): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['test_logs', 'discovered_endpoints'], 'readwrite');
      tx.objectStore('test_logs').clear();
      tx.objectStore('discovered_endpoints').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

export const acousticStorage = new AcousticLabStorage();
