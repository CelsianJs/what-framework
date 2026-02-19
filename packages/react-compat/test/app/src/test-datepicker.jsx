/**
 * Test: react-datepicker — reusable datepicker component
 * 2.7M weekly downloads. Portals for calendar, refs, controlled input.
 */
import DatePicker from 'react-datepicker';
import { useState } from 'react';
import 'react-datepicker/dist/react-datepicker.css';

export function DatePickerTest() {
  const [startDate, setStartDate] = useState(new Date());
  const [dateRange, setDateRange] = useState([null, null]);
  const [startRange, endRange] = dateRange;

  return (
    <div>
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <label style={{ fontSize: '13px', color: '#666', display: 'block', marginBottom: '4px' }}>Single date:</label>
          <DatePicker
            selected={startDate}
            onChange={(date) => setStartDate(date)}
          />
          <p style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
            Selected: {startDate?.toLocaleDateString()}
          </p>
        </div>
        <div>
          <label style={{ fontSize: '13px', color: '#666', display: 'block', marginBottom: '4px' }}>Date range:</label>
          <DatePicker
            selectsRange
            startDate={startRange}
            endDate={endRange}
            onChange={(update) => setDateRange(update)}
            placeholderText="Select range"
          />
        </div>
      </div>
      <p style={{ color: 'green' }} id="datepicker-status">React DatePicker loaded OK</p>
    </div>
  );
}
