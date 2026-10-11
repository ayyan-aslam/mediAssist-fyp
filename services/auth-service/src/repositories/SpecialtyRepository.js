export class SpecialtyRepository {
  constructor(prisma) {
    this.prisma = prisma;
  }

  findAll() {
    return this.prisma.specialty.findMany({
      select: { specialtyId: true, name: true },
      orderBy: { specialtyId: 'asc' },
    });
  }
}
