const COLORS = ['#7c5cff', '#e0588f', '#e07a2f', '#1f9e8f', '#3a86d8', '#b84fc9']

// Picks the same color for the same person every time.
function colorFor(id = '') {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return COLORS[hash % COLORS.length]
}

export default function Avatar({ user, size = 48 }) {
  const initial = user?.name?.charAt(0).toUpperCase() ?? '?'

  return (
    <span
      className="avatar"
      style={{ '--avatar-size': `${size}px`, background: colorFor(user?.id) }}
      aria-hidden="true"
    >
      {initial}
    </span>
  )
}
