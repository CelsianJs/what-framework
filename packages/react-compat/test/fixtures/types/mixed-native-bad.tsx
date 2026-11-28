/// <reference types="what-react/mixed" />
// Wrong props on React components in a native file are still errors.
import type { FC, ReactNode } from 'react';

declare const Chart: FC<{ data: number[]; children?: ReactNode }>;
declare const Axis: (props: { dataKey: string }) => ReactNode;

export function Bad() {
  return (
    <main>
      <Chart data="not numbers" />
      <Axis dataKey={1} />
      <Axis dataKey="x" nope />
    </main>
  );
}
