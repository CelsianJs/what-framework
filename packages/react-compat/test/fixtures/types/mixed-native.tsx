/// <reference types="what-react/mixed" />
// A native What file (jsxImportSource what-framework) that renders React
// components typed the way npm packages type them (@types/react).
import { signal } from 'what-framework';
import type { FC, ReactNode, ComponentType } from 'react';
import { forwardRef, memo, Component } from 'react';

declare const Chart: FC<{ data: number[]; width?: number; children?: ReactNode }>;
declare const Axis: (props: { dataKey: string }) => ReactNode;
declare const Button: ReturnType<typeof forwardRef<HTMLButtonElement, { label: string }>>;
declare const Memoed: ReturnType<typeof memo<FC<{ n: number }>>>;
declare class Legacy extends Component<{ title: string }> {}
declare const Anything: ComponentType<{ x: string }>;

const points = signal([1, 2, 3]);

export function Dashboard() {
  return (
    <main class="m">
      <Chart data={points()} width={300}>
        <Axis dataKey="x" />
        <span>{points().length}</span>
      </Chart>
      <Button label="go" />
      <Memoed n={1} />
      <Legacy title="t" />
      <Anything x="y" />
    </main>
  );
}
