export class SpecialtyService {
  constructor(specialtyRepository) {
    this.specialtyRepository = specialtyRepository;
  }

  list() {
    return this.specialtyRepository.findAll();
  }
}
