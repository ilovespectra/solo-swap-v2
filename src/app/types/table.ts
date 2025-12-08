export type SortField = 'symbol' | 'balance' | 'USD' | 'value' | 'percentage' | 'source';

export interface ColumnConfig {
  id: string;
  label: string;
  width: number;
  visible: boolean;
  sortable: boolean;
  resizable: boolean;
  field: SortField;
  configurable?: boolean;
}