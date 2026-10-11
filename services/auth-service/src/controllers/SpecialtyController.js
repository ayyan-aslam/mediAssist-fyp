export class SpecialtyController {
  constructor({ specialtyService }) {
    this.specialtyService = specialtyService;
  }

  list = async (req, res) => {
    res.json({ items: await this.specialtyService.list() });
  };
}
