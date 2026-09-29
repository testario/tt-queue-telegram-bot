import { parseCallbackData } from '#application/parsers/callbackData.js'

describe('parseCallbackData confirm_player', () => {
  test('parses a numeric userId payload', () => {
    expect(parseCallbackData('confirm_player:123456789')).toEqual({
      type: 'confirm_player',
      userId: '123456789',
    })
  })

  test('rejects a non-numeric payload instead of trusting it', () => {
    expect(parseCallbackData('confirm_player:not-a-number')).toEqual({
      type: 'confirm_player',
      userId: null,
    })
  })

  test('rejects an empty payload', () => {
    expect(parseCallbackData('confirm_player:')).toEqual({
      type: 'confirm_player',
      userId: null,
    })
  })
})

describe('parseCallbackData tournament', () => {
  test('parses tournament invite and match identifiers', () => {
    expect(parseCallbackData('tournament_accept:t-12')).toEqual({
      type: 'tournament_accept',
      invitationId: 't-12',
    })
    expect(parseCallbackData('tournament_finish:match-34')).toEqual({
      type: 'tournament_finish',
      matchId: 'match-34',
    })
  })
})
