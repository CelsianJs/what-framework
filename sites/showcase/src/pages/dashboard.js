// Dashboard — showcases: signals, computed, spring animation, useSWR, skeleton, Show/For, effect
import {
  h, useState, useEffect, useMemo, useRef,
  signal, computed, effect, batch,
  spring, tween, easings,
  useSWR,
  Skeleton, SkeletonText,
  announce,
} from '@what/core';
import { useAppStore } from '../app.js';
import { fetchStats, fetchActivity, CHART_DATA } from '../data.js';

// ─── Animated Number ───
function AnimatedNumber({ value, prefix = '', suffix = '' }) {
  const ref = useRef(null);
  if (!ref.current) {
    ref.current = spring(0, { stiffness: 80, damping: 18 });
  }
  const displayed = ref.current;

  useEffect(() => {
    displayed.set(value);
  }, [value]);

  return h('span', null,
    prefix,
    Math.round(displayed.current()),
    suffix,
  );
}

// ─── Stat Card ───
function StatCard({ label, value, change, direction, color, delay = 0 }) {
  return h('div', {
    class: `stat-card fade-up fade-up-${delay}`,
    style: `--stat-color: ${color}`,
  },
    h('div', { class: 'stat-label' }, label),
    h('div', { class: 'stat-value' },
      h(AnimatedNumber, { value }),
    ),
    change != null
      ? h('div', { class: `stat-change ${direction}` },
          direction === 'up' ? '↑' : '↓',
          `${change}%`,
        )
      : null,
  );
}

// ─── Bar Chart ───
function BarChart() {
  const [period, setPeriod] = useState('week');
  const chartData = CHART_DATA[period] || [];
  const max = Math.max(...chartData.map(d => d.value), 1);

  return h('div', { class: 'chart-container' },
    h('div', { class: 'chart-header' },
      h('span', { class: 'chart-title' }, 'Tasks Completed'),
      h('div', { class: 'chart-tabs' },
        ...['week', 'month', 'quarter'].map(p =>
          h('button', {
            class: `chart-tab${period === p ? ' active' : ''}`,
            onClick: () => setPeriod(p),
          }, p.charAt(0).toUpperCase() + p.slice(1)),
        ),
      ),
    ),
    h('div', { class: 'chart-bars' },
      ...chartData.map(d =>
        h('div', { class: 'chart-bar-col', key: d.label },
          h('div', {
            class: 'chart-bar',
            style: `height: ${(d.value / max) * 100}%`,
            title: `${d.label}: ${d.value}`,
          }),
          h('span', { class: 'chart-bar-label' }, d.label),
        ),
      ),
    ),
  );
}

// ─── Activity Feed ───
function ActivityFeed() {
  const { data, isLoading, mutate } = useSWR('activity', fetchActivity, {
    revalidateOnFocus: false,
  });

  const loading = isLoading();
  const activityData = data();
  const hasData = activityData && !loading;

  return h('div', { class: 'card' },
    h('div', { class: 'card-header' },
      h('span', { class: 'card-title' }, 'Recent Activity'),
      h('button', {
        class: 'btn btn-ghost btn-sm',
        onClick: () => { mutate(); announce('Activity refreshed'); },
      }, '↻ Refresh'),
    ),
    loading
      ? h('div', { style: 'display: flex; flex-direction: column; gap: 12px;' },
          ...[1,2,3,4].map(() =>
            h('div', { style: 'display: flex; gap: 12px; align-items: center;' },
              h('div', { class: 'skeleton', style: 'width: 8px; height: 8px; border-radius: 50%;' }),
              h('div', { style: 'flex: 1; display: flex; flex-direction: column; gap: 4px;' },
                h('div', { class: 'skeleton', style: 'width: 70%; height: 14px;' }),
              ),
              h('div', { class: 'skeleton', style: 'width: 50px; height: 14px;' }),
            )
          ),
        )
      : null,
    hasData
      ? h('ul', { class: 'activity-list' },
          ...(activityData || []).map(item =>
            h('li', { class: 'activity-item', key: item.id },
              h('div', { class: `activity-dot ${item.color}` }),
              h('div', { class: 'activity-text' },
                h('strong', null, item.user),
                ` ${item.action} `,
                h('strong', null, item.target),
                item.extra ? ` ${item.extra}` : '',
              ),
              h('span', { class: 'activity-time' }, item.time),
            )
          ),
        )
      : null,
  );
}

// ─── Quick Stats with Spring ───
function QuickStats() {
  const { data, isLoading } = useSWR('stats', fetchStats, {
    revalidateOnFocus: false,
  });

  const loading = isLoading();
  const statsData = data();
  const hasData = statsData && !loading;

  return h('div', { class: 'stat-grid' },
    loading
      ? [
          ...[1,2,3,4].map(i =>
            h('div', { class: 'stat-card' },
              h('div', { class: 'skeleton', style: 'width: 80px; height: 12px; margin-bottom: 8px;' }),
              h('div', { class: 'skeleton', style: 'width: 60px; height: 28px; margin-bottom: 4px;' }),
              h('div', { class: 'skeleton', style: 'width: 48px; height: 18px;' }),
            )
          ),
        ]
      : null,
    hasData
      ? [
          h(StatCard, { label: 'Tasks Completed', value: statsData?.tasksCompleted || 0, change: 12, direction: 'up', color: 'var(--accent)', delay: 1 }),
          h(StatCard, { label: 'Active Projects', value: statsData?.activeProjects || 0, change: 8, direction: 'up', color: 'var(--info)', delay: 2 }),
          h(StatCard, { label: 'Team Members', value: statsData?.teamMembers || 0, change: null, color: 'var(--success)', delay: 3 }),
          h(StatCard, { label: 'Sprint Velocity', value: statsData?.velocity || 0, change: 3, direction: 'down', color: 'var(--warning)', delay: 4 }),
        ]
      : null,
  );
}

// ─── Live Clock (shows fine-grained reactivity) ───
function LiveClock() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatted = useMemo(() => {
    return time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }, [time]);

  return h('span', { class: 'font-mono text-muted text-sm' }, formatted);
}

// ─── Dashboard Page ───
export function Dashboard() {
  const store = useAppStore();

  return h('div', null,
    // Welcome
    h('div', { class: 'flex items-center justify-between mb-6' },
      h('div', null,
        h('p', { class: 'text-secondary text-sm' }, 'Welcome back, Elena'),
      ),
      h(LiveClock),
    ),

    // Stats
    h(QuickStats),

    // Chart + Activity
    h('div', { class: 'two-col' },
      h(BarChart),
      h(ActivityFeed),
    ),
  );
}
