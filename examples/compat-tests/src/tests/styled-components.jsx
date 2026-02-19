import { useState } from 'react';
import styled from 'styled-components';

const StyledButton = styled.button`
  background: ${props => props.$active ? '#3b82f6' : '#1a1a2e'};
  padding: 10px 20px;
  color: ${props => props.$active ? '#fff' : '#e5e5e5'};
  border: 1px solid ${props => props.$active ? '#3b82f6' : '#444'};
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s ease;

  &:hover {
    background: ${props => props.$active ? '#2563eb' : '#252540'};
    border-color: #666;
  }
`;

const Badge = styled.span`
  display: inline-block;
  padding: 2px 8px;
  background: #8b5cf620;
  color: #8b5cf6;
  border-radius: 12px;
  font-size: 11px;
  margin-left: 8px;
`;

function TestComponent() {
  const [active, setActive] = useState(false);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <StyledButton $active={active} onclick={() => setActive(!active)}>
          {active ? 'Active' : 'Inactive'}
        </StyledButton>
        <Badge>styled-components v6</Badge>
      </div>
      <div style={{ marginTop: '6px', fontSize: '11px', color: '#888' }}>
        Uses styled.button and styled.span with transient props ($active)
      </div>
    </div>
  );
}

TestComponent.packageName = 'styled-components';
TestComponent.downloads = '7.8M/week';
export default TestComponent;
