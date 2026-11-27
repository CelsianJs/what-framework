// What context the shell provides to every page.
import { createContext } from 'what-framework';

export const DeskContext = createContext({ desk: 'none', trader: () => 'nobody' });
