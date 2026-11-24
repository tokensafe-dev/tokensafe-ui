import fs from 'node:fs';
import path from 'node:path';
import * as parser from '@babel/parser';

export interface StaticDiscoveredComponent {
  id: string; // e.g. "frontend.component:CheckoutButton"
  name: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  propsInterface?: string;
  actionTriggers: string[];
  isDefaultExport: boolean;
}

export interface StaticDiscoveredRoute {
  id: string; // e.g. "frontend.route:/checkout"
  path: string;
  componentName?: string;
  filePath: string;
}

export interface StaticDiscoveryResult {
  components: StaticDiscoveredComponent[];
  routes: StaticDiscoveredRoute[];
  totalScannedFiles: number;
}

/**
 * Statically analyzes TSX/JSX source files to discover React components and routes
 * without running the code or requiring a headless DOM environment (Level 1 OUMV).
 */
export function scanSourceForComponents(source: string, filePath: string): StaticDiscoveredComponent[] {
  const components: StaticDiscoveredComponent[] = [];

  try {
    const ast = parser.parse(source, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });

    const isPascalCase = (name: string) => /^[A-Z][a-zA-Z0-9_]*$/.test(name);

    for (const node of ast.program.body) {
      // 1. Function declarations: function MyComponent(props) { ... }
      if (node.type === 'FunctionDeclaration' && node.id && isPascalCase(node.id.name)) {
        const name = node.id.name;
        components.push({
          id: `frontend.component:${name}`,
          name,
          filePath,
          lineStart: node.loc?.start.line ?? 1,
          lineEnd: node.loc?.end.line ?? 1,
          actionTriggers: extractActionTriggersFromNode(node),
          isDefaultExport: false,
        });
      }

      // 2. Export named declarations: export function MyComponent() {} or export const MyComponent = () => {}
      if (node.type === 'ExportNamedDeclaration' && node.declaration) {
        if (node.declaration.type === 'FunctionDeclaration' && node.declaration.id && isPascalCase(node.declaration.id.name)) {
          const name = node.declaration.id.name;
          components.push({
            id: `frontend.component:${name}`,
            name,
            filePath,
            lineStart: node.loc?.start.line ?? 1,
            lineEnd: node.loc?.end.line ?? 1,
            actionTriggers: extractActionTriggersFromNode(node.declaration),
            isDefaultExport: false,
          });
        } else if (node.declaration.type === 'VariableDeclaration') {
          for (const decl of node.declaration.declarations) {
            if (decl.id.type === 'Identifier' && isPascalCase(decl.id.name)) {
              const name = decl.id.name;
              components.push({
                id: `frontend.component:${name}`,
                name,
                filePath,
                lineStart: node.loc?.start.line ?? 1,
                lineEnd: node.loc?.end.line ?? 1,
                actionTriggers: decl.init ? extractActionTriggersFromNode(decl.init) : [],
                isDefaultExport: false,
              });
            }
          }
        }
      }

      // 3. Export default declaration
      if (node.type === 'ExportDefaultDeclaration') {
        let name = 'DefaultExport';
        if (node.declaration.type === 'FunctionDeclaration' && node.declaration.id) {
          name = node.declaration.id.name;
        } else if (node.declaration.type === 'Identifier') {
          name = node.declaration.name;
        } else {
          // Derive from filename
          const basename = path.basename(filePath, path.extname(filePath));
          if (isPascalCase(basename)) {
            name = basename;
          }
        }

        components.push({
          id: `frontend.component:${name}`,
          name,
          filePath,
          lineStart: node.loc?.start.line ?? 1,
          lineEnd: node.loc?.end.line ?? 1,
          actionTriggers: extractActionTriggersFromNode(node.declaration),
          isDefaultExport: true,
        });
      }
    }
  } catch {
    // If syntax error or unparseable, skip file gracefully
  }

  return components;
}

function extractActionTriggersFromNode(node: any): string[] {
  const triggers = new Set<string>();
  const str = JSON.stringify(node);

  const eventRegex = /"(onClick|onSubmit|onChange|onInput|onKeyDown|onBlur)"/g;
  let match;
  while ((match = eventRegex.exec(str)) !== null) {
    triggers.add(match[1]);
  }

  return Array.from(triggers);
}

/**
 * Recursively scans a workspace directory for React/Vue components and routes.
 */
export function scanProjectStaticResources(projectRoot: string): StaticDiscoveryResult {
  const components: StaticDiscoveredComponent[] = [];
  const routes: StaticDiscoveredRoute[] = [];
  let totalFiles = 0;

  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && /\.(tsx|jsx|ts|js)$/.test(entry.name)) {
        totalFiles++;
        const relPath = path.relative(projectRoot, fullPath);
        const source = fs.readFileSync(fullPath, 'utf-8');
        const found = scanSourceForComponents(source, relPath);
        components.push(...found);

        // Next.js App router file route convention
        if (relPath.includes('app/') && relPath.endsWith('page.tsx')) {
          const routeSegment = relPath.replace(/^.*app\//, '').replace(/\/page\.tsx$/, '');
          routes.push({
            id: `frontend.route:/${routeSegment}`,
            path: `/${routeSegment}`,
            filePath: relPath,
          });
        }
      }
    }
  }

  walk(projectRoot);
  return { components, routes, totalScannedFiles: totalFiles };
}
