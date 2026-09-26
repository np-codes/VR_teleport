import bcrypt from 'bcryptjs';

// Demo users only. These will move to a real database later.
// Plain-text passwords live here just for the demo; they are hashed when the
// server starts and the plain versions are never used or sent anywhere else.
const demoUsers = [
  { id: 'colson', name: 'Colson', username: 'colson', password: 'demo123' },
  { id: 'jenil', name: 'Jenil', username: 'jenil', password: 'demo123' },
];

const users = demoUsers.map(({ password, ...user }) => ({
  ...user,
  passwordHash: bcrypt.hashSync(password, 10),
}));

export function findUserByUsername(username) {
  const wanted = username.trim().toLowerCase();
  return users.find((user) => user.username === wanted) ?? null;
}

export function findUserById(id) {
  return users.find((user) => user.id === id) ?? null;
}

export function getAllUsers() {
  return users;
}

// The only shape of a user that is ever sent to the frontend.
export function toPublicUser(user) {
  return { id: user.id, name: user.name };
}
