import { ClaimPlayerIdentity } from "./ClaimPlayerIdentity.js";

/**
 * Test/dev-only identity adapter. It deliberately delegates to the normal
 * reserve -> persist -> activate claim flow; generation numbers are never
 * supplied by callers.
 */
export const createTestIdentityHelper = ({
  claimPlayerIdentity,
  queueRepository,
  playersRepository,
  logger,
}) => {
  const claim = claimPlayerIdentity || new ClaimPlayerIdentity({
    queueRepository,
    playersRepository,
    logger,
  });

  return async ({ username, userId, firstName, lastName }) => {
    const normalizedUsername = username?.startsWith("@") ? username : `@${username}`;
    return claim.execute({
      username: normalizedUsername,
      userId: userId ?? `test-user:${normalizedUsername}`,
      firstName,
      lastName,
    });
  };
};
