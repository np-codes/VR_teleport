import bcrypt from 'bcryptjs';

const demoUsers = [
  { id: 'colson', name: 'Colson', username: 'c', password: 'a' },
  { id: 'jenil', name: 'Jenil', username: 'j', password: 'd' },
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
