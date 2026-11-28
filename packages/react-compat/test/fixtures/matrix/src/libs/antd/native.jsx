// fixture.jsx as a native What file: signals for state, antd tags as islands.
// (`message.useMessage` is a hook, so this file uses the static `message`.)
import { signal } from 'what-framework';
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

export default function Native() {
  const count = signal(0);
  const text = signal('');
  const plan = signal('free');
  const open = signal(false);
  const sent = signal('');
  const failed = signal(0);
  return (
    <div>
      <ConfigProvider theme={{ token: { colorPrimary: '#00b96b' } }}>
        <Button id="an-btn" type="primary" onClick={() => count(count() + 1)}>Clicked {count()}</Button>
        <Input id="an-input" value={text()} onChange={(e) => text(e.target.value)} allowClear />
        <Select
          id="an-select"
          value={plan()}
          onChange={(next) => plan(next)}
          style={{ width: 160 }}
          options={[{ value: 'free', label: 'Free' }, { value: 'pro', label: 'Pro' }, { value: 'team', label: 'Team' }]}
        />
        <Button id="an-open" onClick={() => open(true)}>Open modal</Button>
        <Modal title="Confirm" open={open()} onOk={() => { open(false); message.success('Confirmed'); }} onCancel={() => open(false)} okText="Yes" cancelText="No">
          <p id="an-modal-body">Are you sure?</p>
        </Modal>
        <Form onFinish={(values) => sent(JSON.stringify(values))} onFinishFailed={() => failed(failed() + 1)} initialValues={{ remember: false }}>
          <Form.Item label="Email" name="email" rules={[{ required: true, message: 'email is required' }, { type: 'email', message: 'not an email' }]}>
            <Input id="an-email" />
          </Form.Item>
          <Form.Item name="remember" valuePropName="checked">
            <Checkbox id="an-remember">Remember</Checkbox>
          </Form.Item>
          <Button id="an-submit" htmlType="submit">Submit</Button>
        </Form>
        <Table id="an-table" columns={columns} dataSource={rows} pagination={{ pageSize: 3 }} size="small" />
        <Tabs items={[{ key: 'a', label: 'Alpha', children: <p id="an-tab">alpha panel</p> }, { key: 'b', label: 'Beta', children: <p id="an-tab">beta panel</p> }]} />
        <Button id="an-static" onClick={() => message.info('Static message')}>Static</Button>
      </ConfigProvider>
      <span id="an-echo">{text()}</span>
      <span id="an-plan">{plan()}</span>
      <span id="an-sent">{sent()}</span>
      <span id="an-failed">{failed()}</span>
    </div>
  );
}
