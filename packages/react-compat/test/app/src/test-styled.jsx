import styled, { ThemeProvider, keyframes, css } from 'styled-components';

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
`;

const Button = styled.button`
  padding: 8px 16px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  font-weight: 600;
  background: ${props => props.theme.primary};
  color: white;
  &:hover { opacity: 0.9; }
  ${props => props.pulsing && css`animation: ${pulse} 2s infinite;`}
`;

const Badge = styled.span`
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  background: ${props => props.theme.primary}20;
  color: ${props => props.theme.primary};
`;

const theme = { primary: '#3b82f6' };

export function StyledTest() {
  return (
    <ThemeProvider theme={theme}>
      <div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <Button>Normal</Button>
          <Button pulsing>Pulsing</Button>
          <Badge>Status: Active</Badge>
        </div>
        <p style={{ color: 'green', marginTop: '8px' }}>styled-components with ThemeProvider, keyframes, and css helper</p>
      </div>
    </ThemeProvider>
  );
}
