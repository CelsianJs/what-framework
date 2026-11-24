import { useState } from 'react';
import { Button, Checkbox, ConfigProvider, Form, Input, Modal, Select, Table, Tabs, message } from 'antd';

const rows = [
  { key: 1, name: 'Linus', age: 54 },
  { key: 2, name: 'Ada', age: 36 },
  { key: 3, name: 'Grace', age: 85 },
  { key: 4, name: 'Margaret', age: 61 },
];
const columns = [
  { title: 'Name', dataIndex: 'name', sorter: (a, b) => a.name.localeCompare(b.name) },
  { title: 'Age', dataIndex: 'age', sorter: (a, b) => a.age - b.age },
];

export default function Fixture() {
  const [count, setCount] = useState(0);
  const [text, setText] = useState('');
  const [plan, setPlan] = useState('free');
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState('');
  const [failed, setFailed] = useState(0);
  const [api, contextHolder] = message.useMessage();
  return (
    <ConfigProvider theme={{ token: { colorPrimary: '#00b96b' } }}>
      {contextHolder}
      <Button id="an-btn" type="primary" onClick={() => setCount(count + 1)}>Clicked {count}</Button>
      <Input id="an-input" value={text} onChange={(e) => setText(e.target.value)} allowClear />
      <span id="an-echo">{text}</span>

      <Select
        id="an-select"
        value={plan}
        onChange={setPlan}
        style={{ width: 160 }}
        options={[{ value: 'free', label: 'Free' }, { value: 'pro', label: 'Pro' }, { value: 'team', label: 'Team' }]}
      />
      <span id="an-plan">{plan}</span>

      <Button id="an-open" onClick={() => setOpen(true)}>Open modal</Button>
      <Modal title="Confirm" open={open} onOk={() => { setOpen(false); api.success('Confirmed'); }} onCancel={() => setOpen(false)} okText="Yes" cancelText="No">
        <p id="an-modal-body">Are you sure?</p>
      </Modal>

      <Form onFinish={(values) => setSent(JSON.stringify(values))} onFinishFailed={() => setFailed((n) => n + 1)} initialValues={{ remember: false }}>
        <Form.Item label="Email" name="email" rules={[{ required: true, message: 'email is required' }, { type: 'email', message: 'not an email' }]}>
          <Input id="an-email" />
        </Form.Item>
        <Form.Item name="remember" valuePropName="checked">
          <Checkbox id="an-remember">Remember</Checkbox>
        </Form.Item>
        <Button id="an-submit" htmlType="submit">Submit</Button>
      </Form>
      <span id="an-sent">{sent}</span>
      <span id="an-failed">{failed}</span>

      <Table id="an-table" columns={columns} dataSource={rows} pagination={{ pageSize: 3 }} size="small" />

      <Tabs items={[{ key: 'a', label: 'Alpha', children: <p id="an-tab">alpha panel</p> }, { key: 'b', label: 'Beta', children: <p id="an-tab">beta panel</p> }]} />
      <Button id="an-static" onClick={() => message.info('Static message')}>Static</Button>
    </ConfigProvider>
  );
}
