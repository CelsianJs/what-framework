import styled from '@emotion/styled';

const Button = styled.button`
  padding: 8px 16px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  font-weight: 600;
  background: ${props => props.variant === 'purple' ? '#a855f7' : '#3b82f6'};
  color: white;
  transition: transform 0.1s;
  &:hover { transform: scale(1.05); }
  &:active { transform: scale(0.95); }
`;

const Card = styled.div`
  padding: 16px;
  border-radius: 8px;
  background: ${props => props.dark ? '#1e293b' : '#f1f5f9'};
  color: ${props => props.dark ? '#e2e8f0' : '#1e293b'};
  border: 1px solid ${props => props.dark ? '#334155' : '#cbd5e1'};
`;

export function EmotionTest() {
  return (
    <div style={{ display: 'flex', gap: '12px', flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: '8px' }}>
        <Button>Emotion Button</Button>
        <Button variant="purple">Purple Variant</Button>
      </div>
      <div style={{ display: 'flex', gap: '12px' }}>
        <Card dark>Dark styled card</Card>
        <Card>Light styled card</Card>
      </div>
      <p style={{ color: 'green' }}>@emotion/styled components with dynamic props</p>
    </div>
  );
}
