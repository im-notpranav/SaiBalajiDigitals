/**
 * The bcrypt cost for passwords. The free hosting gives the API a tenth of a core, and at 12 one
 * login took seconds and slowed everyone else while it ran. 10 is about four times cheaper and
 * still an accepted minimum. Passwords hashed at a higher cost move to this one at their next login.
 */
export const PASSWORD_HASH_ROUNDS = 10;
