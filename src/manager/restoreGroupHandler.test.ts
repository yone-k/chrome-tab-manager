import fs from 'node:fs';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const managerAppPath = new URL('./ManagerApp.tsx', import.meta.url);

function getRestoreHandlerBody(handlerName: string): ts.Block {
  const sourceText = fs.readFileSync(managerAppPath, 'utf8');
  const sourceFile = ts.createSourceFile(
    'ManagerApp.tsx',
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  const findHandleRestoreGroupBody = (node: ts.Node): ts.Block | null => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === handlerName &&
      node.initializer &&
      ts.isArrowFunction(node.initializer)
    ) {
      if (ts.isBlock(node.initializer.body)) {
        return node.initializer.body;
      }
      return null;
    }
    let found: ts.Block | null = null;
    ts.forEachChild(node, (child) => {
      if (found) {
        return;
      }
      const result = findHandleRestoreGroupBody(child);
      if (result) {
        found = result;
      }
    });
    return found;
  };

  const restoreHandlerBody = findHandleRestoreGroupBody(sourceFile);

  if (!restoreHandlerBody) {
    throw new Error(`${handlerName} の本体を特定できませんでした。`);
  }

  return restoreHandlerBody;
}

function getTryBlock(handleRestoreGroupBody: ts.Block): ts.Block {
  const tryStatement = handleRestoreGroupBody.statements.find(ts.isTryStatement);

  if (!tryStatement) {
    throw new Error('handleRestoreGroup 内の try ブロックを特定できませんでした。');
  }

  return tryStatement.tryBlock;
}

function isAwaitedIdentifierCall(
  initializer: ts.Expression | undefined,
  identifier: string,
): boolean {
  if (!initializer || !ts.isAwaitExpression(initializer)) {
    return false;
  }
  const awaited = initializer.expression;
  return (
    ts.isCallExpression(awaited) &&
    ts.isIdentifier(awaited.expression) &&
    awaited.expression.text === identifier
  );
}

