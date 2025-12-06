import CryptoJS from 'crypto-js';

export class EncryptionService {

  anonymizePublicKey(publicKey: string): string {
    const salt = process.env.NEXT_PUBLIC_HASH_SALT || 'filename-salt';
    const hash = CryptoJS.SHA256(publicKey + salt).toString();
    return `user_${hash.slice(0, 16)}`;
  }
  
  private getEncryptionKey(publicKey: string): string {
    const appSecret = process.env.NEXT_PUBLIC_ENCRYPTION_SECRET || 'fallback-secret';
    return CryptoJS.SHA256(publicKey + appSecret).toString();
  }

  encryptData<T>(data: T, publicKey: string): string {
    const key = this.getEncryptionKey(publicKey);
    const dataString = JSON.stringify(data);
    const encrypted = CryptoJS.AES.encrypt(dataString, key);
    return encrypted.toString();
  }

  decryptData<T>(encryptedData: string, publicKey: string): T | null {
    try {
      const key = this.getEncryptionKey(publicKey);
      const decrypted = CryptoJS.AES.decrypt(encryptedData, key);
      const decryptedString = decrypted.toString(CryptoJS.enc.Utf8);
      
      if (!decryptedString) {
        throw new Error('Decryption failed - invalid key or data');
      }
      
      return JSON.parse(decryptedString) as T;
    } catch (error) {
      return null;
    }
  }

  encryptPortfolioHistory(historyData: {
    totalValue: number;
    walletCount: number;
    tokenCount: number;
    timestamp: Date;
  }, publicKey: string): string {
    return this.encryptData(historyData, publicKey);
  }

  decryptPortfolioHistory(encryptedData: string, publicKey: string): {
    totalValue: number;
    walletCount: number;
    tokenCount: number;
    timestamp: Date;
    } | null {
    const decrypted = this.decryptData<{
        totalValue?: number;
        walletCount?: number;
        tokenCount?: number;
        timestamp?: string | number | Date;
    }>(encryptedData, publicKey);
    if (!decrypted) return null;

    let timestamp: Date;
    if (decrypted.timestamp) {
        timestamp = new Date(decrypted.timestamp);
    } else {
        timestamp = new Date();
    }

    return {
        totalValue: decrypted.totalValue || 0,
        walletCount: decrypted.walletCount || 0,
        tokenCount: decrypted.tokenCount || 0,
        timestamp: timestamp
    };
    }

  generateRandomEncrypted(publicKey: string): string {
    const randomData = {
      random: CryptoJS.lib.WordArray.random(32).toString(),
      timestamp: Date.now(),
      value: Math.random() * 1000
    };
    return this.encryptData(randomData, publicKey);
  }
}

export const encryptionService = new EncryptionService();