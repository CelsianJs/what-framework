/**
 * Test: Ant Design inside What Framework
 *
 * Ant Design is one of the largest React component libraries:
 * - Complex compound components (Form, Table, Select)
 * - Internal context + provider system
 * - CSS-in-JS (cssinjs/antd-style)
 * - Portal-based dropdowns and modals
 * - Ref forwarding throughout
 * - Locale/theme configuration
 */
import { useState } from 'react';
import {
  Button,
  Space,
  Switch,
  Tag,
  Badge,
  Alert,
  Progress,
  Rate,
  Tooltip,
  ConfigProvider,
} from 'antd';

export function AntdTest() {
  const [count, setCount] = useState(0);
  const [checked, setChecked] = useState(false);
  const [rating, setRating] = useState(3);
  const [showAlert, setShowAlert] = useState(true);

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#6366f1',
          borderRadius: 6,
        },
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Buttons */}
        <Space>
          <Button type="primary" onClick={() => setCount((c) => c + 1)}>
            Clicked {count} times
          </Button>
          <Button onClick={() => setCount(0)}>Reset</Button>
          <Button type="dashed" danger>
            Danger
          </Button>
        </Space>

        {/* Switch + Tags */}
        <Space>
          <Switch
            checked={checked}
            onChange={setChecked}
            checkedChildren="ON"
            unCheckedChildren="OFF"
          />
          <Tag color="blue">Blue Tag</Tag>
          <Tag color="green">Green Tag</Tag>
          <Tag color={checked ? 'red' : 'default'}>
            {checked ? 'Active' : 'Inactive'}
          </Tag>
        </Space>

        {/* Badge + Progress */}
        <Space align="center" style={{ gap: '24px' }}>
          <Badge count={count} showZero>
            <div
              style={{
                width: '40px',
                height: '40px',
                background: '#f0f0f0',
                borderRadius: '6px',
              }}
            />
          </Badge>
          <Progress
            percent={Math.min(count * 10, 100)}
            style={{ width: '200px' }}
            status={count >= 10 ? 'success' : 'active'}
          />
        </Space>

        {/* Rate */}
        <Space>
          <span>Rating:</span>
          <Rate value={rating} onChange={setRating} />
          <span>({rating} stars)</span>
        </Space>

        {/* Tooltip */}
        <Space>
          <Tooltip title="This is a tooltip from Ant Design">
            <Button>Hover me</Button>
          </Tooltip>
        </Space>

        {/* Alert */}
        {showAlert && (
          <Alert
            message="Ant Design is running on What Framework"
            description="All components rendered via the what-react compatibility layer."
            type="success"
            showIcon
            closable
            onClose={() => setShowAlert(false)}
          />
        )}

        <p style={{ color: 'green' }} id="antd-status">
          Ant Design loaded OK
        </p>
      </div>
    </ConfigProvider>
  );
}
