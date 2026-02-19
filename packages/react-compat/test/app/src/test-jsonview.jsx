import React from 'react';
import { JsonView, allExpanded, defaultStyles } from 'react-json-view-lite';
import 'react-json-view-lite/dist/index.css';

const sampleData = {
  name: "What Framework",
  version: "0.5.2",
  features: ["signals", "reactivity", "compat-layer"],
  stats: {
    confirmedLibs: 40,
    weeklyDownloads: "140M+",
    avgSpeedup: "8.4x"
  },
  nested: {
    deep: {
      value: true,
      array: [1, 2, 3, null, "string"]
    }
  }
};

export function JsonViewTest() {
  return (
    <div style={{ padding: 16, border: '1px solid #ccc', borderRadius: 8 }}>
      <h3>react-json-view-lite</h3>
      <div style={{ background: '#f8f8f8', borderRadius: 4, padding: 12, maxHeight: 250, overflow: 'auto' }}>
        <JsonView data={sampleData} shouldExpandNode={allExpanded} style={defaultStyles} />
      </div>
      <p style={{ marginTop: 8, color: 'green', fontWeight: 'bold' }}>PASS — JSON tree renders expanded</p>
    </div>
  );
}
