#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const command = args[0];

if (command === 'create-contract') {
  const entity = args[1] || 'Item';
  const name = args[2] || `${entity}Manager`;
  const fileName = `${name}.ts`;
  const targetPath = path.resolve(process.cwd(), fileName);

  const template = `import { defineAsyncCrudComponent, z, h, Show, For } from 'tokensafe-ui';

export const ${entity}Schema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(['Active', 'Completed']).default('Active'),
  priority: z.enum(['High', 'Medium', 'Low']).default('Medium'),
  tags: z.array(z.string()).default([]),
  updatedAt: z.number().optional(),
});

export const ${name} = defineAsyncCrudComponent({
  id: '${entity.toLowerCase()}-manager',
  entityName: '${entity.toLowerCase()}',
  itemSchema: ${entity}Schema,
  initialItems: [],
  render: ({ state, emit }) => {
    return h(
      'div',
      { class: '${entity.toLowerCase()}-manager', 'data-agent-id': '${entity.toLowerCase()}-manager:root' },
      h('header', null, h('h1', null, '${entity} Manager')),
      h(Show, {
        when: () => Boolean(state.errorMessage),
        children: () => h('div', { role: 'alert', class: 'error-banner' }, () => state.errorMessage || ''),
      }),
      h('ul', { class: 'item-list' },
        h(For, {
          each: () => state.items,
          key: 'id',
          children: (item) => h('li', { class: 'item-row' }, item.title),
        })
      )
    );
  },
});
`;

  fs.writeFileSync(targetPath, template, 'utf-8');
  console.log(`✓ Created contract component: ${fileName}`);
} else if (command === 'mcp' || !command) {
  import('./mcp.js');
} else {
  console.log(`TokenSafe UI CLI\nUsage:\n  tokensafe-ui mcp\n  tokensafe-ui create-contract [Entity] [Name]\n`);
}
