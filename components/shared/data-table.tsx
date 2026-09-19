"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableSkeleton } from "@/components/shared/loading-skeleton";
import { cn } from "@/lib/utils";

export interface DataTableColumn<T> {
  id: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  className?: string;
  headerClassName?: string;
  /** Hide the column below `lg` (it should then appear in the mobile card). */
  hideBelowLg?: boolean;
  align?: "left" | "right";
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  empty?: React.ReactNode;
  /** Card presentation used below the `md` breakpoint instead of a scrolling table. */
  renderMobileCard?: (row: T) => React.ReactNode;
  onRowClick?: (row: T) => void;
  caption?: string;
  className?: string;
}

/**
 * Lightweight responsive table. On small screens it switches to a card list
 * (when `renderMobileCard` is provided) so nothing scrolls horizontally.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  empty,
  renderMobileCard,
  onRowClick,
  caption,
  className,
}: DataTableProps<T>) {
  if (loading) return <TableSkeleton columns={Math.min(columns.length, 5)} className={className} />;
  if (rows.length === 0 && empty) return <>{empty}</>;

  return (
    <div className={cn("space-y-3", className)}>
      {renderMobileCard && (
        <ul className="grid gap-3 md:hidden" aria-label={caption}>
          {rows.map((row) => (
            <li key={rowKey(row)}>{renderMobileCard(row)}</li>
          ))}
        </ul>
      )}
      <div
        className={cn("overflow-hidden rounded-xl glass", renderMobileCard && "hidden md:block")}
      >
        <div className="overflow-x-auto">
          <Table>
            {caption && <caption className="sr-only">{caption}</caption>}
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {columns.map((col) => (
                  <TableHead
                    key={col.id}
                    className={cn(
                      "h-10 text-xs font-medium tracking-wide text-muted-foreground uppercase",
                      col.hideBelowLg && "hidden lg:table-cell",
                      col.align === "right" && "text-right",
                      col.headerClassName,
                    )}
                  >
                    {col.header}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(onRowClick && "cursor-pointer")}
                  tabIndex={onRowClick ? 0 : undefined}
                  onKeyDown={
                    onRowClick
                      ? (event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onRowClick(row);
                          }
                        }
                      : undefined
                  }
                >
                  {columns.map((col) => (
                    <TableCell
                      key={col.id}
                      className={cn(
                        "py-3 align-middle",
                        col.hideBelowLg && "hidden lg:table-cell",
                        col.align === "right" && "text-right",
                        col.className,
                      )}
                    >
                      {col.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
