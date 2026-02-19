/**
 * Test: Recharts — composable charting library built on D3 + React
 * 13.8M weekly downloads. Declarative JSX components.
 */
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  LineChart, Line, ResponsiveContainer,
} from 'recharts';

const barData = [
  { name: 'Jan', revenue: 4000, costs: 2400 },
  { name: 'Feb', revenue: 3000, costs: 1398 },
  { name: 'Mar', revenue: 2000, costs: 9800 },
  { name: 'Apr', revenue: 2780, costs: 3908 },
  { name: 'May', revenue: 1890, costs: 4800 },
  { name: 'Jun', revenue: 2390, costs: 3800 },
];

const lineData = [
  { x: 1, y: 10 }, { x: 2, y: 25 }, { x: 3, y: 18 },
  { x: 4, y: 32 }, { x: 5, y: 28 }, { x: 6, y: 42 },
];

export function RechartsTest() {
  return (
    <div>
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <ResponsiveContainer width={400} height={200}>
            <BarChart data={barData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="revenue" fill="#3b82f6" />
              <Bar dataKey="costs" fill="#ef4444" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div>
          <ResponsiveContainer width={300} height={200}>
            <LineChart data={lineData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="x" />
              <YAxis />
              <Line type="monotone" dataKey="y" stroke="#8b5cf6" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      <p style={{ color: 'green' }} id="recharts-status">Recharts loaded OK</p>
    </div>
  );
}
