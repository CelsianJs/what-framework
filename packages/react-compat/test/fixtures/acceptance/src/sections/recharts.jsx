import React from 'react';
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
} from 'recharts';

const data = [
  { name: 'Jan', a: 4000, b: 2400 },
  { name: 'Feb', a: 3000, b: 1398 },
  { name: 'Mar', a: 2000, b: 9800 },
  { name: 'Apr', a: 2780, b: 3908 },
  { name: 'May', a: 1890, b: 4800 },
  { name: 'Jun', a: 2390, b: 3800 },
];

export function RechartsSection() {
  return (
    <section>
      <h2>8. recharts</h2>
      <div id="rc-area" style={{ width: 480, height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" tick={{ fontSize: 12, fontFamily: 'sans-serif' }} />
            <YAxis tick={{ fontSize: 12, fontFamily: 'sans-serif' }} />
            <Area type="monotone" dataKey="a" stroke="#00d4ff" fill="#00d4ff" fillOpacity={0.3} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div id="rc-line" style={{ width: 480, height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" tick={{ fontSize: 12, fontFamily: 'sans-serif' }} />
            <YAxis tick={{ fontSize: 12, fontFamily: 'sans-serif' }} />
            <Line type="monotone" dataKey="a" stroke="#00d4ff" strokeWidth={2} />
            <Line type="monotone" dataKey="b" stroke="#82ca9d" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
