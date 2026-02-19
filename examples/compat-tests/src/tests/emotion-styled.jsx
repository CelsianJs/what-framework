import { useState } from 'react';
import styled from '@emotion/styled';

const StyledBox = styled.div`
  background: ${props => props.active ? '#22c55e20' : '#1a1a2e'};
  padding: 12px 16px;
  border-radius: 6px;
  color: ${props => props.active ? '#22c55e' : '#e5e5e5'};
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid ${props => props.active ? '#22c55e' : '#333'};
  user-select: none;

  &:hover {
    background: ${props => props.active ? '#22c55e30' : '#252540'};
    border-color: #555;
  }
`;

function TestComponent() {
  const [active, setActive] = useState(false);

  return (
    <div>
      <StyledBox active={active} onClick={() => setActive(!active)}>
        {active ? 'Styled & Active!' : 'Hover me, click to toggle'}
      </StyledBox>
      <div style={{ marginTop: '6px', fontSize: '11px', color: '#888' }}>
        Uses styled.div with template literals and hover effects
      </div>
    </div>
  );
}

TestComponent.packageName = '@emotion/styled';
TestComponent.downloads = '9.3M/week';
export default TestComponent;
