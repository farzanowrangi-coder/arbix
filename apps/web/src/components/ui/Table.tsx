'use client';

import { useState, ReactNode } from 'react';
import clsx from 'clsx';
import Button from './Button';

export interface Column<T> {
  key: string;
  header: string;
  accessor: (row: T) => ReactNode;
  sortable?: boolean;
  width?: string;
  align?: 'left' | 'center' | 'right';
}

interface TableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => string;
  isLoading?: boolean;
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
  expandedRowId?: string | null;
  renderExpandedRow?: (row: T) => ReactNode;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    onNext: () => void;
    onPrev: () => void;
    onPage: (page: number) => void;
  };
  className?: string;
}

type SortDirection = 'asc' | 'desc' | null;

export default function Table<T>({
  columns,
  data,
  keyExtractor,
  isLoading = false,
  emptyMessage = 'No data available',
  onRowClick,
  expandedRowId,
  renderExpandedRow,
  pagination,
  className,
}: TableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDirection>(null);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : d === 'desc' ? null : 'asc'));
      if (sortDir === 'desc') setSortKey(null);
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const totalPages = pagination
    ? Math.ceil(pagination.total / pagination.pageSize)
    : 1;

  return (
    <div className={clsx('w-full', className)}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={clsx(
                    'px-3 py-2.5 text-left text-2xs font-bold text-text-muted uppercase tracking-wider select-none',
                    col.sortable && 'cursor-pointer hover:text-text-secondary transition-colors',
                    col.align === 'right' && 'text-right',
                    col.align === 'center' && 'text-center',
                    col.width,
                  )}
                  onClick={() => col.sortable && handleSort(col.key)}
                >
                  <span className="flex items-center gap-1">
                    {col.header}
                    {col.sortable && (
                      <span className="text-text-muted">
                        {sortKey === col.key
                          ? sortDir === 'asc'
                            ? '↑'
                            : sortDir === 'desc'
                              ? '↓'
                              : '↕'
                          : '↕'}
                      </span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  {columns.map((col) => (
                    <td key={col.key} className="px-3 py-3">
                      <div className="skeleton h-4 rounded w-3/4" />
                    </td>
                  ))}
                </tr>
              ))
            ) : data.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-12 text-center text-text-muted text-sm"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              data.map((row) => {
                const key = keyExtractor(row);
                const isExpanded = expandedRowId === key;
                return (
                  <>
                    <tr
                      key={key}
                      onClick={() => onRowClick?.(row)}
                      className={clsx(
                        'border-b border-border/50 transition-colors duration-100',
                        onRowClick && 'cursor-pointer',
                        isExpanded
                          ? 'bg-green-arb/5 border-green-arb/20'
                          : 'hover:bg-green-arb/[0.03]',
                      )}
                    >
                      {columns.map((col) => (
                        <td
                          key={col.key}
                          className={clsx(
                            'px-3 py-2.5 text-sm font-mono',
                            col.align === 'right' && 'text-right',
                            col.align === 'center' && 'text-center',
                          )}
                        >
                          {col.accessor(row)}
                        </td>
                      ))}
                    </tr>
                    {isExpanded && renderExpandedRow && (
                      <tr key={`${key}-expanded`} className="bg-green-arb/[0.03] border-b border-green-arb/20">
                        <td colSpan={columns.length} className="px-4 py-4">
                          {renderExpandedRow(row)}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {pagination && totalPages > 1 && (
        <div className="flex items-center justify-between px-3 py-3 border-t border-border">
          <span className="text-xs text-text-muted">
            {(pagination.page - 1) * pagination.pageSize + 1}–
            {Math.min(pagination.page * pagination.pageSize, pagination.total)} of{' '}
            {pagination.total}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="xs"
              onClick={pagination.onPrev}
              disabled={pagination.page <= 1}
            >
              ← Prev
            </Button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const p = i + 1;
              return (
                <Button
                  key={p}
                  variant={pagination.page === p ? 'outline' : 'ghost'}
                  size="xs"
                  onClick={() => pagination.onPage(p)}
                >
                  {p}
                </Button>
              );
            })}
            <Button
              variant="ghost"
              size="xs"
              onClick={pagination.onNext}
              disabled={pagination.page >= totalPages}
            >
              Next →
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
