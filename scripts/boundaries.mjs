import { builtinModules } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { parse } from '@vue/compiler-sfc';

const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, '')));

// Paths are relative to the workspace root and normalized to forward slashes.
export function checkSource(file, text) {
  if (file.endsWith('.vue')) {
    const { descriptor, errors } = parse(text, { filename: file });
    const problems = errors.map((error) => 'invalid Vue component: ' + error);
    for (const block of [descriptor.script, descriptor.scriptSetup]) {
      if (!block) continue;
      if (block.src || (block.lang && !['js', 'jsx', 'ts', 'tsx'].includes(block.lang))) {
        problems.push('external or unsupported Vue script is not allowed');
      } else {
        problems.push(...checkSource(file + (block.lang?.endsWith('x') ? '.tsx' : '.ts'), block.content));
      }
    }
    if (descriptor.template?.src || /\b(?:import|require)\s*\(/.test(descriptor.template?.content ?? '')) {
      problems.push('external templates and module loading in templates are not allowed');
    }
    return problems;
  }
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const isPackage = file.startsWith('packages/');
  const isBrowser = (isPackage && !file.startsWith('packages/server/')) ||
    (file.startsWith('apps/web/') &&
    !file.startsWith('apps/web/server/') && !file.startsWith('apps/web/src/server/'));
  const problems = [];

  function check(specifier) {
    if (!isBrowser && !isPackage) return;
    if (specifier === null) {
      problems.push('dynamic module specifiers are not allowed in browser code or package cores');
      return;
    }
    const clean = specifier.replace(/^node:/, '');
    const target = specifier.startsWith('.')
      ? path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier))
      : specifier;
    if (isBrowser && (specifier.startsWith('node:') || builtins.has(clean) ||
        specifier.startsWith('file:') || specifier.startsWith('/') ||
        target === 'packages/server' || target.startsWith('packages/server/') ||
        target === 'apps/worker' || target.startsWith('apps/worker/') ||
        target === 'apps/web/server' || target.startsWith('apps/web/server/') ||
        target === 'apps/web/src/server' || target.startsWith('apps/web/src/server/') ||
        /^@idea-map\/(server|worker)(\/|$)/.test(specifier) ||
        /^(@idea-map\/web\/server|~\/server|@\/server)(\/|$)/.test(specifier))) {
      problems.push('server-only import: ' + specifier);
    }
    if (isPackage && (target === 'apps' || target.startsWith('apps/') ||
        /^@idea-map\/(web|worker)(\/|$)/.test(specifier))) {
      problems.push('package core imports an application: ' + specifier);
    }
    if (specifier.startsWith('#')) {
      problems.push('unresolved import alias is not allowed: ' + specifier);
    }
  }

  function visit(node) {
    let moduleNode;
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      moduleNode = node.moduleSpecifier;
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      moduleNode = node.argument.literal;
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      moduleNode = node.moduleReference.expression;
    } else if (ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
       (ts.isIdentifier(node.expression) && node.expression.text === 'require') ||
       (ts.isPropertyAccessExpression(node.expression) &&
        ((node.expression.expression.getText(source) === 'require' && node.expression.name.text === 'resolve') ||
         (node.expression.expression.getText(source) === 'module' && node.expression.name.text === 'require'))))) {
      moduleNode = node.arguments[0];
      if (!moduleNode) check(null);
    }
    if (moduleNode) check(ts.isStringLiteralLike(moduleNode) ? moduleNode.text : null);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return problems;
}
