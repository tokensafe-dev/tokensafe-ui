import { describe, expect, it, beforeEach } from 'vitest';
import {
  defineOUMVComponent,
  getOUMVComponentContract,
  listOUMVComponentContracts,
  resetOUMVComponentContracts,
} from '../src/contracts.js';

/**
 * Level 3 semantic component contracts (OUMV spec §6.4/§10.4).
 * Verify that contracts register with contract provenance, work for retrofit
 * React/Vue components, and never alter the wrapped component.
 */

describe('defineOUMVComponent', () => {
  beforeEach(() => resetOUMVComponentContracts());

  it('registers a contract with contract provenance', () => {
    const CheckoutForm = function CheckoutForm() {
      return null;
    };

    const returned = defineOUMVComponent(CheckoutForm, {
      description: 'Checkout form',
      actions: { submit: { description: 'Submit the current order' } },
      constraints: ['A cart must contain at least one item'],
    });

    // Non-invasive: the exact same component is returned
    expect(returned).toBe(CheckoutForm);

    const record = getOUMVComponentContract(CheckoutForm);
    expect(record?.description).toBe('Checkout form');
    expect(record?.constraints).toEqual(['A cart must contain at least one item']);
    expect(record?.actions?.submit.description).toBe('Submit the current order');
    // Evidence metadata: explicitly declared = contract provenance, confirmed
    expect(record?.evidence.provenance).toBe('contract');
    expect(record?.evidence.confidence).toBe('confirmed');
    expect(record?.evidence.sourceAdapter).toBe('tokensafe-ui-contracts');
  });

  it('supports Vue-style options objects and string ids', () => {
    const vueComponent = { name: 'OrderList', render() {} };
    defineOUMVComponent(vueComponent, { description: 'Order list' });
    expect(getOUMVComponentContract('OrderList')?.description).toBe('Order list');

    defineOUMVComponent('cart-widget', { description: 'Cart widget' });
    expect(getOUMVComponentContract('cart-widget')?.description).toBe('Cart widget');
  });

  it('lists all declared contracts', () => {
    defineOUMVComponent('a', { description: 'A' });
    defineOUMVComponent('b', { description: 'B' });
    const all = listOUMVComponentContracts();
    expect(all).toHaveLength(2);
    expect(all.map((c) => c.componentId).sort()).toEqual(['a', 'b']);
  });

  it('returns undefined for undeclared components (no fabrication)', () => {
    expect(getOUMVComponentContract('never-declared')).toBeUndefined();
  });

  it('registers frozen components by id without throwing', () => {
    const frozen = Object.freeze({ name: 'Frozen' });
    expect(() => defineOUMVComponent(frozen, { description: 'Frozen component' })).not.toThrow();
    expect(getOUMVComponentContract('Frozen')?.description).toBe('Frozen component');
  });
});
