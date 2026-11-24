// fixture.jsx as a native What file: signals for state, MUI tags as islands.
import { signal } from 'what-framework';
import {
  Autocomplete, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormControlLabel,
  InputLabel, MenuItem, Select, Snackbar, Tab, Tabs, TextField, Tooltip,
} from '@mui/material';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { Tag } from './parts.jsx';

const theme = createTheme({ palette: { primary: { main: '#9c27b0' } } });

export default function Native() {
  const count = signal(0);
  const name = signal('');
  const plan = signal('free');
  const open = signal(false);
  const note = signal('');
  const agree = signal(false);
  const person = signal(null);
  const tab = signal(0);
  const snack = signal(false);
  return (
    <div>
      <ThemeProvider theme={theme}>
        <Button id="mu-btn" variant="contained" onClick={() => count(count() + 1)}>Clicked {count()}</Button>
        <Tag id="mu-tag">styled</Tag>

        <TextField id="mu-text" label="Name" value={name()} onChange={(e) => name(e.target.value)} />

        <FormControl sx={{ minWidth: 160 }}>
          <InputLabel id="mu-plan-label">Plan</InputLabel>
          <Select labelId="mu-plan-label" id="mu-plan" value={plan()} label="Plan" onChange={(e) => plan(e.target.value)}>
            <MenuItem value="free">Free</MenuItem>
            <MenuItem value="pro">Pro</MenuItem>
            <MenuItem value="team">Team</MenuItem>
          </Select>
        </FormControl>

        <Button id="mu-open" onClick={() => open(true)}>Open dialog</Button>
        <Dialog open={open()} onClose={() => open(false)}>
          <DialogTitle>Add a note</DialogTitle>
          <DialogContent>
            <TextField id="mu-note" autoFocus label="Note" value={note()} onChange={(e) => note(e.target.value)} />
            <FormControl sx={{ minWidth: 160 }}>
              <InputLabel id="mu-in-label">Inner</InputLabel>
              <Select labelId="mu-in-label" id="mu-inner" value={plan()} label="Inner" onChange={(e) => plan(e.target.value)}>
                <MenuItem value="free">Free</MenuItem>
                <MenuItem value="pro">Pro</MenuItem>
                <MenuItem value="team">Team</MenuItem>
              </Select>
            </FormControl>
          </DialogContent>
          <DialogActions>
            <Button id="mu-close" onClick={() => open(false)}>Close</Button>
          </DialogActions>
        </Dialog>

        <FormControlLabel control={<Checkbox id="mu-check" checked={agree()} onChange={(e) => agree(e.target.checked)} />} label="Agree" />

        <Autocomplete
          id="mu-auto"
          options={['Ada', 'Grace', 'Linus']}
          value={person()}
          onChange={(_e, value) => person(value)}
          renderInput={(params) => <TextField {...params} label="Person" />}
          sx={{ width: 220 }}
        />

        <Tabs value={tab()} onChange={(_e, value) => tab(value)}>
          <Tab id="mu-tab-0" label="One" />
          <Tab id="mu-tab-1" label="Two" />
        </Tabs>

        <Tooltip title="Helpful" enterDelay={0}>
          <Button id="mu-tip">Hover</Button>
        </Tooltip>

        <Button id="mu-snack" onClick={() => snack(true)}>Notify</Button>
        <Snackbar open={snack()} autoHideDuration={700} onClose={() => snack(false)} message="Saved!" />
      </ThemeProvider>
      <span id="mu-echo">{name()}</span>
      <span id="mu-plan-value">{plan()}</span>
      <span id="mu-note-echo">{note()}</span>
      <span id="mu-agree">{String(agree())}</span>
      <span id="mu-person">{String(person())}</span>
      <div id="mu-panel">panel {tab()}</div>
    </div>
  );
}
