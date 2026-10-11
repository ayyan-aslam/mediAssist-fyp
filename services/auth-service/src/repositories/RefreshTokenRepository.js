export class RefreshTokenRepository {
  constructor(prisma) {
    this.prisma = prisma;
  }

  async save({ userId, tokenHash, expiresAt }) {
    await this.prisma.refreshToken.create({ data: { userId, tokenHash, expiresAt } });
  }

  findByHash(tokenHash) {
    return this.prisma.refreshToken.findUnique({ where: { tokenHash } });
  }

  // Deletes the old token and saves the new one in one transaction.
  // Returns false when the old token was already gone, so a token can be used only once.
  replace(oldTokenId, { userId, tokenHash, expiresAt }) {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.refreshToken.deleteMany({ where: { tokenId: oldTokenId } });
      if (count === 0) {
        return false;
      }
      await tx.refreshToken.create({ data: { userId, tokenHash, expiresAt } });
      return true;
    });
  }

  async deleteByHash(tokenHash) {
    await this.prisma.refreshToken.deleteMany({ where: { tokenHash } });
  }
}
