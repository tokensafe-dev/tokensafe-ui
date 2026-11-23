import { describe, it, expect, vi } from 'vitest';
import { useState, useRef, useMemo, useEffect, h, mount } from '../src/index.js';

describe('Reactive Functional Component Hooks', () => {
  it('useState preserves signal state and re-renders component on state update', () => {
    let updateFn: any;
    let renderCount = 0;

    function Counter() {
      renderCount++;
      const [count, setCount] = useState(10);
      updateFn = setCount;
      return h('div', { id: 'count-val' }, `Count: ${count}`);
    }

    const container = document.createElement('div');
    mount(h(Counter, null), container);

    expect(container.querySelector('#count-val')?.textContent).toBe('Count: 10');
    expect(renderCount).toBe(1);

    // Trigger state update
    updateFn(25);
    expect(container.querySelector('#count-val')?.textContent).toBe('Count: 25');
    expect(renderCount).toBe(2);

    // Functional state update
    updateFn((c: number) => c + 5);
    expect(container.querySelector('#count-val')?.textContent).toBe('Count: 30');
    expect(renderCount).toBe(3);
  });

  it('useRef preserves stable mutable reference', () => {
    let refInstance: any;

    function RefComponent() {
      const myRef = useRef({ initialized: true });
      refInstance = myRef;
      const [step, setStep] = useState(1);
      (RefComponent as any).setStep = setStep;
      return h('span', null, `Step: ${step}`);
    }

    const container = document.createElement('div');
    mount(h(RefComponent, null), container);

    const firstRef = refInstance;
    expect(firstRef.current.initialized).toBe(true);

    (RefComponent as any).setStep(2);
    expect(refInstance).toBe(firstRef);
  });

  it('useEffect executes and flushes properly', () => {
    const effectSpy = vi.fn();

    function EffectComponent() {
      useEffect(() => {
        effectSpy();
      }, []);
      return h('div', null, 'Content');
    }

    const container = document.createElement('div');
    mount(h(EffectComponent, null), container);

    expect(effectSpy).toHaveBeenCalledTimes(1);
  });
});
