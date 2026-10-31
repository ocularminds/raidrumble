import ts from 'typescript';

export interface BoundaryViolation {
  file: string;
  line: number;
  message: string;
}
const writeMethods = new Set(['post', 'patch', 'delete']);
const helpers =
  /^(writeHelix|helixWrite|sendChatMessage|sendShoutout|createCustomReward|updateCustomReward|deleteCustomReward)$/i;

/** Checks authored source for direct writes, import aliases, destructuring and raw Helix fetches. */
export class WriteBoundary {
  inspect(file: string, source: string): BoundaryViolation[] {
    if (
      file.replaceAll('\\', '/').endsWith('/packages/policy/src/executor.ts') ||
      file === 'packages/policy/src/executor.ts'
    )
      return [];
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const aliases = new Map<string, ts.Expression>();
    const clients = new Set<string>();
    const violations: BoundaryViolation[] = [];
    const report = (node: ts.Node, message: string) => {
      violations.push({
        file,
        line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
        message,
      });
    };
    const collect = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer)
        aliases.set(node.name.text, node.initializer);
      if (
        (ts.isVariableDeclaration(node) ||
          ts.isParameter(node) ||
          ts.isPropertyDeclaration(node)) &&
        node.type &&
        node.name &&
        ts.isIdentifier(node.name)
      ) {
        if (/helix/i.test(node.type.getText(ast))) clients.add(node.name.text);
      }
      if (ts.isImportDeclaration(node) && node.importClause && !node.importClause.isTypeOnly) {
        const module = ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : '';
        const bindings = node.importClause.namedBindings;
        if (/twitch|helix/i.test(module) && bindings && ts.isNamedImports(bindings)) {
          for (const binding of bindings.elements) {
            if (binding.isTypeOnly) continue;
            const original = binding.propertyName?.text ?? binding.name.text;
            if (/helix/i.test(original)) clients.add(binding.name.text);
            if (helpers.test(original) || /\/(writes|mutations)(\.|\/|$)/i.test(module))
              report(binding, 'Helix write helpers belong in the policy executor');
          }
        }
      }
      ts.forEachChild(node, collect);
    };
    collect(ast);
    const unwrap = (expr: ts.Expression, seen = new Set<string>()): ts.Expression => {
      if (ts.isParenthesizedExpression(expr)) return unwrap(expr.expression, seen);
      if (ts.isIdentifier(expr) && aliases.has(expr.text) && !seen.has(expr.text)) {
        seen.add(expr.text);
        return unwrap(aliases.get(expr.text)!, seen);
      }
      return expr;
    };
    const isHelix = (expr: ts.Expression): boolean => {
      const resolved = unwrap(expr);
      if (ts.isIdentifier(resolved))
        return /helix/i.test(resolved.text) || clients.has(resolved.text);
      if (ts.isPropertyAccessExpression(resolved))
        return (
          /helix/i.test(resolved.name.text) ||
          clients.has(resolved.name.text) ||
          isHelix(resolved.expression)
        );
      if (ts.isNewExpression(resolved)) return isHelix(resolved.expression);
      return /helix/i.test(resolved.getText(ast));
    };
    const urlText = (expr: ts.Expression): string => {
      const resolved = unwrap(expr);
      if (ts.isStringLiteralLike(resolved)) return resolved.text;
      if (ts.isTemplateExpression(resolved))
        return (
          resolved.head.text +
          resolved.templateSpans
            .map((span) => urlText(span.expression) + span.literal.text)
            .join('')
        );
      if (ts.isBinaryExpression(resolved)) return urlText(resolved.left) + urlText(resolved.right);
      if (ts.isNewExpression(resolved) && resolved.arguments?.[0])
        return urlText(resolved.arguments[0]);
      return '';
    };
    const property = (
      node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
    ): string | undefined => {
      if (ts.isPropertyAccessExpression(node)) return node.name.text;
      return ts.isStringLiteralLike(node.argumentExpression)
        ? node.argumentExpression.text
        : undefined;
    };
    const inspect = (node: ts.Node) => {
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const name = property(node);
        if (name && writeMethods.has(name.toLowerCase()) && isHelix(node.expression))
          report(node, 'Helix writes belong in the policy executor');
      }
      if (
        ts.isVariableDeclaration(node) &&
        ts.isObjectBindingPattern(node.name) &&
        node.initializer &&
        isHelix(node.initializer)
      ) {
        for (const binding of node.name.elements) {
          const name =
            binding.propertyName?.getText(ast).replaceAll(/['"]/g, '') ?? binding.name.getText(ast);
          if (writeMethods.has(name.toLowerCase()))
            report(binding, 'Destructured Helix writes belong in the policy executor');
        }
      }
      if (
        ts.isCallExpression(node) &&
        node.arguments[0] &&
        /api\.twitch\.tv\/helix\b/i.test(urlText(node.arguments[0]))
      ) {
        const callee = unwrap(node.expression);
        const directMethod = ts.isPropertyAccessExpression(callee)
          ? callee.name.text.toLowerCase()
          : '';
        let method = directMethod;
        const options = node.arguments[1] && unwrap(node.arguments[1]);
        if (options && ts.isObjectLiteralExpression(options)) {
          const entry = options.properties.find(
            (item) => item.name?.getText(ast).replaceAll(/['"]/g, '') === 'method',
          );
          if (entry && ts.isPropertyAssignment(entry))
            method = urlText(entry.initializer).toLowerCase() || 'post';
        }
        if (writeMethods.has(method))
          report(node, 'Raw Helix write requests belong in the policy executor');
      }
      ts.forEachChild(node, inspect);
    };
    inspect(ast);
    return violations;
  }
}
