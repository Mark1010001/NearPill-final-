import { applyDatabaseActor } from './context.js';

function remapRow(row, aliases) {
  if (!row || typeof row !== 'object') return row;
  const mapped = {};
  for (const [key, value] of Object.entries(row)) {
    // SQL results can contain a column named __proto__. Plain assignment
    // would mutate this row's prototype or silently discard the column.
    Object.defineProperty(mapped, aliases.get(key) || key, {
      value, enumerable: true, writable: true, configurable: true,
    });
  }
  return mapped;
}

// Only rewrite SQL code. The compatibility queries still use MySQL-style ?
// parameters; ?/LIKE inside values, comments or identifiers are data, not SQL.
// PostgreSQL dollar-quoted strings and nested block comments are also opaque.
function rewriteSqlCode(sql) {
  let parameter = 0;
  let output = '';
  let hasReturningKeyword = false;
  let leadingKeyword = null;
  const aliases = new Map();
  let codeStart = 0;
  let insertionOffset = 0;

  const flushCode = (end) => {
    let code = sql.slice(codeStart, end);
    // Determine the statement type only from the first SQL token outside
    // comments/literals. A prefixed audit comment must not change the
    // SELECT row contract or INSERT RETURNING id compatibility behavior.
    if (leadingKeyword === null && /\S/.test(code)) {
      leadingKeyword = /^\s*([A-Za-z_][A-Za-z0-9_]*)\b/.exec(code)?.[1]?.toUpperCase() ?? '';
    }
    // MySQL result-key aliases are case-preserved for the existing API.
    // Reading AS from literals/comments would silently rename real columns.
    for (const match of code.matchAll(/\bAS\s+([A-Za-z_][A-Za-z0-9_]*)\b/gi)) {
      aliases.set(match[1].toLowerCase(), match[1]);
    }
    code = code.replace(
      /CAST\(password\s+AS\s+BINARY\)\s*=\s*CAST\(\?\s+AS\s+BINARY\)/gi,
      'password = ?',
    );
    code = code.replace(/\sLIKE\s/gi, ' ILIKE ');
    if (/\bRETURNING\b/i.test(code)) hasReturningKeyword = true;
    const rewritten = code.replace(/\?/g, () => `$${++parameter}`);
    // Only SQL tokens, not trailing semicolons or comments, determine where
    // an implicit INSERT RETURNING clause belongs. Track offsets in the
    // converted text because ? -> $N changes character positions.
    const tokenEnd = rewritten.replace(/[\s;]+$/g, '').length;
    if (tokenEnd > 0) insertionOffset = output.length + tokenEnd;
    output += rewritten;
  };

  let i = 0;
  while (i < sql.length) {
    const char = sql[i];
    const next = sql[i + 1];
    let end = -1;
    let isSqlToken = false;

    if (char === "'" || char === '"') {
      const escapeString = char === "'" && /[eE]/.test(sql[i - 1] || '') &&
        (i < 2 || !/[a-zA-Z0-9_]/.test(sql[i - 2]));
      let j = i + 1;
      while (j < sql.length) {
        if (escapeString && sql[j] === '\\') { j += 2; continue; }
        if (sql[j] === char) {
          if (sql[j + 1] === char) { j += 2; continue; }
          j += 1;
          break;
        }
        j += 1;
      }
      end = Math.min(j, sql.length);
      isSqlToken = true;
    } else if (char === '-' && next === '-') {
      const newline = sql.indexOf('\n', i + 2);
      end = newline < 0 ? sql.length : newline;
    } else if (char === '/' && next === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < sql.length && depth > 0) {
        if (sql[j] === '/' && sql[j + 1] === '*') { depth += 1; j += 2; }
        else if (sql[j] === '*' && sql[j + 1] === '/') { depth -= 1; j += 2; }
        else j += 1;
      }
      end = j;
    } else if (char === '$') {
      const delimiter = /^(?:\$\$|\$[a-zA-Z_][a-zA-Z0-9_]*\$)/.exec(sql.slice(i))?.[0];
      if (delimiter) {
        const close = sql.indexOf(delimiter, i + delimiter.length);
        end = close < 0 ? sql.length : close + delimiter.length;
        isSqlToken = true;
      }
    }

    if (end >= 0) {
      flushCode(i);
      output += sql.slice(i, end);
      if (isSqlToken) insertionOffset = output.length;
      i = end;
      codeStart = i;
    } else {
      i += 1;
    }
  }
  flushCode(sql.length);
  return { text: output, hasReturningKeyword, leadingKeyword, aliases, insertionOffset };
}

