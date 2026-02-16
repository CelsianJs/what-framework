// Type-safe RPC — auto-discovered by ThenJS at /_rpc/
// Client can call these with full TypeScript inference

import { z } from 'zod';

const tasks = new Map<string, any>();

// Seed some data
tasks.set('1', { id: '1', title: 'Set up project', status: 'done', priority: 'high' });
tasks.set('2', { id: '2', title: 'Build features', status: 'in-progress', priority: 'high' });

export default {
  tasks: {
    list: {
      type: 'query' as const,
      handler: () => Array.from(tasks.values()),
    },
    stats: {
      type: 'query' as const,
      handler: () => {
        const items = Array.from(tasks.values());
        return {
          total: items.length,
          todo: items.filter((t: any) => t.status === 'todo').length,
          inProgress: items.filter((t: any) => t.status === 'in-progress').length,
          done: items.filter((t: any) => t.status === 'done').length,
        };
      },
    },
    create: {
      type: 'mutation' as const,
      input: z.object({
        title: z.string().min(1),
        priority: z.enum(['low', 'medium', 'high']).default('medium'),
      }),
      handler: ({ input }: { input: { title: string; priority: string } }) => {
        const task = {
          id: crypto.randomUUID(),
          title: input.title,
          status: 'todo',
          priority: input.priority,
        };
        tasks.set(task.id, task);
        return task;
      },
    },
  },
  system: {
    health: {
      type: 'query' as const,
      handler: () => ({
        uptime: process.uptime(),
        memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
        node: process.version,
      }),
    },
  },
};
