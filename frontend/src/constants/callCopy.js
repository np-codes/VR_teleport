// All Summon / Teleport wording in one place.
//   Summon   = bring them to you: the call happens in the CALLER's space.
//   Teleport = go to them: the call happens in the RECEIVER's space.
// Both start the same call; only the mode (and so the wording) differs.

export const MODE_SUMMON = 'summon'
export const MODE_TELEPORT = 'teleport'

export function toCallMode(value) {
  return value === MODE_TELEPORT ? MODE_TELEPORT : MODE_SUMMON
}

export const APP_NAME = 'VR Teleport'
export const TAGLINE = 'Summon someone into your space, or teleport into theirs.'

export const ACTIONS = {
  [MODE_SUMMON]: { label: 'Summon', hint: 'Bring them to you' },
  [MODE_TELEPORT]: { label: 'Teleport', hint: 'Go to them' },
}

// Caller, while it rings.
export const OUTGOING_TEXT = {
  [MODE_SUMMON]: (name) => `Summoning ${name} into your space…`,
  [MODE_TELEPORT]: (name) => `Requesting to teleport into ${name}'s space…`,
}

// Receiver, in the incoming screen.
export const INCOMING = {
  [MODE_SUMMON]: {
    text: (name) => `${name} is summoning you. You'll leave your space and enter theirs.`,
    accept: 'Go',
  },
  [MODE_TELEPORT]: {
    text: (name) => `${name} wants to teleport into your space.`,
    accept: 'Let them in',
  },
  decline: 'Decline',
}

// Whose space the call is in, from this person's point of view.
export function spaceLabel({ mode, isCaller, peerName }) {
  const inCallersSpace = mode !== MODE_TELEPORT
  const inMySpace = isCaller ? inCallersSpace : !inCallersSpace
  return inMySpace ? 'In your space' : `In ${peerName}'s space`
}
