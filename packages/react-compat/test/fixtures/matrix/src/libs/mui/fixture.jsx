import { useState } from 'react';
import {
  Autocomplete, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormControlLabel,
  InputLabel, MenuItem, Select, Snackbar, Tab, Tabs, TextField, Tooltip,
} from '@mui/material';
import { ThemeProvider, createTheme, styled } from '@mui/material/styles';

const theme = createTheme({ palette: { primary: { main: '#9c27b0' } } });
const Tag = styled('span')(({ theme: t }) => ({ color: t.palette.primary.main, padding: t.spacing(1) }));

export default function Fixture() {
  const [count, setCount] = useState(0);
  const [name, setName] = useState('');
  const [plan, setPlan] = useState('free');
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [agree, setAgree] = useState(false);
  const [person, setPerson] = useState(null);
  const [tab, setTab] = useState(0);
  const [snack, setSnack] = useState(false);
  return (
    <ThemeProvider theme={theme}>
      <Button id="mu-btn" variant="contained" onClick={() => setCount(count + 1)}>Clicked {count}</Button>
      <Tag id="mu-tag">styled</Tag>

      <TextField id="mu-text" label="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <span id="mu-echo">{name}</span>

      <FormControl sx={{ minWidth: 160 }}>
        <InputLabel id="mu-plan-label">Plan</InputLabel>
        <Select labelId="mu-plan-label" id="mu-plan" value={plan} label="Plan" onChange={(e) => setPlan(e.target.value)}>
          <MenuItem value="free">Free</MenuItem>
          <MenuItem value="pro">Pro</MenuItem>
          <MenuItem value="team">Team</MenuItem>
        </Select>
      </FormControl>
      <span id="mu-plan-value">{plan}</span>

      <Button id="mu-open" onClick={() => setOpen(true)}>Open dialog</Button>
      <Dialog open={open} onClose={() => setOpen(false)}>
        <DialogTitle>Add a note</DialogTitle>
        <DialogContent>
          <TextField id="mu-note" autoFocus label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
          <FormControl sx={{ minWidth: 160 }}>
            <InputLabel id="mu-in-label">Inner</InputLabel>
            <Select labelId="mu-in-label" id="mu-inner" value={plan} label="Inner" onChange={(e) => setPlan(e.target.value)}>
              <MenuItem value="free">Free</MenuItem>
              <MenuItem value="pro">Pro</MenuItem>
              <MenuItem value="team">Team</MenuItem>
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button id="mu-close" onClick={() => setOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
      <span id="mu-note-echo">{note}</span>

      <FormControlLabel control={<Checkbox id="mu-check" checked={agree} onChange={(e) => setAgree(e.target.checked)} />} label="Agree" />
      <span id="mu-agree">{String(agree)}</span>

      <Autocomplete
        id="mu-auto"
        options={['Ada', 'Grace', 'Linus']}
        value={person}
        onChange={(_e, value) => setPerson(value)}
        renderInput={(params) => <TextField {...params} label="Person" />}
        sx={{ width: 220 }}
      />
      <span id="mu-person">{String(person)}</span>

      <Tabs value={tab} onChange={(_e, value) => setTab(value)}>
        <Tab id="mu-tab-0" label="One" />
        <Tab id="mu-tab-1" label="Two" />
      </Tabs>
      <div id="mu-panel">panel {tab}</div>

      <Tooltip title="Helpful" enterDelay={0}>
        <Button id="mu-tip">Hover</Button>
      </Tooltip>

      <Button id="mu-snack" onClick={() => setSnack(true)}>Notify</Button>
      <Snackbar open={snack} autoHideDuration={700} onClose={() => setSnack(false)} message="Saved!" />
    </ThemeProvider>
  );
}
