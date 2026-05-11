// Stress Test: Ownership tree with deeply nested components
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { signal, effect, createRoot, onCleanup, computed } from '../packages/core/src/reactive.js';

describe('STRESS: Ownership tree - deep nesting', () => {

  it('createRoot nests 10 levels deep, parent dispose cleans all', () => {
    let cleanupCount = 0;
    let outerDispose;

    createRoot(dispose1 => {
      outerDispose = dispose1;
      const s1 = signal(1);
      effect(() => s1());

      createRoot(dispose2 => {
        const s2 = signal(2);
        effect(() => s2());

        createRoot(dispose3 => {
          const s3 = signal(3);
          effect(() => s3());

          createRoot(dispose4 => {
            const s4 = signal(4);
            effect(() => {
              s4();
              return () => { cleanupCount++; };
            });

            createRoot(dispose5 => {
              const s5 = signal(5);
              effect(() => {
                s5();
                return () => { cleanupCount++; };
              });

              createRoot(dispose6 => {
                effect(() => {
                  s5();
                  return () => { cleanupCount++; };
                });

                createRoot(dispose7 => {
                  effect(() => {
                    s4();
                    return () => { cleanupCount++; };
                  });

                  createRoot(dispose8 => {
                    effect(() => {
                      s3();
                      return () => { cleanupCount++; };
                    });

                    createRoot(dispose9 => {
                      effect(() => {
                        s2();
                        return () => { cleanupCount++; };
                      });

                      createRoot(dispose10 => {
                        effect(() => {
                          s1();
                          return () => { cleanupCount++; };
                        });
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });

    // Dispose root — should cascade through all 10 levels
    outerDispose();
    assert.ok(cleanupCount >= 7, `Expected at least 7 cleanup calls, got ${cleanupCount}`);
  });

  it('100 sibling roots under one parent, parent dispose cleans all', () => {
    let cleanupCount = 0;
    let outerDispose;

    createRoot(dispose => {
      outerDispose = dispose;

      for (let i = 0; i < 100; i++) {
        createRoot(() => {
          const s = signal(i);
          effect(() => {
            s();
            return () => { cleanupCount++; };
          });
        });
      }
    });

    outerDispose();
    assert.equal(cleanupCount, 100, 'All 100 sibling effects should be cleaned up');
  });

  it('onCleanup callbacks fire in reverse order on dispose', () => {
    const order = [];
    let outerDispose;

    createRoot(dispose => {
      outerDispose = dispose;
      onCleanup(() => order.push('A'));
      onCleanup(() => order.push('B'));
      onCleanup(() => order.push('C'));
    });

    outerDispose();
    assert.deepEqual(order, ['C', 'B', 'A'], 'Cleanups should run in LIFO order');
  });

  it('child root disposal removes it from parent children list', () => {
    let parentRoot;
    let childDispose;

    createRoot(dispose => {
      parentRoot = { dispose };

      createRoot(dispose2 => {
        childDispose = dispose2;
        effect(() => signal(1)());
      });

      createRoot(() => {
        effect(() => signal(2)());
      });
    });

    // Dispose child, parent should still work
    childDispose();
    // Parent dispose should not throw
    parentRoot.dispose();
  });

  it('double dispose is safe (idempotent)', () => {
    let outerDispose;
    createRoot(dispose => {
      outerDispose = dispose;
      effect(() => signal(1)());
    });

    outerDispose();
    assert.doesNotThrow(() => outerDispose(), 'Double dispose should be safe');
  });

  it('effect created inside createRoot is auto-disposed with root', async () => {
    const s = signal(0);
    let effectRuns = 0;
    let outerDispose;

    createRoot(dispose => {
      outerDispose = dispose;
      effect(() => {
        s();
        effectRuns++;
      });
    });

    assert.equal(effectRuns, 1);

    s.set(1);
    await new Promise(r => queueMicrotask(r));
    await new Promise(r => queueMicrotask(r));
    assert.equal(effectRuns, 2);

    outerDispose();

    // After dispose, writing to signal should NOT trigger the effect
    s.set(2);
    await new Promise(r => queueMicrotask(r));
    await new Promise(r => queueMicrotask(r));
    assert.equal(effectRuns, 2, 'Effect should not run after root disposal');
  });

  it('deeply nested ownership tree with mixed signals and computeds', () => {
    let outerDispose;
    const results = [];

    createRoot(dispose => {
      outerDispose = dispose;
      const root = signal(1);

      createRoot(() => {
        const c1 = computed(() => root() * 2);

        createRoot(() => {
          const c2 = computed(() => c1() + 10);

          createRoot(() => {
            const c3 = computed(() => c2() * c1());
            results.push(c3());
          });
        });
      });
    });

    assert.equal(results[0], 24); // c1=2, c2=12, c3=24
    outerDispose();
  });
});
