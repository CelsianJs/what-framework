import type { HookHandler } from '@thenjs/server';

export const requireAuth: HookHandler = async (request, reply) => {
  const token = request.headers.get('authorization');
  if (!token) {
    return reply.status(401).json({ error: 'Authentication required' });
  }
};
