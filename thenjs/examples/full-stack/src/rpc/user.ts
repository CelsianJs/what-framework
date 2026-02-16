import { procedure, router } from '@thenjs/rpc';
import { z } from 'zod';

const users = [
  { id: '1', name: 'Alice', email: 'alice@example.com', createdAt: new Date() },
  { id: '2', name: 'Bob', email: 'bob@example.com', createdAt: new Date() },
];

export const userRouter = router({
  list: procedure
    .query(async () => {
      return users;
    }),

  getById: procedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      return users.find(u => u.id === input.id) ?? null;
    }),

  create: procedure
    .input(z.object({ name: z.string(), email: z.string().email() }))
    .mutation(async ({ input }) => {
      const user = { id: String(users.length + 1), ...input, createdAt: new Date() };
      users.push(user);
      return user;
    }),
});
