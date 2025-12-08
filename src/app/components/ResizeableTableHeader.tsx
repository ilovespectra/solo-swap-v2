import { useRef, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { ColumnConfig } from '../types/table';

interface ResizableTableHeaderProps {
  column: ColumnConfig;
  onResize: (columnId: string, newWidth: number) => void;
  onSort: (field: string) => void;
  sortField: string;
  sortDirection: 'asc' | 'desc';
}

interface ResizableTableHeaderProps {
  column: ColumnConfig;
  onResize: (columnId: string, newWidth: number) => void;
  onSort: (field: string) => void;
  sortField: string;
  sortDirection: 'asc' | 'desc';
}

export function ResizableTableHeader({
  column,
  onResize,
  onSort,
  sortField,
  sortDirection,
}: ResizableTableHeaderProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: column.id });

  const [isResizing, setIsResizing] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    width: column.width,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    setIsResizing(true);
    startXRef.current = e.clientX;
    startWidthRef.current = column.width;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizing) return;
      
      const deltaX = moveEvent.clientX - startXRef.current;
      const newWidth = Math.max(80, startWidthRef.current + deltaX);
      
      onResize(column.id, newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const handleHeaderClick = () => {
    if (column.sortable) {
      onSort(column.field);
    }
  };

  return (
    <th
      ref={setNodeRef}
      style={style}
      className="relative py-3 sm:py-4 px-2 sm:px-4 bg-gray-800/50 group select-none"
      {...attributes}
    >
      <div className="flex items-center justify-between h-full">
        {column.resizable && (
          <div
            className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-purple-400 active:bg-purple-400 z-20 transition-colors"
            onMouseDown={handleResizeStart}
          />
        )}
        
        <div className="flex items-center space-x-2 flex-1 h-full">
          {column.resizable && (
            <div
              {...listeners}
              className="cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <GripVertical className="h-4 w-4 text-gray-400" />
            </div>
          )}
          
          <div
            onClick={handleHeaderClick}
            className={`flex-1 h-full flex items-center ${column.sortable ? 'cursor-pointer hover:text-white' : ''}`}
          >
            <div className="flex items-center space-x-2">
              <span className="text-xs sm:text-sm font-semibold text-gray-200">
                {column.label}
              </span>
              {column.sortable && sortField === column.field && (
                <span className="text-purple-400">
                  {sortDirection === 'asc' ? '↑' : '↓'}
                </span>
              )}
            </div>
          </div>
        </div>

        {column.resizable && (
          <div
            className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-purple-400 active:bg-purple-400 z-20 transition-colors"
            onMouseDown={handleResizeStart}
          />
        )}
      </div>

      {/* Visual resize indicator */}
      {isResizing && (
        <div className="absolute inset-0 border-r-2 border-purple-400 pointer-events-none z-10" />
      )}
    </th>
  );
}