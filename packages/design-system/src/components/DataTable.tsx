import { Table } from "@chakra-ui/react";
import type { ReactNode } from "react";

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  width?: string;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
}

export function DataTable<T>({ columns, rows, rowKey }: DataTableProps<T>) {
  return (
    <Table.Root size="sm" variant="line" tableLayout="fixed">
      <Table.Header>
        <Table.Row>
          {columns.map((c) => (
            <Table.ColumnHeader key={c.key} width={c.width} fontSize="xs">
              {c.header}
            </Table.ColumnHeader>
          ))}
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {rows.map((r, i) => (
          <Table.Row key={rowKey(r, i)}>
            {columns.map((c) => (
              <Table.Cell key={c.key} fontSize="xs" verticalAlign="top" wordBreak="break-word">
                {c.render(r)}
              </Table.Cell>
            ))}
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  );
}
