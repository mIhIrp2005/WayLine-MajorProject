// WAYLINE Local-First IndexedDB Storage Service
import { StoredMessage, EmergencyIncident, DiscoveredPeer, LocalIdentity } from '../types';

const DB_NAME = 'wayline_offline_db';
const DB_VERSION = 1;

class WaylineStorage {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private getDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains('messages')) {
          const messageStore = db.createObjectStore('messages', { keyPath: 'id' });
          messageStore.createIndex('timestamp', 'timestamp', { unique: false });
          messageStore.createIndex('recipientId', 'recipientId', { unique: false });
          messageStore.createIndex('status', 'status', { unique: false });
        }

        if (!db.objectStoreNames.contains('incidents')) {
          const incidentStore = db.createObjectStore('incidents', { keyPath: 'id' });
          incidentStore.createIndex('timestamp', 'timestamp', { unique: false });
          incidentStore.createIndex('status', 'status', { unique: false });
          incidentStore.createIndex('category', 'category', { unique: false });
        }

        if (!db.objectStoreNames.contains('peers')) {
          const peerStore = db.createObjectStore('peers', { keyPath: 'id' });
          peerStore.createIndex('lastSeen', 'lastSeen', { unique: false });
        }

        if (!db.objectStoreNames.contains('identity')) {
          db.createObjectStore('identity', { keyPath: 'key' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return this.dbPromise;
  }

  // --- Identity ---
  async getOrCreateIdentity(): Promise<LocalIdentity> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('identity', 'readonly');
      const store = tx.objectStore('identity');
      const req = store.get('local_node');

      req.onsuccess = async () => {
        if (req.result && req.result.data) {
          resolve(req.result.data);
        } else {
          // Generate new identity
          const randomSuffix = Math.floor(1000 + Math.random() * 9000);
          const platformName = navigator.userAgent.includes('Android') ? 'Android Phone' : 
                               navigator.userAgent.includes('Windows') ? 'Windows PC' : 'Field Device';
          const newId: LocalIdentity = {
            nodeId: 'node_' + Math.random().toString(36).substring(2, 10),
            nodeName: `${platformName} #${randomSuffix}`,
            created: Date.now()
          };

          const writeTx = db.transaction('identity', 'readwrite');
          writeTx.objectStore('identity').put({ key: 'local_node', data: newId });
          writeTx.oncomplete = () => resolve(newId);
          writeTx.onerror = () => reject(writeTx.error);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  async updateIdentityName(newName: string): Promise<LocalIdentity> {
    const current = await this.getOrCreateIdentity();
    current.nodeName = newName;
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('identity', 'readwrite');
      tx.objectStore('identity').put({ key: 'local_node', data: current });
      tx.oncomplete = () => resolve(current);
      tx.onerror = () => reject(tx.error);
    });
  }

  // --- Messages ---
  async saveMessage(message: StoredMessage): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('messages', 'readwrite');
      tx.objectStore('messages').put(message);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getAllMessages(): Promise<StoredMessage[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('messages', 'readonly');
      const store = tx.objectStore('messages');
      const req = store.getAll();
      req.onsuccess = () => {
        const sorted = (req.result as StoredMessage[]).sort((a, b) => a.timestamp - b.timestamp);
        resolve(sorted);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async updateMessageStatus(id: string, status: StoredMessage['status'], ackedBy?: string): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('messages', 'readwrite');
      const store = tx.objectStore('messages');
      const getReq = store.get(id);

      getReq.onsuccess = () => {
        if (getReq.result) {
          const msg = getReq.result as StoredMessage;
          msg.status = status;
          if (ackedBy) {
            msg.acknowledgedBy = msg.acknowledgedBy || [];
            if (!msg.acknowledgedBy.includes(ackedBy)) {
              msg.acknowledgedBy.push(ackedBy);
            }
            msg.acknowledgedAt = Date.now();
          }
          store.put(msg);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // --- Incidents (SOS) ---
  async saveIncident(incident: EmergencyIncident): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('incidents', 'readwrite');
      tx.objectStore('incidents').put(incident);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getAllIncidents(): Promise<EmergencyIncident[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('incidents', 'readonly');
      const store = tx.objectStore('incidents');
      const req = store.getAll();
      req.onsuccess = () => {
        const sorted = (req.result as EmergencyIncident[]).sort((a, b) => b.timestamp - a.timestamp);
        resolve(sorted);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async updateIncidentStatus(id: string, status: EmergencyIncident['status']): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('incidents', 'readwrite');
      const store = tx.objectStore('incidents');
      const getReq = store.get(id);

      getReq.onsuccess = () => {
        if (getReq.result) {
          const inc = getReq.result as EmergencyIncident;
          inc.status = status;
          store.put(inc);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // --- Peers ---
  async savePeer(peer: DiscoveredPeer): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('peers', 'readwrite');
      tx.objectStore('peers').put(peer);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getAllPeers(): Promise<DiscoveredPeer[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('peers', 'readonly');
      const store = tx.objectStore('peers');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  // --- Clear / Reset ---
  async clearAllData(): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['messages', 'incidents', 'peers'], 'readwrite');
      tx.objectStore('messages').clear();
      tx.objectStore('incidents').clear();
      tx.objectStore('peers').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

export const storage = new WaylineStorage();
