const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { normalizeUsername, USERNAME_PATTERN, findUserIdsWithHistory } = require('../src/utils/userAccounts')

describe('username normalisation', () => {
  it('lowercases and strips all whitespace but keeps letters such as s', () => {
    assert.equal(normalizeUsername(' Fixed One '), 'fixedone')
    assert.equal(normalizeUsername('Somnang'), 'somnang')
    assert.equal(normalizeUsername('sok.sara'), 'sok.sara')
  })

  it('accepts 3-32 safe characters only', () => {
    assert.ok(USERNAME_PATTERN.test('sok.sara-01_x'))
    assert.ok(!USERNAME_PATTERN.test('ab'))
    assert.ok(!USERNAME_PATTERN.test('a/b/c'))
    assert.ok(!USERNAME_PATTERN.test('x'.repeat(33)))
  })
})

describe('findUserIdsWithHistory', () => {
  it('returns ids found in any history table and tolerates missing tables', async () => {
    const calls = []
    const db = {
      execute: async (sql) => {
        calls.push(sql)
        if (sql.includes('FROM shifts')) return [[{ user_id: 4 }]]
        if (sql.includes('FROM stock_movements')) {
          const error = new Error('missing')
          error.code = 'ER_NO_SUCH_TABLE'
          throw error
        }
        return [[{ user_id: 9 }]]
      },
    }
    const found = await findUserIdsWithHistory(db, [4, 7, 9, 'x', 0])
    assert.deepEqual([...found].sort(), [4, 9])
    assert.equal(calls.length, 3)
  })

  it('does not query when there are no valid ids', async () => {
    const db = { execute: async () => { throw new Error('should not run') } }
    assert.equal((await findUserIdsWithHistory(db, [])).size, 0)
  })
})

describe('display name validation', () => {
  const { displayNameValidationError } = require('../src/utils/userAccounts')

  it('requires a non-empty string of at most 100 characters', () => {
    assert.equal(displayNameValidationError('Sok Sara'), null)
    assert.ok(displayNameValidationError('   '))
    assert.ok(displayNameValidationError('x'.repeat(101)))
    assert.ok(displayNameValidationError({ a: 1 }))
    assert.ok(displayNameValidationError(null))
  })
})
