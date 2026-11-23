import { defineComponent, z, h } from 'tokensafe-ui';
export const OrderItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  price: z.number().positive(),
  category: z.enum(['electronics', 'books', 'apparel']),
  quantity: z.number().int().min(1)
});
export type OrderItem = z.infer<typeof OrderItemSchema>;
export const OrderCheckout = defineComponent({
  id: 'order-checkout',
  filePath: 'src/OrderCheckout.tsx',
  state: {
    items: z.array(OrderItemSchema).default([{
      id: 'item-1',
      name: 'Mechanical Keyboard',
      price: 120,
      category: 'electronics',
      quantity: 1
    }, {
      id: 'item-2',
      name: 'Clean Code Book',
      price: 40,
      category: 'books',
      quantity: 2
    }, {
      id: 'item-3',
      name: 'Developer Hoodie',
      price: 60,
      category: 'apparel',
      quantity: 1
    }]),
    filterCategory: z.enum(['all', 'electronics', 'books', 'apparel']).default('all'),
    couponInput: z.string().default(''),
    appliedCoupon: z.string().nullable().default(null),
    discountPercent: z.number().min(0).max(100).default(0),
    discountAmount: z.number().min(0).default(0),
    shippingFee: z.number().default(15),
    subtotal: z.number().default(260),
    total: z.number().default(275),
    couponStatus: z.enum(['idle', 'validating', 'applied', 'error']).default('idle'),
    errorMessage: z.string().default(''),
    orderStatus: z.enum(['cart', 'submitting', 'confirmed']).default('cart')
  },
  actions: {
    setFilter: (s, {
      category
    }: {
      category: 'all' | 'electronics' | 'books' | 'apparel';
    }) => ({
      ...s,
      filterCategory: category
    }),
    updateQuantity: (s, {
      id,
      delta
    }: {
      id: string;
      delta: number;
    }) => {
      const updated = s.items.map(it => it.id === id ? {
        ...it,
        quantity: Math.max(1, it.quantity + delta)
      } : it).filter(it => it.quantity > 0);
      const subtotal = updated.reduce((sum, it) => sum + it.price * it.quantity, 0);
      const discountAmount = Math.round(subtotal * s.discountPercent / 100);
      const total = Math.max(0, subtotal - discountAmount + s.shippingFee);
      return {
        ...s,
        items: updated,
        subtotal,
        discountAmount,
        total
      };
    },
    setCouponInput: (s, {
      code
    }: {
      code: string;
    }) => ({
      ...s,
      couponInput: code
    }),
    setCouponStatus: (s, {
      status,
      message = ''
    }: {
      status: 'idle' | 'validating' | 'applied' | 'error';
      message?: string;
    }) => ({
      ...s,
      couponStatus: status,
      errorMessage: message
    }),
    submitOrder: s => {
      if (s.items.length === 0) {
        throw new Error('Cannot submit order with empty cart');
      }
      return {
        ...s,
        orderStatus: 'confirmed' as const
      };
    },
    applyDiscount: (s, {
      code,
      percent
    }) => {
      const discountAmount = Math.round(s.subtotal * percent / 100);
      const total = Math.max(0, s.subtotal - discountAmount + s.shippingFee);
      return {
        ...s,
        appliedCoupon: code,
        discountPercent: percent,
        discountAmount,
        total,
        couponStatus: "applied",
        errorMessage: ""
      };
    }
  },
  effects: {
    lookupCoupon: {
      concurrency: 'latest-wins',
      handler: async (ctx, code: string) => {
        ctx.dispatch('setCouponStatus', {
          status: 'validating'
        });

        // Simulate async network latency
        await new Promise(resolve => setTimeout(resolve, 30));
        if (ctx.signal.aborted) return;
        const COUPONS: Record<string, number> = {
          SAVE10: 10,
          SAVE20: 20,
          VIP50: 50
        };
        const cleanCode = (code || '').trim().toUpperCase();
        const percent = COUPONS[cleanCode];
        if (percent !== undefined) {
          ctx.dispatch('applyDiscount', {
            code: cleanCode,
            percent
          });
        } else {
          ctx.dispatch('setCouponStatus', {
            status: 'error',
            message: `Invalid coupon: '${code}'`
          });
        }
      }
    }
  },
  render: ({
    state,
    emit
  }) => h('div', {
    class: 'order-checkout',
    'data-agent-id': 'order-checkout:root'
  }, h('h2', {
    'data-agent-id': 'order-checkout:title'
  }, 'Checkout Order'),
  // Category Filter
  h('div', {
    class: 'filter-bar',
    'data-agent-id': 'order-checkout:filter-bar'
  }, h('span', null, 'Filter: '), h('button', {
    'data-agent-id': 'order-checkout:filter-all',
    'data-agent-action': 'setFilter',
    onClick: () => emit.setFilter({
      category: 'all'
    })
  }, 'All'), h('button', {
    'data-agent-id': 'order-checkout:filter-electronics',
    'data-agent-action': 'setFilter',
    onClick: () => emit.setFilter({
      category: 'electronics'
    })
  }, 'Electronics'), h('button', {
    'data-agent-id': 'order-checkout:filter-books',
    'data-agent-action': 'setFilter',
    onClick: () => emit.setFilter({
      category: 'books'
    })
  }, 'Books')),
  // Items list
  h('ul', {
    class: 'items-list',
    'data-agent-id': 'order-checkout:items-list'
  }, ...state.items.filter(it => state.filterCategory === 'all' || it.category === state.filterCategory).map(it => h('li', {
    key: it.id,
    'data-agent-id': `order-checkout:item-${it.id}`
  }, h('span', {
    class: 'item-name'
  }, it.name), h('span', {
    class: 'item-price'
  }, ` $${it.price} x ${it.quantity}`), h('button', {
    'data-agent-id': `order-checkout:inc-${it.id}`,
    'data-agent-action': 'updateQuantity',
    onClick: () => emit.updateQuantity({
      id: it.id,
      delta: 1
    })
  }, '+'), h('button', {
    'data-agent-id': `order-checkout:dec-${it.id}`,
    'data-agent-action': 'updateQuantity',
    onClick: () => emit.updateQuantity({
      id: it.id,
      delta: -1
    })
  }, '-')))),
  // Coupon section
  h('div', {
    class: 'coupon-section',
    'data-agent-id': 'order-checkout:coupon-section'
  }, h('input', {
    'data-agent-id': 'order-checkout:coupon-input',
    placeholder: 'Enter coupon (e.g. SAVE20)',
    value: state.couponInput,
    onInput: (e: any) => emit.setCouponInput({
      code: e.target.value
    })
  }), h('button', {
    'data-agent-id': 'order-checkout:btn-apply-coupon',
    'data-agent-action': 'lookupCoupon',
    onClick: () => emit.lookupCoupon(state.couponInput)
  }, 'Apply Coupon'), h('span', {
    'data-agent-id': 'order-checkout:coupon-status'
  }, () => state.couponStatus)),
  // Order Summary
  h('div', {
    class: 'order-summary',
    'data-agent-id': 'order-checkout:summary'
  }, h('div', null, 'Subtotal: $', () => state.subtotal), h('div', null, 'Discount: -$', () => state.discountAmount), h('div', null, 'Shipping: $', () => state.shippingFee), h('div', {
    class: 'total',
    'data-agent-id': 'order-checkout:total'
  }, 'Total: $', () => state.total)),
  // Submit
  h('button', {
    class: 'btn-submit',
    'data-agent-id': 'order-checkout:btn-submit',
    'data-agent-action': 'submitOrder',
    onClick: emit.submitOrder
  }, 'Place Order'), h('div', {
    'data-agent-id': 'order-checkout:order-status'
  }, () => state.orderStatus))
});