function hasIdentifierCall(node: ts.Node, identifier: string): boolean {
  let found = false;
  const visit = (current: ts.Node) => {
    if (found) {
      return;
    }
    if (
      ts.isCallExpression(current) &&
      ts.isIdentifier(current.expression) &&
      current.expression.text === identifier
    ) {
      found = true;
      return;
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

function isPropertyAccess(
  expression: ts.Expression,
  objectName: string,
  propertyName: string,
): boolean {
  return (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === objectName &&
    expression.name.text === propertyName
  );
}

function isTabsFilterDeclaration(statement: ts.Statement): boolean {
  if (!ts.isVariableStatement(statement)) {
    return false;
  }
  return statement.declarationList.declarations.some((declaration) => {
    if (
      !ts.isIdentifier(declaration.name) ||
      declaration.name.text !== 'tabs' ||
      !declaration.initializer ||
      !ts.isCallExpression(declaration.initializer)
    ) {
      return false;
    }
    const callTarget = declaration.initializer.expression;
    return (
      ts.isPropertyAccessExpression(callTarget) &&
      callTarget.name.text === 'filter' &&
      ts.isPropertyAccessExpression(callTarget.expression) &&
      ts.isIdentifier(callTarget.expression.expression) &&
      callTarget.expression.expression.text === 'targetSet' &&
      callTarget.expression.name.text === 'tabs'
    );
  });
}

function isTabsLengthEqualsZero(condition: ts.Expression): boolean {
  if (
    !ts.isBinaryExpression(condition) ||
    condition.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken
  ) {
    return false;
  }
  return (
    isPropertyAccess(condition.left, 'tabs', 'length') &&
    ts.isNumericLiteral(condition.right) &&
    condition.right.text === '0'
  );
}

function isInitialTabNotNull(condition: ts.Expression): boolean {
  if (
    !ts.isBinaryExpression(condition) ||
    condition.operatorToken.kind !== ts.SyntaxKind.ExclamationEqualsEqualsToken
  ) {
    return false;
  }
  return (
    isPropertyAccess(condition.left, 'restoreWindow', 'initialTabId') &&
    condition.right.kind === ts.SyntaxKind.NullKeyword
  );
}

function isRestoreWindowDeclaration(statement: ts.Statement): boolean {
  if (!ts.isVariableStatement(statement)) {
    return false;
  }
  return statement.declarationList.declarations.some(
    (declaration) =>
      ts.isIdentifier(declaration.name) &&
      declaration.name.text === 'restoreWindow' &&
      isAwaitedIdentifierCall(declaration.initializer, 'createRestoreWindow'),
  );
}

function isRestoreTabsDeclaration(statement: ts.Statement): boolean {
  if (!ts.isVariableStatement(statement)) {
    return false;
  }
  return statement.declarationList.declarations.some((declaration) =>
    isAwaitedIdentifierCall(declaration.initializer, 'restoreTabs'),
  );
}

function isRemoveRestoredTabsEnabledBranch(statement: ts.Statement): boolean {
  return (
    ts.isIfStatement(statement) &&
    ts.isIdentifier(statement.expression) &&
    statement.expression.text === 'removeRestoredTabsEnabled'
  );
}

function findStatementIndex(
  statements: readonly ts.Statement[],
  predicate: (statement: ts.Statement) => boolean,
): number {
  return statements.findIndex(predicate);
}

function hasRemoveInitialTabCall(node: ts.Node): boolean {
  let found = false;
  const visit = (current: ts.Node) => {
    if (found) {
      return;
    }
    if (ts.isCallExpression(current) && ts.isIdentifier(current.expression)) {
      const [arg] = current.arguments;
      if (
        current.expression.text === 'removeTab' &&
        arg &&
        isPropertyAccess(arg, 'restoreWindow', 'initialTabId')
      ) {
        found = true;
        return;
      }
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

function hasConsoleErrorCall(node: ts.Node, message: string): boolean {
  let found = false;
  const visit = (current: ts.Node) => {
    if (found) {
      return;
    }
    if (
      ts.isCallExpression(current) &&
      ts.isPropertyAccessExpression(current.expression) &&
      ts.isIdentifier(current.expression.expression) &&
      current.expression.expression.text === 'console' &&
      current.expression.name.text === 'error'
    ) {
      const [firstArg] = current.arguments;
      if (firstArg && ts.isStringLiteralLike(firstArg) && firstArg.text === message) {
        found = true;
        return;
      }
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

describe('handleRestoreGroup regression', () => {
  it('should use createRestoreWindow and not use getCurrentWindowId when restoring a group', () => {
    const handleRestoreGroupBody = getRestoreHandlerBody('handleRestoreGroup');

    expect(hasIdentifierCall(handleRestoreGroupBody, 'createRestoreWindow')).toBe(true);
    expect(hasIdentifierCall(handleRestoreGroupBody, 'getCurrentWindowId')).toBe(false);
  });

  it('should filter and empty-check group tabs before creating a restore window', () => {
    const handleRestoreGroupBody = getRestoreHandlerBody('handleRestoreGroup');
    const tryBlock = getTryBlock(handleRestoreGroupBody);

    const tabsFilterIndex = findStatementIndex(tryBlock.statements, isTabsFilterDeclaration);
    const tabsEmptyCheckIndex = findStatementIndex(
      tryBlock.statements,
      (statement) => ts.isIfStatement(statement) && isTabsLengthEqualsZero(statement.expression),
    );
    const createRestoreWindowIndex = findStatementIndex(
      tryBlock.statements,
      isRestoreWindowDeclaration,
    );

    expect(tabsFilterIndex).toBeGreaterThanOrEqual(0);
    expect(tabsEmptyCheckIndex).toBeGreaterThanOrEqual(0);
    expect(createRestoreWindowIndex).toBeGreaterThanOrEqual(0);
    expect(tabsFilterIndex).toBeLessThan(createRestoreWindowIndex);
    expect(tabsEmptyCheckIndex).toBeLessThan(createRestoreWindowIndex);
  });

  it('should remove initial tab after restoreTabs and before removeRestoredTabsEnabled branch', () => {
    const handleRestoreGroupBody = getRestoreHandlerBody('handleRestoreGroup');
    const tryBlock = getTryBlock(handleRestoreGroupBody);

    const restoreTabsIndex = findStatementIndex(tryBlock.statements, isRestoreTabsDeclaration);
    const initialTabCheckIndex = findStatementIndex(
      tryBlock.statements,
      (statement) => ts.isIfStatement(statement) && isInitialTabNotNull(statement.expression),
    );
    const removeRestoredTabsEnabledIndex = findStatementIndex(
      tryBlock.statements,
      isRemoveRestoredTabsEnabledBranch,
    );

    expect(initialTabCheckIndex).toBeGreaterThanOrEqual(0);
    const initialTabCheckStatement = tryBlock.statements[initialTabCheckIndex];
    if (!initialTabCheckStatement || !ts.isIfStatement(initialTabCheckStatement)) {
      throw new Error('初期タブ削除の if 文を特定できませんでした。');
    }

    expect(hasRemoveInitialTabCall(initialTabCheckStatement)).toBe(true);
    expect(
      hasConsoleErrorCall(
        initialTabCheckStatement,
        'Failed to remove initial tab in restore window',
      ),
    ).toBe(true);
    expect(initialTabCheckIndex).toBeGreaterThan(restoreTabsIndex);
    expect(initialTabCheckIndex).toBeLessThan(removeRestoredTabsEnabledIndex);
  });
});

describe('restore handlers non-regression', () => {
  it('should keep set restore flow creating a restore window and cleaning initial tab', () => {
    const handleRestoreSetBody = getRestoreHandlerBody('handleRestoreSet');

    expect(hasIdentifierCall(handleRestoreSetBody, 'createRestoreWindow')).toBe(true);
    expect(hasIdentifierCall(handleRestoreSetBody, 'removeTab')).toBe(true);
    expect(
      hasConsoleErrorCall(handleRestoreSetBody, 'Failed to remove initial tab in restore window'),
    ).toBe(true);
  });

  it('should keep tab restore flow using current window and never create a new restore window', () => {
    const handleRestoreTabBody = getRestoreHandlerBody('handleRestoreTab');

    expect(hasIdentifierCall(handleRestoreTabBody, 'getCurrentWindowId')).toBe(true);
    expect(hasIdentifierCall(handleRestoreTabBody, 'createRestoreWindow')).toBe(false);
  });
});
