import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { ColumnConfig } from '../../types/table';

const COLUMN_SETTINGS_COLLECTION = 'columnSettings';

export const saveColumnSettings = async (userId: string, columns: ColumnConfig[]): Promise<void> => {
  try {
    await setDoc(doc(db, COLUMN_SETTINGS_COLLECTION, userId), {
      columns,
      updatedAt: new Date()
    });
  } catch (error) {
    console.error('failed to save column settings:', error);
    throw error;
  }
};

export const getColumnSettings = async (userId: string): Promise<ColumnConfig[] | null> => {
  try {
    const docRef = doc(db, COLUMN_SETTINGS_COLLECTION, userId);
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
      return docSnap.data().columns;
    }
    return null;
  } catch (error) {
    console.error('failed to fetch column settings:', error);
    return null;
  }
};