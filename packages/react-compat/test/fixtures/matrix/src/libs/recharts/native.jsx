// fixture.jsx as a native What file: the data is a signal, the charts are islands.
import { signal } from 'what-framework';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const base = [
  { name: 'Mon', sales: 30, cost: 12 },
  { name: 'Tue', sales: 45, cost: 20 },
  { name: 'Wed', sales: 28, cost: 9 },
];

export default function Native() {
  const data = signal(base);
  const picked = signal('none');
  return (
    <div>
      <button id="rc-add" onClick={() => data([...data(), { name: 'Day' + data().length, sales: 50, cost: 25 }])}>add day</button>
      <BarChart id="rc-bar" width={420} height={220} data={data()}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="name" />
        <YAxis />
        <Tooltip isAnimationActive={false} />
        <Legend />
        <Bar dataKey="sales" fill="#3366cc" isAnimationActive={false} onClick={(entry) => picked(entry.name ?? entry.payload?.name)} />
        <Bar dataKey="cost" fill="#cc6633" isAnimationActive={false} />
      </BarChart>
      <span id="rc-picked">{picked()}</span>
      <div id="rc-responsive" style={{ width: '400px', height: '200px' }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data()}>
            <XAxis dataKey="name" />
            <YAxis />
            <Line type="monotone" dataKey="sales" stroke="#8884d8" strokeWidth={3} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <PieChart width={200} height={200}>
        <Pie data={data()} dataKey="sales" nameKey="name" cx="50%" cy="50%" outerRadius={70} isAnimationActive={false}>
          {data().map((entry, i) => <Cell key={entry.name} fill={['#0088fe', '#00c49f', '#ffbb28', '#ff8042'][i % 4]} />)}
        </Pie>
      </PieChart>
    </div>
  );
}