function postgresifySql(input) {
  const { text, hasReturningKeyword, leadingKeyword, aliases, insertionOffset } = rewriteSqlCode(String(input));
  const trimmed = text.trim().replace(/;$/, '');
  let converted = trimmed;
  if (leadingKeyword === 'INSERT' && !hasReturningKeyword) {
    // Appending to the end can place RETURNING after a line comment (where
    // PostgreSQL ignores it) or after a semicolon (invalid second statement).
    const before = text.slice(0, insertionOffset).trimEnd();
    const after = text.slice(insertionOffset).trimStart();
    // Preserve the established harmless trailing /* ... */ formatting when
    // no statement terminator follows; it was already a valid SQL contract.
    const blockCommentsOnly = /^(?:\/\*[\s\S]*?\*\/\s*)+$/.test(after);
    converted = blockCommentsOnly ? `${trimmed} RETURNING id`
      : `${before} RETURNING id${after ? (after.startsWith(';') ? '' : ' ') + after : ''}`;
  }
  return { text: converted, leadingKeyword, aliases };
}

async function runQuery(client, sql, params) {
  const converted = postgresifySql(sql);
  const result = await client.query(converted.text, params);

  if (converted.leadingKeyword === 'SELECT' || converted.leadingKeyword === 'WITH') {
    return [result.rows.map((row) => remapRow(row, converted.aliases))];
  }

  return [{
    insertId: result.rows[0]?.id ? Number(result.rows[0].id) : 0,
    affectedRows: Number(result.rowCount ?? 0),
  }];
}

function connectionFacade(client, actorOverrides) {
  let inTransaction = false;
  let contextApplied = false;
  let discard = false;
  let released = false;
  let busy = false;

  function assertActive() {
    // Once returned to the pool, this physical client could carry a different
    // request's actor and transaction. Never allow a retained facade to reuse it.
    if (released) throw new Error('PostgreSQL connection has already been released.');
  }

  // A facade may be retained while an asynchronous statement is pending.
  // Concurrent operations or an early release would allow a second tenant to
  // borrow the same client before its previous transaction has finished.
  function enterOperation() {
    assertActive();
    if (busy) throw new Error('PostgreSQL connection operation is in progress.');
    busy = true;
    return () => { busy = false; };
  }

  // A pooled connection must never be returned for reuse while a transaction
  // (including a failed actor-context setup) may still be open. Releasing
  // such a connection with destroy=true delegates cleanup to the pool.
  return {
    async beginTransaction() {
      const leave = enterOperation();
      if (inTransaction) {
        leave();
        throw new Error('PostgreSQL transaction is already active.');
      }
      try {
        await client.query('BEGIN');
        inTransaction = true;
        await applyDatabaseActor(client, actorOverrides);
        contextApplied = true;
      } catch (error) {
        discard = true;
        throw error;
      } finally {
        leave();
      }
    },
    async query(sql, params = []) {
      const leave = enterOperation();
      try {
        if (!contextApplied) {
          if (!inTransaction) {
            await client.query('BEGIN');
            inTransaction = true;
          }
          await applyDatabaseActor(client, actorOverrides);
          contextApplied = true;
        }
        return await runQuery(client, sql, params);
      } catch (error) {
        // The caller may attempt rollback; a plain release must discard.
        discard = true;
        throw error;
      } finally {
        leave();
      }
    },
    async commit() {
      const leave = enterOperation();
      try {
        await client.query('COMMIT');
        inTransaction = false;
        contextApplied = false;
      } catch (error) {
        discard = true; // A failed COMMIT has an ambiguous server state.
        throw error;
      } finally {
        leave();
      }
    },
    async rollback() {
      const leave = enterOperation();
      try {
        if (inTransaction || contextApplied) await client.query('ROLLBACK');
        inTransaction = false;
        contextApplied = false;
      } catch (error) {
        discard = true;
        throw error;
      } finally {
        leave();
      }
    },
    release() {
      assertActive();
      if (busy) throw new Error('PostgreSQL connection operation is in progress.');
      released = true;
      client.release(discard || inTransaction || contextApplied);
    },
  };
}

export function createPostgresCompatPool(pool, { capability = null } = {}) {
  if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
    throw new TypeError('A PostgreSQL pool is required.');
  }

  const actorOverrides = capability ? { capability } : {};

  return Object.freeze({
    async query(sql, params = []) {
      const client = await pool.connect();
      let discard = false;
      let began = false;
      let commitAttempted = false;
      try {
        await client.query('BEGIN');
        began = true;
        await applyDatabaseActor(client, actorOverrides);
        const result = await runQuery(client, sql, params);
        commitAttempted = true;
        await client.query('COMMIT');
        return result;
      } catch (error) {
        // Never recycle an ambiguous COMMIT connection, or a connection whose
        // rollback failed. Preserve the original error for the calling use case.
        discard = !began || commitAttempted;
        try { await client.query('ROLLBACK'); } catch { discard = true; }
        throw error;
      } finally {
        client.release(discard);
      }
    },
    async getConnection() {
      const client = await pool.connect();
      return connectionFacade(client, actorOverrides);
    },
  });
}
