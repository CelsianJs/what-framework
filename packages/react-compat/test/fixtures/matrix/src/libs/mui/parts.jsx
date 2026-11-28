/** @jsxImportSource react */
// A component made by calling a library (`styled(...)`) is React code only in
// a React file: native.jsx imports it from here.
import { styled } from '@mui/material/styles';

export const Tag = styled('span')(({ theme }) => ({ color: theme.palette.primary.main, padding: theme.spacing(1) }));
